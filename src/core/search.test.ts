/**
 * Testes do motor de busca contra o índice REAL (public/data/index.json).
 *
 * Usar o índice real em vez de fixtures é deliberado: o que quebra na prática é
 * o dado, não a lógica. Se o Atlas mudar algo que afete a busca, estes testes
 * falham junto com `data:validate`.
 *
 * Requer `npm run data:build`.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { IndexEntry, IndexEntryServant } from "./model.js";
import { EMPTY_FILTERS, facetCounts, normalize, search, statKindOf, type SearchFilters } from "./search.js";

const index = JSON.parse(readFileSync("public/data/index.json", "utf8")) as IndexEntry[];
const servants = index.filter((e): e is IndexEntryServant => e.kind === "servant");

const F = (over: Partial<SearchFilters> = {}): SearchFilters => ({ ...EMPTY_FILTERS, ...over });

describe("normalize", () => {
  it("remove acentos — 'scathach' precisa achar 'Scáthach'", () => {
    expect(normalize("Scáthach")).toBe("scathach");
  });

  it("lida com os nomes exóticos do roster", () => {
    expect(normalize("Aŋra Mainiiu")).toBe("a ra mainiiu");
    expect(normalize("Jeanne d'Arc (Alter)")).toBe("jeanne d arc alter");
  });
});

describe("busca por texto", () => {
  it("acha por nome parcial", () => {
    const r = search(index, F({ text: "merlin" }));
    expect(r.map((e) => e.name)).toContain("Merlin");
  });

  it("acha por apelido que NÃO aparece no nome real", () => {
    // "AUO" só existe em data/aliases.json — se a tabela não for carregada no
    // build, este teste falha. É o canário do pipeline de apelidos.
    const r = search(index, F({ text: "auo" }));
    expect(r.map((e) => e.name)).toContain("Gilgamesh");
  });

  it("nome de iniciais pontuadas é achável colado", () => {
    // "C.I.E.L" normaliza para quatro termos de uma letra, e cada um casa como
    // substring: digitar o nome como ele se escreve devolve 600 resultados. O
    // apelido é o que dá uma consulta que funciona.
    const r = search(index, F({ text: "ciel" }));
    expect(r.map((e) => e.name)).toEqual(["Mysterious Executor C.I.E.L"]);
  });

  it("acha sem acento", () => {
    expect(search(index, F({ text: "scathach" })).length).toBeGreaterThan(0);
  });

  it("termos são AND e independem da ordem", () => {
    const a = search(index, F({ text: "altria alter" }));
    const b = search(index, F({ text: "alter altria" }));
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
    expect(a.length).toBeGreaterThan(0);
  });

  it("acha por collectionNo", () => {
    const r = search(index, F({ text: "150" }));
    expect(r.some((e) => e.collectionNo === 150)).toBe(true);
  });
});

describe("facetas de servo", () => {
  it("filtra por classe", () => {
    const r = search(index, F({ className: ["saber"] }));
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((e) => e.kind === "servant" && e.className === "saber")).toBe(true);
  });

  it("classes múltiplas são OR", () => {
    const saber = search(index, F({ className: ["saber"] })).length;
    const archer = search(index, F({ className: ["archer"] })).length;
    expect(search(index, F({ className: ["saber", "archer"] })).length).toBe(saber + archer);
  });

  it("filtra por alvo de NP e cobre todo o roster", () => {
    const st = search(index, F({ npTarget: ["st"] })).length;
    const aoe = search(index, F({ npTarget: ["aoe"] })).length;
    const sup = search(index, F({ npTarget: ["support"] })).length;
    expect(st + aoe + sup).toBe(servants.length);
    expect([st, aoe, sup]).toEqual([174, 238, 50]);
  });

  it("filtra por card do NP", () => {
    const r = search(index, F({ npCard: ["buster"] }));
    expect(r.every((e) => e.kind === "servant" && e.npCard === "buster")).toBe(true);
  });

  it("filtra welfare", () => {
    expect(search(index, F({ welfare: true })).length).toBe(56);
    expect(search(index, F({ welfare: false })).length).toBe(servants.length - 56);
  });

  it("traits múltiplos são AND", () => {
    const divine = servants.find((s) => s.traitIds.length >= 2)!;
    const [a, b] = divine.traitIds;
    const both = search(index, F({ traitIds: [a!, b!] }));
    const onlyA = search(index, F({ traitIds: [a!] }));
    expect(both.length).toBeLessThanOrEqual(onlyA.length);
    expect(both.some((e) => e.id === divine.id)).toBe(true);
  });

  it("filtros de servo não vazam para CE", () => {
    const r = search(index, F({ kind: "equip", className: ["saber"] }));
    expect(r.every((e) => e.kind === "equip")).toBe(true);
    expect(r.length).toBe(search(index, F({ kind: "equip" })).length);
  });
});

describe("facetas de craft essence", () => {
  it("separa combat de farm", () => {
    const combat = search(index, F({ kind: "equip", category: ["combat"] })).length;
    const farm = search(index, F({ kind: "equip", category: ["farm"] })).length;
    expect(combat).toBe(1309);
    expect(farm).toBe(840);
    expect(combat + farm).toBe(2149);
  });

  describe("que status a CE dá", () => {
    const n = (...kinds: string[]) => search(index, F({ kind: "equip", statKind: kinds })).length;

    it("as três opções particionam o catálogo", () => {
      // Nenhuma CE fica de fora e nenhuma entra duas vezes — é o que autoriza
      // a partição em vez de duas caixas independentes.
      expect([n("atk"), n("hp"), n("both")]).toEqual([386, 156, 1607]);
      expect(n("atk", "hp", "both")).toBe(2149);
    });

    it("marcar duas soma, porque a faceta é OR", () => {
      // "dá ATK" é o par ATK + ambas. Com caixas independentes isso não teria
      // como ser dito sem também dizer "dá HP".
      expect(n("atk", "both")).toBe(386 + 1607);
      expect(n("hp", "both")).toBe(156 + 1607);
    });

    it("o rótulo corresponde ao que a CE tem de fato", () => {
      const equips = search(index, F({ kind: "equip" })).filter((e) => e.kind === "equip");
      for (const e of equips) {
        const k = statKindOf(e);
        expect([k, e.atkAtDefault > 0, e.hpAtDefault > 0]).toEqual([
          k,
          k !== "hp",
          k !== "atk",
        ]);
      }
    });

    it("combina com as outras facetas em vez de substituí-las", () => {
      const combatAtk = search(index, F({ kind: "equip", category: ["combat"], statKind: ["atk"] })).length;
      expect(combatAtk).toBeGreaterThan(0);
      expect(combatAtk).toBeLessThan(n("atk"));
    });
  });
});

describe("ordenação", () => {
  it("ordena por ATK decrescente", () => {
    const r = search(index, F({ sort: "atk", dir: "desc" }));
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1]!.atkAtDefault).toBeGreaterThanOrEqual(r[i]!.atkAtDefault);
    }
  });

  it("ordena por nome de forma estável", () => {
    const a = search(index, F({ sort: "name", dir: "asc" })).map((e) => e.id);
    const b = search(index, F({ sort: "name", dir: "asc" })).map((e) => e.id);
    expect(a).toEqual(b);
  });
});

describe("contagem de facetas", () => {
  it("ignora a própria dimensão para o usuário poder trocar de filtro", () => {
    const filters = F({ className: ["saber"] });
    const counts = facetCounts(index, filters, "className", (e) =>
      e.kind === "servant" ? e.className : null,
    );
    // Mesmo com "saber" marcado, archer continua contando > 0.
    expect(counts.get("archer")!).toBeGreaterThan(0);
    expect(counts.get("saber")!).toBe(search(index, F({ className: ["saber"] })).length);
  });

  it("respeita as outras dimensões", () => {
    const counts = facetCounts(index, F({ rarity: [5], className: ["saber"] }), "className", (e) =>
      e.kind === "servant" ? e.className : null,
    );
    expect(counts.get("saber")!).toBe(search(index, F({ rarity: [5], className: ["saber"] })).length);
  });
});
