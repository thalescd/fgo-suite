/**
 * As tools do MCP, sem transporte.
 *
 * O que se testa aqui é o contrato com o assistente: que um filtro errado seja
 * dito em voz alta em vez de virar lista vazia, que o cálculo passe pelo mesmo
 * caminho da tela, e que as ressalvas cheguem junto com o número.
 */

import { readFileSync } from "node:fs";
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
    // CE e Mystic Code saíram desta lista na 5a; citá-los agora seria mentira
    // na direção oposta — dizer que não modela o que modela.
    expect(r.notModelledAtAll).not.toMatch(/Craft Essence/);
    expect(r.notModelledAtAll).toMatch(/Support servants/);
    expect(r.validation).toMatch(/\d+\/\d+ scenarios verified/);
  });

  it("o estado da validação é lido do arquivo, não escrito à mão", () => {
    // Se fosse literal, envelheceria calado enquanto os casos são preenchidos.
    //
    // A contagem sai do próprio `validation.json`, e não de um número escrito
    // aqui: a primeira versão dizia "4/16" e quebrou no dia em que três casos
    // foram conferidos — atrito sem valor, porque o que se quer provar é que a
    // ressalva acompanha o arquivo, não qual é o número de hoje.
    const f = JSON.parse(readFileSync("data/validation.json", "utf8")) as {
      cases: { expected: number | null }[];
    };
    const done = f.cases.filter((c) => c.expected !== null).length;
    expect(validationState()).toBe(`${done}/${f.cases.length} scenarios verified against an external calculator`);
    expect(done).toBeGreaterThan(0);
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

describe("calculate_damage: contagem de stacks (R27)", () => {
  it("cada lado lê o seu parâmetro, e o link carrega o número", () => {
    const at = (a: Record<string, unknown>) =>
      calculateDamageTool(store, { servant: "charlemagne", ...a }) as {
        damage: { average: number };
        viewInBrowser: string;
        formulaTerms: { superEffectiveStacksCounted?: number; superEffective?: string };
      };
    const zero = at({});
    const cheio = at({ stacksOnSelf: 12 });

    expect(cheio.damage.average).toBeGreaterThan(zero.damage.average);
    expect(cheio.formulaTerms.superEffectiveStacksCounted).toBe(12);
    expect(cheio.formulaTerms.superEffective).toBe("220%");
    expect(parseCalc(new URLSearchParams(cheio.viewInBrowser.split("?")[1])).stacksSelf).toBe(12);

    // Charlemagne conta em si: o parâmetro do alvo não pode fazer nada por ele.
    expect(at({ stacksOnTarget: 12 }).damage.average).toBe(zero.damage.average);
  });

  it("o espelho: Romulus conta no alvo", () => {
    const at = (a: Record<string, unknown>) =>
      (calculateDamageTool(store, { servant: "Romulus=Quirinus", ...a }) as { damage: { average: number } })
        .damage.average;
    expect(at({ stacksOnSelf: 10 })).toBe(at({}));
    expect(at({ stacksOnTarget: 10 })).toBeGreaterThan(at({}));
  });

  it("get_servant diz qual trait, que lado e o teto", () => {
    const r = getServant(store, "charlemagne") as { noblePhantasms: { effectsInExecutionOrder: string[] }[] };
    const linha = r.noblePhantasms.flatMap((n) => n.effectsInExecutionOrder).find((l) => /stacks/.test(l));
    expect(linha).toMatch(/own Heroic King stacks/);
    expect(linha).toMatch(/up to 12/);
    expect(linha).toMatch(/stacksOnSelf/);
  });
});

describe("calculate_damage: Craft Essence e Mystic Code (5a)", () => {
  const dmg = (a: Record<string, unknown>) =>
    calculateDamageTool(store, { servant: "artoria", ...a }) as {
      damage: { average: number };
      formulaTerms: { servantAtk: number; npDamageMod?: number; atkMod?: number };
      craftEssence?: string;
      mysticCode?: string;
      notFound?: string[];
      viewInBrowser: string;
    };

  it("CE por nome traz ATK e efeito no mesmo gesto", () => {
    const sem = dmg({});
    const com = dmg({ craftEssence: "The Black Grail" });
    expect(com.craftEssence).toBe("The Black Grail");
    expect(com.formulaTerms.servantAtk).toBe(sem.formulaTerms.servantAtk + 2400);
    expect(com.formulaTerms.npDamageMod).toBeCloseTo(0.6, 5);
  });

  it("MLB troca o conjunto de efeitos e aparece no rótulo", () => {
    const base = dmg({ craftEssence: "The Black Grail" });
    const mlb = dmg({ craftEssence: "The Black Grail", ceMlb: true });
    expect(mlb.formulaTerms.npDamageMod).toBeCloseTo(0.8, 5);
    expect(mlb.craftEssence).toMatch(/MLB/);
    expect(mlb.damage.average).toBeGreaterThan(base.damage.average);
  });

  it("Mystic Code por nome, e só as skills pedidas", () => {
    const semSkill = dmg({ mysticCode: "Chaldea Combat Uniform" });
    expect(semSkill.mysticCode).toMatch(/Chaldea Combat Uniform/);
    expect(semSkill.formulaTerms.atkMod ?? 0).toBe(0);
    const comSkill = dmg({ mysticCode: "Chaldea Combat Uniform", mysticCodeSkills: [1] });
    expect(comSkill.formulaTerms.atkMod).toBeCloseTo(0.3, 5);
  });

  it("referência que não resolve é dita, não engolida", () => {
    const r = dmg({ craftEssence: "Kaleidoscopio", mysticCode: "Uniforme Inexistente" });
    expect(r.notFound).toEqual(['craft essence "Kaleidoscopio"', 'mystic code "Uniforme Inexistente"']);
    // E o cálculo segue, sem o equipamento — o número é o de servo pelado.
    expect(r.formulaTerms.servantAtk).toBe(dmg({}).formulaTerms.servantAtk);
  });

  it("o link reproduz CE e MC na tela", () => {
    const r = dmg({ craftEssence: "The Black Grail", ceMlb: true, mysticCode: "20", mysticCodeSkills: [1] });
    const st = parseCalc(new URLSearchParams(r.viewInBrowser.split("?")[1]));
    expect([st.ceId, st.ceMlb, st.mcId, st.mcSkills]).toEqual([9400480, true, 20, [1]]);
  });
});
