/**
 * Templates de buffs externos.
 *
 * O que se testa aqui é o que separa um template útil de um que mente: que ele
 * guarda referência e não valor, que ele nunca carrega pela metade, que o nome
 * não vaza para o link, e que as sementes apontam para servos e skills que
 * existem de verdade no dump atual.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEFAULT_CALC, serializeCalc, type ExternalBuff } from "../core/scenario.js";
import type { IndexEntry, IndexEntryServant, Servant } from "../core/model.js";
import {
  loadTemplates,
  removeTemplate,
  saveTemplate,
  suggestName,
  SEED_TEMPLATES,
} from "./templates.js";

const index = JSON.parse(readFileSync("public/data/index.json", "utf8")) as IndexEntry[];
const servants = index.filter((e): e is IndexEntryServant => e.kind === "servant");
const nameOf = (id: number) => servants.find((s) => s.id === id)?.name ?? `servant ${id}`;
const load = (id: number) => JSON.parse(readFileSync(`public/data/servant/${id}.json`, "utf8")) as Servant;

/** `localStorage` de mentira: um Map, e nada de global. */
function fakeStore(initial?: string) {
  const box = new Map<string, string>();
  if (initial !== undefined) box.set("fgo.buffTemplates.v1", initial);
  return {
    getItem: (k: string) => box.get(k) ?? null,
    setItem: (k: string, v: string) => void box.set(k, v),
    box,
  };
}

const castoria: ExternalBuff = {
  servantId: 504500,
  skills: [1, 3],
  skillLevel: 10,
  targetsAttacker: true,
  np: null,
  ce: null,
};

