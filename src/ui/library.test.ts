/**
 * Exportar e importar a biblioteca (5f).
 *
 * O que se testa é o que separa um importador útil de um perigoso: que ele não
 * apaga nada sem ser mandado, que **conta** o que descartou, que recusa arquivo
 * que não é nosso, e que a ida e volta não perde nada.
 */

import { describe, expect, it } from "vitest";

import type { EnemyPreset } from "../core/scenario.js";
import { describeImport, exportFileName, exportLibrary, importLibrary } from "./library.js";
import { loadTargets, saveTarget } from "./targets.js";
import { loadTemplates, saveTemplate, SEED_TEMPLATES } from "./templates.js";

function fakeStore() {
  const box = new Map<string, string>();
  return {
    getItem: (k: string) => box.get(k) ?? null,
    setItem: (k: string, v: string) => void box.set(k, v),
    box,
  };
}
const stores = () => ({ templates: fakeStore(), targets: fakeStore() });

const castoria = { servantId: 504500, skills: [1, 3], skillLevel: 10, targetsAttacker: true, np: null, ce: null };
const gawain: EnemyPreset = {
  className: "saber",
  attribute: "earth",
  traits: [2000, 2002],
  defMod: 0,
  specialDefMod: 50,
};

/** Uma biblioteca com uma coisa de cada, para exportar. */
function cheia() {
  const s = stores();
  saveTemplate("Double Castoria", [castoria, castoria], s.templates);
  saveTarget("Gawain", gawain, s.targets);
  return s;
}

describe("exportar", () => {
  it("leva as duas listas, com cabeçalho e versão", () => {
    const file = JSON.parse(exportLibrary(cheia())) as Record<string, unknown>;
    expect(file["kind"]).toBe("fgo-tools/library");
    expect(file["version"]).toBe(1);
    expect(file["buffTemplates"]).toEqual([{ name: "Double Castoria", sources: ["504500:1,3", "504500:1,3"] }]);
    expect(file["targets"]).toEqual([{ name: "Gawain", enemy: "ec=saber&ea=earth&et=2000%2C2002&esdef=50" }]);
  });

  it("guarda o mesmo formato do link, não um segundo", () => {
    const texto = exportLibrary(cheia());
    // Referência para buff, pedaço de query para alvo — nada resolvido.
    expect(texto).toContain('"504500:1,3"');
    expect(texto).not.toMatch(/atkMod|upAtk|"divine"/);
  });

  it("as sementes não entram: elas melhoram com o projeto, o arquivo congela", () => {
    const texto = exportLibrary(stores());
    for (const s of SEED_TEMPLATES) expect(texto).not.toContain(s.name);
    expect((JSON.parse(texto) as { buffTemplates: unknown[] }).buffTemplates).toEqual([]);
  });

  it("o nome do arquivo traz a data, para dois backups não se atropelarem", () => {
    expect(exportFileName(new Date("2026-09-04T10:00:00Z"))).toBe("fgo-library-2026-09-04.json");
  });
});

describe("importar", () => {
  it("ida e volta não perde nada", () => {
    const texto = exportLibrary(cheia());
    const vazio = stores();
    const r = importLibrary(texto, "merge", vazio);
    expect(r.ok).toBe(true);
    expect(loadTemplates(vazio.templates)).toEqual(loadTemplates(cheia().templates));
    expect(loadTargets(vazio.targets)).toEqual([{ name: "Gawain", enemy: gawain }]);
  });

  it("merge nunca destrói: nome repetido mantém o que já estava aqui", () => {
    const texto = exportLibrary(cheia());
    const meu = stores();
    // O meu "Gawain" é outro alvo, com o mesmo nome.
    saveTarget("Gawain", { ...gawain, className: "rider" }, meu.targets);
    const r = importLibrary(texto, "merge", meu);

    expect(r.ok && r.targets).toEqual({ added: 0, kept: 1, dropped: 0 });
    expect(loadTargets(meu.targets)[0]!.enemy.className).toBe("rider");
    // E o que não colidiu entrou.
    expect(loadTemplates(meu.templates).map((t) => t.name)).toEqual(["Double Castoria"]);
  });

  it("replace apaga o que estava aqui — é o outro caso, e é explícito", () => {
    const texto = exportLibrary(cheia());
    const meu = stores();
    saveTarget("outro", gawain, meu.targets);
    importLibrary(texto, "replace", meu);
    expect(loadTargets(meu.targets).map((t) => t.name)).toEqual(["Gawain"]);
  });

  it("entrada ilegível é CONTADA, não só descartada", () => {
    // A diferença para a leitura do localStorage: aqui o usuário está agindo e
    // espera resposta, em vez de uma lista que voltou menor sem explicação.
    const texto = JSON.stringify({
      kind: "fgo-tools/library",
      version: 1,
      buffTemplates: [
        { name: "bom", sources: ["504500:1,3"] },
        { name: "quebrado", sources: ["504500:1,3", "lixo"] },
        { name: "", sources: ["504500:1"] },
      ],
      targets: [{ name: "sem inimigo", enemy: "" }],
    });
    const r = importLibrary(texto, "merge", stores());
    expect(r.ok && r.templates).toEqual({ added: 1, kept: 0, dropped: 2 });
    expect(r.ok && r.targets).toEqual({ added: 0, kept: 0, dropped: 1 });
    expect(describeImport(r)).toBe("1 imported · 3 could not be read and were skipped");
  });

  it("arquivo que não é nosso é recusado dizendo o que é", () => {
    expect(importLibrary("{}", "merge", stores())).toEqual({
      ok: false,
      reason: "that JSON is not an FGO Tools library export",
    });
    expect(importLibrary("não é json", "merge", stores())).toEqual({ ok: false, reason: "that file is not JSON" });
  });

  it("versão futura é recusada em vez de lida pela metade", () => {
    const texto = JSON.stringify({ kind: "fgo-tools/library", version: 99, buffTemplates: [], targets: [] });
    const r = importLibrary(texto, "merge", stores());
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/newer version \(99\)/);
  });

  it("uma lista ausente não impede a outra de entrar", () => {
    const texto = JSON.stringify({
      kind: "fgo-tools/library",
      version: 1,
      targets: [{ name: "só alvo", enemy: "ec=berserker" }],
    });
    const s = stores();
    const r = importLibrary(texto, "merge", s);
    expect(r.ok && r.targets.added).toBe(1);
    expect(loadTargets(s.targets)).toHaveLength(1);
  });

  it("a frase do relatório é a mesma na tela e aqui", () => {
    const limpo = importLibrary(exportLibrary(cheia()), "merge", stores());
    expect(describeImport(limpo)).toBe("2 imported");
  });
});
