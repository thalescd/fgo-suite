/**
 * Alvos salvos (5e).
 *
 * O que se testa é o que separa um alvo útil de um que mente: que ele guarda
 * ids e não nomes, que não carrega pela metade, que o nome não vaza para o
 * link, e que puxar um servo traz o que ele de fato tem.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_CALC,
  enemyOf,
  enemyPatch,
  parseCalc,
  parseEnemyPreset,
  serializeCalc,
  serializeEnemyPreset,
  type EnemyPreset,
} from "../core/scenario.js";
import { enemyTraitNames } from "../core/damage.js";
import type { IndexEntry, IndexEntryServant, Servant } from "../core/model.js";
import { loadTargets, removeTarget, saveTarget, suggestTargetName } from "./targets.js";

const index = JSON.parse(readFileSync("public/data/index.json", "utf8")) as IndexEntry[];
const catalog = JSON.parse(readFileSync("public/data/traits.json", "utf8")) as { id: number; name: string; uses: number }[];
const servants = index.filter((e): e is IndexEntryServant => e.kind === "servant");
const load = (cn: number) =>
  JSON.parse(
    readFileSync(`public/data/servant/${servants.find((s) => s.collectionNo === cn)!.id}.json`, "utf8"),
  ) as Servant;
const traitName = (id: number) => catalog.find((t) => t.id === id)?.name ?? `trait ${id}`;

function fakeStore(initial?: string) {
  const box = new Map<string, string>();
  if (initial !== undefined) box.set("fgo.targets.v1", initial);
  return {
    getItem: (k: string) => box.get(k) ?? null,
    setItem: (k: string, v: string) => void box.set(k, v),
    box,
  };
}

const lancer: EnemyPreset = {
  className: "lancer",
  attribute: "sky",
  traits: [2000, 2002],
  defMod: 20,
  specialDefMod: 0,
};

describe("o alvo como pedaço de link", () => {
  it("sobrevive à ida e volta", () => {
    expect(parseEnemyPreset(serializeEnemyPreset(lancer))).toEqual(lancer);
  });

  it("guarda ids, não nomes — o nome muda entre dumps, o id não", () => {
    const raw = serializeEnemyPreset(lancer);
    expect(raw).toContain("et=2000%2C2002");
    expect(raw).not.toMatch(/divine|dragon/);
  });

  it("string sem nenhuma chave de inimigo é recusada, não vira alvo neutro", () => {
    // Cair no neutro seria a direção segura do erro, mas ainda um erro calado.
    expect(parseEnemyPreset("")).toBeNull();
    expect(parseEnemyPreset("lixo=1")).toBeNull();
    // Uma chave só já é um alvo legítimo.
    expect(parseEnemyPreset("ec=berserker")?.className).toBe("berserker");
  });

  it("o alvo é uma fatia do cenário, e não mexe no resto", () => {
    const cheio = { ...DEFAULT_CALC, servantId: 100100, skills: [1, 2], hpPercent: 40 };
    const depois = { ...cheio, ...enemyPatch(lancer) };
    expect([depois.servantId, depois.skills, depois.hpPercent]).toEqual([100100, [1, 2], 40]);
    expect(enemyOf(depois)).toEqual(lancer);
  });

  it("stacksTarget fica fora: é do combate, não do alvo", () => {
    const comStacks = { ...DEFAULT_CALC, stacksTarget: 10, ...enemyPatch(lancer) };
    expect(comStacks.stacksTarget).toBe(10);
    expect(serializeEnemyPreset(enemyOf(comStacks))).not.toContain("st=");
  });
});

describe("guardar e ler", () => {
  it("sobrevive à ida e volta pelo armazenamento", () => {
    const store = fakeStore();
    expect(saveTarget("Gawain", lancer, store).ok).toBe(true);
    expect(loadTargets(store)).toEqual([{ name: "Gawain", enemy: lancer }]);
  });

  it("mesmo nome substitui em vez de duplicar", () => {
    const store = fakeStore();
    saveTarget("boss", lancer, store);
    saveTarget("boss", { ...lancer, className: "rider" }, store);
    const all = loadTargets(store);
    expect(all).toHaveLength(1);
    expect(all[0]!.enemy.className).toBe("rider");
  });

  it("apagar tira só o que foi pedido", () => {
    const store = fakeStore();
    saveTarget("a", lancer, store);
    saveTarget("b", lancer, store);
    expect(removeTarget("a", store).ok).toBe(true);
    expect(loadTargets(store).map((t) => t.name)).toEqual(["b"]);
  });

  it("entrada ilegível é descartada, e não meio carregada", () => {
    const store = fakeStore(JSON.stringify([
      { name: "bom", enemy: "ec=lancer" },
      { name: "vazio", enemy: "" },
      { name: "", enemy: "ec=rider" },
      7,
    ]));
    expect(loadTargets(store).map((t) => t.name)).toEqual(["bom"]);
  });

  it("sem armazenamento, recusa com motivo em vez de fingir", () => {
    const morto = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    const r = saveTarget("x", lancer, morto);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/could not save/);
  });

  it("nome vazio não vira alvo", () => {
    expect(saveTarget("   ", lancer, fakeStore())).toEqual({ ok: false, reason: "give the target a name first" });
  });
});

describe("o nome sugerido", () => {
  it("descreve o alvo pelo que ele é", () => {
    expect(suggestTargetName(lancer, traitName)).toBe("lancer · sky · divine +1 · def +20%");
  });

  it("o alvo neutro não inventa classe nem atributo", () => {
    expect(suggestTargetName(enemyOf(DEFAULT_CALC), traitName)).toBe("");
  });

  it("defesa entra quando existe", () => {
    const s = suggestTargetName({ ...lancer, traits: [], specialDefMod: 50 }, traitName);
    expect(s).toBe("lancer · sky · def +20% · sdef 50%");
  });
});

describe("puxar um servo como alvo", () => {
  const catalogIds = new Set(catalog.map((t) => t.id));
  const asTarget = (s: Servant) =>
    s.traits.filter((t) => catalogIds.has(t.id) && !/^(class|attribute)/.test(t.name)).map((t) => t.id);

  it("traz os traits que algum efeito de fato checa", () => {
    const artoria = load(2);
    const nomes = asTarget(artoria).map(traitName);
    // O que faz a Artoria ser alvo interessante, e o que ninguém digitaria à mão.
    expect(nomes).toEqual(expect.arrayContaining(["weakToEnumaElish", "riding", "dragon", "knightsOfTheRound"]));
  });

  it("não repete o que os dois seletores já derivam", () => {
    const artoria = load(2);
    const nomes = asTarget(artoria).map(traitName);
    expect(nomes).not.toContain("classSaber");
    expect(nomes).not.toContain("attributeEarth");
    // E eles voltam sozinhos quando classe e atributo são aplicados.
    const derivados = enemyTraitNames({
      className: artoria.className,
      attribute: artoria.attribute,
      traits: [],
      defMod: 0,
      specialDefMod: 0,
    });
    expect([...derivados].sort()).toEqual(["attributeEarth", "classSaber"]);
  });

  it("o nome sugerido pega o trait que distingue, não o primeiro da lista", () => {
    // A Artoria entra com 20 traits e o primeiro é `genderFemale`, que 33
    // efeitos procuram — todo servo tem gênero, então ele não diz nada. O menos
    // procurado no catálogo é o que identifica este alvo.
    const artoria = load(2);
    const e: EnemyPreset = {
      className: artoria.className, attribute: artoria.attribute,
      traits: asTarget(artoria), defMod: 0, specialDefMod: 0,
    };
    const uses = (id: number) => catalog.find((t) => t.id === id)?.uses ?? 0;
    expect(suggestTargetName(e, traitName)).toContain("genderFemale");
    expect(suggestTargetName(e, traitName, uses)).not.toContain("genderFemale");
    // E a contagem continua sendo a de traits, não a da lista reordenada.
    expect(suggestTargetName(e, traitName, uses)).toContain(`+${e.traits.length - 1}`);
  });

  it("o alvo puxado vira um alvo salvável como qualquer outro", () => {
    const gil = load(12);
    const e: EnemyPreset = {
      className: gil.className,
      attribute: gil.attribute,
      traits: asTarget(gil),
      defMod: 0,
      specialDefMod: 0,
    };
    expect(parseEnemyPreset(serializeEnemyPreset(e))).toEqual(e);
    expect(suggestTargetName(e, traitName)).toMatch(/^archer · sky · /);
  });
});

describe("o alvo salvo não vaza para o link", () => {
  it("a URL leva o inimigo expandido, e nenhum nome", () => {
    const url = serializeCalc({ ...DEFAULT_CALC, servantId: 100100, ...enemyPatch(lancer) }).toString();
    expect(url).toContain("ec=lancer");
    expect(url).toContain("et=2000%2C2002");
    expect(url).not.toMatch(/Gawain|name|tgt/i);
    // E quem abre o link chega no mesmo alvo.
    expect(enemyOf(parseCalc(new URLSearchParams(url)))).toEqual(lancer);
  });
});