describe("as sementes", () => {
  it("são duas, e são as que o projeto prometeu", () => {
    expect(SEED_TEMPLATES.map((t) => t.name)).toEqual([
      "Double Castoria",
      "Double Koyanskaya (Light) + Oberon",
    ]);
  });

  it("nenhuma fonte se perde no caminho — a string tem que passar pelo parser", () => {
    // Um id ou uma vírgula errada devolveria `null` e sumiria calada; o
    // template ficaria menor do que o nome dele diz.
    expect(SEED_TEMPLATES.map((t) => t.sources.length)).toEqual([2, 3]);
  });

  it("apontam para servos que existem no dump", () => {
    for (const t of SEED_TEMPLATES) {
      for (const s of t.sources) {
        expect(servants.find((x) => x.id === s.servantId), `${t.name}: ${s.servantId}`).toBeDefined();
      }
    }
  });

  it("as skills existem, e todas mexem em dano", () => {
    // Uma skill sem buff de dano dentro de uma semente do projeto apareceria na
    // tela rotulada "no damage buff" — o próprio template contradizendo a tela.
    for (const t of SEED_TEMPLATES) {
      for (const src of t.sources) {
        const doc = load(src.servantId);
        for (const num of src.skills) {
          const skill = doc.skills.find((sk) => sk.num === num);
          expect(skill, `${doc.name} skill ${num}`).toBeDefined();
          const buffs = skill!.effects.filter((e) => e.buffType !== null);
          expect(buffs.length, `${doc.name} skill ${num} não buffa nada`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("guardar e ler", () => {
  it("sobrevive à ida e volta", () => {
    const store = fakeStore();
    const rich: ExternalBuff = {
      servantId: 2800100,
      skills: [1, 3],
      skillLevel: 7,
      targetsAttacker: false,
      np: { level: 4, overcharge: 3 },
      ce: { id: 9300010, mlb: true },
    };
    expect(saveTemplate("mine", [castoria, rich], store).ok).toBe(true);
    expect(loadTemplates(store)).toEqual([{ name: "mine", sources: [castoria, rich] }]);
  });

  it("guarda referência, não valor — o que está no disco é o pedaço de link", () => {
    // É isto que faz um template envelhecer bem: nenhum número resolvido, só
    // quem e quais skills. Rebalanceamento entra no próximo `data:sync`.
    const store = fakeStore();
    saveTemplate("mine", [castoria], store);
    const raw = store.box.get("fgo.buffTemplates.v1")!;
    expect(JSON.parse(raw)).toEqual([{ name: "mine", sources: ["504500:1,3"] }]);
    expect(raw).not.toMatch(/atkMod|upAtk|\b50\b/);
  });

  it("mesmo nome substitui em vez de duplicar", () => {
    const store = fakeStore();
    saveTemplate("comp", [castoria], store);
    saveTemplate("comp", [castoria, castoria], store);
    const all = loadTemplates(store);
    expect(all).toHaveLength(1);
    expect(all[0]!.sources).toHaveLength(2);
  });

  it("apagar tira só o que foi pedido", () => {
    const store = fakeStore();
    saveTemplate("a", [castoria], store);
    saveTemplate("b", [castoria], store);
    expect(removeTemplate("a", store).ok).toBe(true);
    expect(loadTemplates(store).map((t) => t.name)).toEqual(["b"]);
  });

  it("nome vazio não vira template, e diz por quê", () => {
    const r = saveTemplate("   ", [castoria], fakeStore());
    expect(r).toEqual({ ok: false, reason: "give the template a name first" });
  });

  it("lista vazia não vira template, e diz por quê", () => {
    const r = saveTemplate("nada", [], fakeStore());
    expect(r.ok).toBe(false);
  });
});

describe("dado estragado", () => {
  it("blob que não é JSON vira lista vazia, e não derruba a tela", () => {
    expect(loadTemplates(fakeStore("{{{"))).toEqual([]);
  });

  it("template com uma fonte ilegível é descartado inteiro", () => {
    // Meio template é pior que nenhum: "Double Castoria" com uma Castoria só
    // aplicaria metade do buff sob um nome que promete o dobro.
    const store = fakeStore(JSON.stringify([
      { name: "bom", sources: ["504500:1,3"] },
      { name: "quebrado", sources: ["504500:1,3", "lixo"] },
    ]));
    expect(loadTemplates(store).map((t) => t.name)).toEqual(["bom"]);
  });

  it("entrada sem nome ou sem fonte não entra", () => {
    const store = fakeStore(JSON.stringify([{ sources: ["504500:1"] }, { name: "x", sources: [] }, 7, null]));
    expect(loadTemplates(store)).toEqual([]);
  });
});

describe("sem armazenamento", () => {
  const dead = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  };

  it("ler devolve lista vazia", () => {
    expect(loadTemplates(dead)).toEqual([]);
  });

  it("salvar recusa com motivo visível, em vez de fingir que salvou", () => {
    const r = saveTemplate("mine", [castoria], dead);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/could not save/);
  });
});

describe("o nome sugerido", () => {
  it("duas cópias do mesmo é 'Double'", () => {
    expect(suggestName([castoria, castoria], nameOf)).toBe("Double Altria Caster");
  });

  it("mistura conta as repetições e mantém a ordem de entrada", () => {
    const koya = { ...castoria, servantId: 604200 };
    const oberon = { ...castoria, servantId: 2800100 };
    expect(suggestName([koya, koya, oberon], nameOf)).toBe("Koyanskaya of Light x2 + Oberon");
  });

  it("um só é o nome dele", () => {
    expect(suggestName([castoria], nameOf)).toBe("Altria Caster");
  });

  it("lista vazia não inventa nome", () => {
    expect(suggestName([], nameOf)).toBe("");
  });
});

describe("o template não vaza para o link", () => {
  it("a URL leva os buffs expandidos, e nenhuma chave de template", () => {
    // Um `tpl=` só teria sentido no navegador de quem criou. Quem recebesse o
    // link veria o cenário errado — ou nenhum — sem jeito de perceber.
    const seedComp = SEED_TEMPLATES[0]!;
    const url = serializeCalc({ ...DEFAULT_CALC, servantId: 100100, externals: seedComp.sources }).toString();
    expect(url).toContain("sup=504500");
    expect(url).not.toMatch(/tpl|name|Double/i);
  });

  it("cada fonte vira um parâmetro próprio — duas cópias continuam duas", () => {
    const p = serializeCalc({ ...DEFAULT_CALC, externals: SEED_TEMPLATES[0]!.sources });
    expect(p.getAll("sup")).toHaveLength(2);
  });
});
