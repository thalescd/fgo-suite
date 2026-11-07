/**
 * As regras do censo: patch novo passa, contagem que encolhe falha, e o mesmo
 * gamedata não admite diferença nenhuma.
 */

import { describe, expect, it } from "vitest";

import { type CensusEntry, type CensusFile, compareCensus } from "./census.js";

const prev: CensusFile = {
  _: "",
  gameDataHash: "old",
  measuredAt: "",
  counts: { servants: 462, gauge: ["Ereshkigal", "Ereshkigal"] },
};

const entries = (servants: number, gauge: string[]): CensusEntry[] => [
  { key: "servants", label: "servos", value: servants },
  { key: "gauge", label: "medidor", value: gauge, onGrowth: "confira" },
];

describe("compareCensus", () => {
  it("gamedata novo com contagem maior é novidade, não falha", () => {
    const d = compareCensus(prev, entries(471, ["Ereshkigal", "Ereshkigal"]), "new");
    expect(d.regressions).toEqual([]);
    expect(d.growth).toEqual(["servos: 462 -> 471 (+9)"]);
  });

  it("gamedata novo com contagem menor é regressão", () => {
    const d = compareCensus(prev, entries(400, ["Ereshkigal", "Ereshkigal"]), "new");
    expect(d.regressions).toEqual(["servos: 462 -> 400 (-62)"]);
  });

  it("mesmo gamedata não admite diferença, nem para mais", () => {
    const d = compareCensus(prev, entries(463, ["Ereshkigal", "Ereshkigal"]), "old");
    expect(d.growth).toEqual([]);
    expect(d.regressions).toHaveLength(1);
    expect(d.regressions[0]).toContain("MESMO gamedata");
  });

  it("lista cresce por item, e o item novo vem com o aviso", () => {
    const d = compareCensus(prev, entries(462, ["Ereshkigal", "Ereshkigal", "Nova"]), "new");
    expect(d.growth).toEqual(["medidor: + Nova\n      ⚠ confira"]);
  });

  it("lista que perde um item repetido também regride", () => {
    const d = compareCensus(prev, entries(462, ["Ereshkigal", "Nova"]), "new");
    expect(d.regressions).toEqual(["medidor: + Nova, - Ereshkigal"]);
  });

  it("igual em tudo não diz nada", () => {
    const d = compareCensus(prev, entries(462, ["Ereshkigal", "Ereshkigal"]), "new");
    expect(d).toEqual({ growth: [], regressions: [], notes: [] });
  });

  it("chave nova ou removida vira nota, sem falhar", () => {
    const d = compareCensus(prev, [{ key: "servants", label: "servos", value: 462 }, { key: "x", label: "x", value: 1 }], "old");
    expect(d.regressions).toEqual([]);
    expect(d.notes).toEqual(["x: entrou no censo (1)", "gauge: saiu do censo"]);
  });

  it("sem censo anterior, nada para comparar", () => {
    const d = compareCensus(null, entries(1, []), "new");
    expect(d.regressions).toEqual([]);
    expect(d.notes).toHaveLength(1);
  });
});
