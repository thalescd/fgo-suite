/**
 * As tools do MCP, sem transporte.
 *
 * O que se testa aqui é o contrato com o assistente: que um filtro errado seja
 * dito em voz alta em vez de virar lista vazia, que o cálculo passe pelo mesmo
 * caminho da tela, e que as ressalvas cheguem junto com o número.
 */

import { describe, expect, it } from "vitest";

import { calculateDamage, type DamageData } from "../core/damage.js";
import { parseCalc, toDamageInput } from "../core/scenario.js";
import { Store } from "./store.js";
import { calculateDamageTool, getServant, listCapabilities, searchServants, validationState } from "./tools.js";

const store = new Store();

describe("search_servants", () => {
  it("acha por capability, e a contagem bate com a da busca da tela", () => {
    const r = searchServants(store, { capabilities: ["np_charge_50_party"], limit: 3 });
    expect(r.total).toBe(9);
    expect(r.showing).toBe(3);
    expect(r.servants.map((s) => s.name)).toContain("Oberon");
  });

  it("combina capabilities com AND", () => {
    const um = searchServants(store, { capabilities: ["buster_up_party"] }).total;
    const tres = searchServants(store, {
      capabilities: ["buster_up_party", "atk_up_party", "np_charge_party"],
    }).total;
    expect(tres).toBeLessThan(um);
    expect(tres).toBe(13);
  });

  it("filtro que não existe é reportado, não vira lista vazia silenciosa", () => {
    const r = searchServants(store, { capabilities: ["np_charge_9000"], traits: ["hobbit"] });
    expect(r.total).toBe(0);
    expect(r.unknownCapabilities).toEqual(["np_charge_9000"]);
    expect(r.unknownTraits).toEqual(["hobbit"]);
  });

  it("busca textual herda apelido e acento do motor da tela", () => {
    expect(searchServants(store, { query: "auo" }).servants[0]?.name).toBe("Gilgamesh");
    expect(searchServants(store, { query: "scathach" }).total).toBeGreaterThan(0);
  });
});

describe("get_servant", () => {
  it("resolve por apelido, número e id", () => {
    for (const ref of ["artoria", "2", "100100"]) {
      const r = getServant(store, ref) as { name?: string };
      expect(r.name, ref).toBe("Altria Pendragon");
    }
  });

  it("servo inexistente devolve erro que diz o que fazer", () => {
    const r = getServant(store, "gandalf") as { error?: string };
    expect(r.error).toMatch(/search_servants/);
  });

  it("lista as variantes de NP com o multiplicador de cada uma (R24)", () => {
    const r = getServant(store, "melusine") as { noblePhantasms: { card: string; target: string; damageMultiplierByNpLevel: number[] | null }[] };
    expect(r.noblePhantasms).toHaveLength(2);
    const mults = r.noblePhantasms.map((n) => n.damageMultiplierByNpLevel?.[0]).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(mults).toEqual([300, 900]);
  });

  it("marca a ordem de execução do NP (D20)", () => {
    const gil = getServant(store, "gilgamesh") as { noblePhantasms: { effectsInExecutionOrder: string[] }[] };
    const lines = gil.noblePhantasms[0]!.effectsInExecutionOrder;
    expect(lines.some((l) => l.startsWith("[before damage]"))).toBe(true);
    expect(lines.some((l) => l.startsWith("[DAMAGE]"))).toBe(true);
    // Artoria causa dano primeiro: nada antes.
    const art = getServant(store, "artoria") as { noblePhantasms: { effectsInExecutionOrder: string[] }[] };
    expect(art.noblePhantasms[0]!.effectsInExecutionOrder.some((l) => l.startsWith("[before damage]"))).toBe(false);
  });

  it("diz que passiva de classe é automática e append não é (R22, D10)", () => {
    const r = getServant(store, "heracles") as { classPassiveNote: string; appendPassiveNote: string };
    expect(r.classPassiveNote).toMatch(/without being asked/);
    expect(r.appendPassiveNote).toMatch(/Off by default/);
  });
});

describe("calculate_damage", () => {
  it("dá o mesmo número que o núcleo pelo caminho da tela", () => {
    const query = "s=100100&sk=1,2,3&ec=lancer&ea=sky";
    const servant = store.servant(100100);
    const data: DamageData = {
      servants: new Map([[servant.id, servant]]),
      equips: new Map(),
      mysticCodes: new Map(),
      constants: store.constants,
    };
    const pelaTela = calculateDamage(
      toDamageInput(parseCalc(new URLSearchParams(query)), servant, (id) => store.traitName(id)),
      data,
    );
    const peloMcp = calculateDamageTool(store, {
      servant: "artoria",
      skills: [1, 2, 3],
      enemyClass: "lancer",
      enemyAttribute: "sky",
    }) as { damage: { average: number } };

    expect(peloMcp.damage.average).toBe(pelaTela.avg);
  });

  it("devolve um link que reproduz o mesmo cenário", () => {
    const r = calculateDamageTool(store, {
      servant: "artoria",
      npLevel: 5,
      overcharge: 3,
      enemyClass: "lancer",
    }) as { viewInBrowser: string; damage: { average: number } };

    const state = parseCalc(new URLSearchParams(r.viewInBrowser.split("?")[1]));
    expect([state.servantId, state.npLevel, state.overcharge, state.enemyClass]).toEqual([100100, 5, 3, "lancer"]);
  });

  it("o que não contou vem com o motivo, não sumido", () => {
    // Skill 2 da Artoria é Buster; num card Arts precisa ser recusada à vista.
    const r = calculateDamageTool(store, { servant: "artoria", action: "arts", skills: [2] }) as {
      notCounted: string[];
    };
    expect(r.notCounted.some((x) => /cardBuster/.test(x))).toBe(true);
  });

  it("passiva de classe entra sem ser pedida (R22)", () => {
    const r = calculateDamageTool(store, { servant: "heracles" }) as { buffsCounted: string[] };
    expect(r.buffsCounted.some((x) => /passive/.test(x))).toBe(true);
  });

  it("trait de inimigo por nome liga o super-efetivo; nome errado é reportado", () => {
    const com = calculateDamageTool(store, {
      servant: "gilgamesh",
      npLevel: 5,
      overcharge: 5,
      enemyTraits: ["weakToEnumaElish"],
    }) as { formulaTerms: { superEffective?: string } };
    expect(com.formulaTerms.superEffective).toBe("200%");

    const errado = calculateDamageTool(store, { servant: "gilgamesh", enemyTraits: ["weakToGandalf"] }) as {
      unknownEnemyTraits?: string[];
    };
    expect(errado.unknownEnemyTraits).toEqual(["weakToGandalf"]);
  });

  it("todo resultado carrega o que não é modelado e o estado da validação", () => {
    const r = calculateDamageTool(store, { servant: "artoria" }) as {
      notModelledAtAll: string;
      validation: string;
    };
    expect(r.notModelledAtAll).toMatch(/Craft Essences/);
    expect(r.validation).toMatch(/\d+\/\d+ scenarios verified/);
  });

  it("o estado da validação é lido do arquivo, não escrito à mão", () => {
    // Se fosse literal, envelheceria calado enquanto os casos são preenchidos.
    expect(validationState()).toBe("4/16 scenarios verified against an external calculator");
  });
});

describe("list_capabilities", () => {
  it("devolve as tags com contagem e o formato explicado", () => {
    const r = listCapabilities(store);
    expect(r.total).toBe(170);
    expect(r.format).toMatch(/cumulative/);
    expect(r.capabilities[0]!.servants).toBeGreaterThanOrEqual(r.capabilities[r.capabilities.length - 1]!.servants);
  });

  it("filtra por substring", () => {
    const r = listCapabilities(store, "np_charge");
    expect(r.matching).toBeGreaterThan(0);
    expect(r.matching).toBeLessThan(r.total);
    expect(r.capabilities.every((c) => c.tag.includes("np_charge"))).toBe(true);
  });
});

describe("calculate_damage: escala por HP (R25)", () => {
  it("hpPercent muda o número e o link reproduz o cenário", () => {
    const cheio = calculateDamageTool(store, { servant: "hijikata" }) as { damage: { average: number } };
    const ferido = calculateDamageTool(store, { servant: "hijikata", hpPercent: 20 }) as {
      damage: { average: number };
      viewInBrowser: string;
      formulaTerms: { npMultiplierFromMissingHp?: string; attackerHp?: string };
    };

    expect(ferido.damage.average).toBeGreaterThan(cheio.damage.average);
    expect(ferido.formulaTerms.attackerHp).toBe("20%");
    expect(ferido.formulaTerms.npMultiplierFromMissingHp).toBeDefined();
    expect(parseCalc(new URLSearchParams(ferido.viewInBrowser.split("?")[1])).hpPercent).toBe(20);
  });

  it("o overcharge deixa de ser inerte quando falta HP", () => {
    const at = (oc: number, hpPercent: number) =>
      (calculateDamageTool(store, { servant: "hijikata", overcharge: oc, hpPercent }) as { damage: { average: number } })
        .damage.average;
    // Antes de R25 estes dois eram iguais em qualquer HP.
    expect(at(1, 100)).toBe(at(5, 100));
    expect(at(5, 0)).toBeGreaterThan(at(1, 0));
  });

  it("um buff que escala com HP diz isso mesmo com HP cheio", () => {
    // Passionlip skill 2 valia `upAtk 0` e não avisava nada.
    const r = calculateDamageTool(store, { servant: "passionlip", action: "buster", skills: [2], hpPercent: 30 }) as {
      buffsCounted: string[];
    };
    const linha = r.buffsCounted.find((x) => /upAtk/.test(x));
    expect(linha).toMatch(/scales with HP/);
    expect(linha).toMatch(/0 at full HP/);
  });
});
