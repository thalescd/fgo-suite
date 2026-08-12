/**
 * Testes da calculadora, contra os dados reais.
 *
 * Cada teste isola **um termo** da fórmula e verifica a razão entre dois
 * cenários que diferem só naquele termo — vantagem de classe deve dobrar,
 * crítico deve dobrar, NP5/NP1 deve dar 600/400. Comparar razões em vez de
 * números absolutos testa a fórmula sem depender de um valor de referência
 * externo, que não temos.
 *
 * ⚠️ Isto prova que a implementação corresponde a `damage_formula.txt`.
 * **Não** prova que o resultado bate com o jogo — R4 continua aberto e precisa
 * de um conjunto de valores conhecidos in-game.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { calculateDamage, type DamageData, type DamageInput, type Enemy } from "./damage.js";
import type { Constants, CraftEssence, IndexEntry, IndexEntryServant, MysticCode, Servant } from "./model.js";

const index = JSON.parse(readFileSync("public/data/index.json", "utf8")) as IndexEntry[];
const constants = JSON.parse(readFileSync("public/data/constants.json", "utf8")) as Constants;
const mysticCodes = JSON.parse(readFileSync("public/data/mysticCodes.json", "utf8")) as MysticCode[];
const servantIndex = index.filter((e): e is IndexEntryServant => e.kind === "servant");

const loadServant = (cn: number): Servant =>
  JSON.parse(
    readFileSync(`public/data/servant/${servantIndex.find((s) => s.collectionNo === cn)!.id}.json`, "utf8"),
  ) as Servant;
const loadEquip = (cn: number): CraftEssence => {
  const e = index.find((x) => x.kind === "equip" && x.collectionNo === cn)!;
  return JSON.parse(readFileSync(`public/data/equip/${e.id}.json`, "utf8")) as CraftEssence;
};

const ARTORIA = loadServant(2); // saber, Excalibur AoE buster 400..600%
const GIL = loadServant(12); // archer, super-efetivo vs weakToEnumaElish, buff próprio antes do dano
const KALEID = loadEquip(34);

const data: DamageData = {
  servants: new Map([ARTORIA, GIL].map((s) => [s.id, s])),
  equips: new Map([[KALEID.id, KALEID]]),
  mysticCodes: new Map(mysticCodes.map((m) => [m.id, m])),
  constants,
};

const enemy = (over: Partial<Enemy> = {}): Enemy => ({
  className: "shielder", // neutro contra todo mundo
  attribute: "human",
  traits: [],
  defMod: 0,
  specialDefMod: 0,
  ...over,
});

const input = (over: Partial<DamageInput> = {}): DamageInput => ({
  attacker: { servantId: ARTORIA.id, level: 90, fou: 1000, npLevel: 1, overcharge: 1 },
  buffStack: [],
  enemy: enemy(),
  action: { kind: "np", isCrit: false, busterChain: false, braveChain: false },
  options: { rollMode: "avg" },
  ...over,
});

const dmg = (i: DamageInput) => calculateDamage(i, data).avg;
const ratio = (a: number, b: number) => a / b;

describe("termos da fórmula", () => {
  it("ATK vem de atkGrowth + fou, nunca de atkMax", () => {
    const r = calculateDamage(input(), data);
    // lv90 = 11221 (o antigo atkMax) + 1000 fou
    expect(r.breakdown.servantAtk).toBe(12221);
    // lv120 usa o crescimento completo, 28% acima — o erro que R7 evita
    const r120 = calculateDamage(input({ attacker: { servantId: ARTORIA.id, level: 120, fou: 1000, npLevel: 1, overcharge: 1 } }), data);
    expect(r120.breakdown.servantAtk).toBe(15418);
  });

  it("vantagem de classe dobra o dano (saber -> lancer)", () => {
    const neutro = dmg(input({ enemy: enemy({ className: "saber" }) }));
    const vantagem = dmg(input({ enemy: enemy({ className: "lancer" }) }));
    expect(ratio(vantagem, neutro)).toBeCloseTo(2, 2);
  });

  it("desvantagem de classe corta pela metade (saber -> archer)", () => {
    const neutro = dmg(input({ enemy: enemy({ className: "saber" }) }));
    const ruim = dmg(input({ enemy: enemy({ className: "archer" }) }));
    expect(ratio(ruim, neutro)).toBeCloseTo(0.5, 2);
  });

  it("afinidade de atributo aplica 1.1x (earth -> ?)", () => {
    // Artoria é earth. earth -> sky = 1.1 na matriz.
    const neutro = dmg(input({ enemy: enemy({ attribute: "earth" }) }));
    const bom = dmg(input({ enemy: enemy({ attribute: "sky" }) }));
    expect(ratio(bom, neutro)).toBeCloseTo(constants.attributeRelation.earth.sky, 2);
  });

  it("nível de NP escala pelo multiplicador (NP5/NP1 = 600/400)", () => {
    const np1 = dmg(input());
    const np5 = dmg(input({ attacker: { servantId: ARTORIA.id, level: 90, fou: 1000, npLevel: 5, overcharge: 1 } }));
    expect(ratio(np5, np1)).toBeCloseTo(600 / 400, 3);
  });

  it("crítico dobra", () => {
    const normal = dmg(input({ action: { kind: "card", card: "buster", position: 1, isCrit: false, busterChain: false, braveChain: false } }));
    const crit = dmg(input({ action: { kind: "card", card: "buster", position: 1, isCrit: true, busterChain: false, braveChain: false } }));
    expect(ratio(crit, normal)).toBeCloseTo(constants.criticalAttackRate, 2);
  });

  it("card em 3ª posição rende mais que em 1ª", () => {
    const p1 = dmg(input({ action: { kind: "card", card: "arts", position: 1, isCrit: false, busterChain: false, braveChain: false } }));
    const p3 = dmg(input({ action: { kind: "card", card: "arts", position: 3, isCrit: false, busterChain: false, braveChain: false } }));
    // arts 1.0 -> 1.4
    expect(ratio(p3, p1)).toBeCloseTo(1.4, 2);
  });

  it("Buster em 1ª posição ganha o firstCardBonus de 0.5", () => {
    const r = calculateDamage(
      input({ action: { kind: "card", card: "buster", position: 1, isCrit: false, busterChain: false, braveChain: false } }),
      data,
    );
    // cardTerm = 0.5 + 1.5 * (1 + 0)
    expect(r.breakdown.cardTerm).toBeCloseTo(2.0, 5);
  });

  it("NP NÃO ganha o firstCardBonus, mesmo sendo Buster", () => {
    const r = calculateDamage(input(), data); // Excalibur é buster
    expect(r.breakdown.cardTerm).toBeCloseTo(1.5, 5);
  });

  it("buster chain soma 0.2 x ATK num card Buster — e nada num NP Buster", () => {
    const atk = ARTORIA.atkGrowth[89]! + 1000;
    const card = (busterChain: boolean) =>
      calculateDamage(
        input({ action: { kind: "card", card: "buster", position: 1, isCrit: false, busterChain, braveChain: false } }),
        data,
      );
    expect(card(true).breakdown.busterChainBonus).toBeCloseTo(atk * constants.busterChainMod, 5);
    expect(card(true).avg).toBeGreaterThan(card(false).avg);

    // Excalibur é Buster, mas uma chain é feita de três command cards e um NP
    // não é command card — jamais entra em uma.
    const np = (busterChain: boolean) =>
      calculateDamage(input({ action: { kind: "np", isCrit: false, busterChain, braveChain: false } }), data);
    expect(ARTORIA.np!.card).toBe("buster");
    expect(np(true).breakdown.busterChainBonus).toBe(0);
    expect(np(true).avg).toBe(np(false).avg);
  });

  it("NP ignora isCrit, porque NP não critica", () => {
    const plain = calculateDamage(input({ action: { kind: "np", isCrit: false, busterChain: false, braveChain: false } }), data);
    const asked = calculateDamage(input({ action: { kind: "np", isCrit: true, busterChain: false, braveChain: false } }), data);
    expect(asked.avg).toBe(plain.avg);
    expect(asked.breakdown.criticalModifier).toBe(1);
    expect(asked.breakdown.isCrit).toBe(false);
  });

  it("rollMode min/max são 0.9 e 1.1 da média", () => {
    const r = calculateDamage(input(), data);
    expect(r.min / r.avg).toBeCloseTo(0.9, 2);
    expect(r.max / r.avg).toBeCloseTo(1.1, 2);
  });

  it("dano nunca é menor que 1", () => {
    const r = calculateDamage(
      input({ enemy: enemy({ className: "archer", defMod: 900 }) }),
      data,
    );
    expect(r.avg).toBeGreaterThanOrEqual(1);
  });

  it("hits do NP somam o total", () => {
    const r = calculateDamage(input(), data);
    expect(r.perHit.reduce((a, b) => a + b, 0)).toBeCloseTo(r.avg, -1);
  });
});

describe("super-efetivo", () => {
  const gilInput = (over: Partial<DamageInput["attacker"]> = {}, e: Partial<Enemy> = {}) =>
    input({
      attacker: { servantId: GIL.id, level: 90, fou: 1000, npLevel: 1, overcharge: 1, ...over },
      enemy: enemy(e),
    });

  it("não aplica contra alvo sem o trait", () => {
    const r = calculateDamage(gilInput(), data);
    expect(r.breakdown.superEffectiveModifier).toBe(100);
  });

  it("aplica 150% contra weakToEnumaElish no OC1", () => {
    const r = calculateDamage(gilInput({}, { traits: [{ id: 2008, name: "weakToEnumaElish" }] }), data);
    expect(r.breakdown.superEffectiveModifier).toBe(150);
  });

  it("sobe para 200% no OC5 — a escala de overcharge que faltava", () => {
    const r = calculateDamage(gilInput({ overcharge: 5 }, { traits: [{ id: 2008, name: "weakToEnumaElish" }] }), data);
    expect(r.breakdown.superEffectiveModifier).toBe(200);
  });

  it("o multiplicador entra no dano final", () => {
    const sem = calculateDamage(gilInput(), data).avg;
    const com = calculateDamage(gilInput({}, { traits: [{ id: 2008, name: "weakToEnumaElish" }] }), data).avg;
    expect(ratio(com, sem)).toBeCloseTo(1.5, 2);
  });
});

describe("ordem de execução do NP (R20)", () => {
  it("Gilgamesh: o buff antes do dano entra no próprio golpe", () => {
    const sem = calculateDamage(input({ attacker: { servantId: GIL.id, level: 90, fou: 1000, npLevel: 1, overcharge: 1 } }), data).avg;
    const com = calculateDamage(
      input({
        attacker: { servantId: GIL.id, level: 90, fou: 1000, npLevel: 1, overcharge: 1 },
        buffStack: [{ kind: "npSelfBuff" }],
      }),
      data,
    );
    // upNpdamage 30% -> termo (1 + npDamageMod) = 1.3
    expect(com.breakdown.npDamageMod).toBeCloseTo(0.3, 5);
    expect(ratio(com.avg, sem)).toBeCloseTo(1.3, 2);
  });

  it("Artoria: o que vem depois do dano não entra", () => {
    // O NP dela tem gainNp e hastenNpturn DEPOIS do dano; nenhum é slot de dano.
    const com = calculateDamage(input({ buffStack: [{ kind: "npSelfBuff" }] }), data);
    expect(com.assumptions.appliedBuffs).toHaveLength(0);
  });
});

describe("condições de buff", () => {
  it("buff restrito a Buster não vale num card Arts (R11)", () => {
    // Skill 2 da Artoria: upCommandall com condSelf [cardBuster].
    // (A skill 1 também tem upCommandall, mas restrito a cardExtra.)
    const arts = calculateDamage(
      input({
        buffStack: [{ kind: "ownSkill", skillNum: 2, level: 10 }],
        action: { kind: "card", card: "arts", position: 1, isCrit: false, busterChain: false, braveChain: false },
      }),
      data,
    );
    const buster = calculateDamage(
      input({
        buffStack: [{ kind: "ownSkill", skillNum: 2, level: 10 }],
        action: { kind: "card", card: "buster", position: 1, isCrit: false, busterChain: false, braveChain: false },
      }),
      data,
    );
    expect(buster.breakdown.cardMod).toBeGreaterThan(arts.breakdown.cardMod);
    expect(arts.assumptions.skippedBuffs.some((s) => s.reason.includes("cardBuster"))).toBe(true);
  });

  it("buff de Buster VALE num NP Buster — o card vem do NP, não da ação", () => {
    // Excalibur é Buster; a skill 2 dá upCommandall [cardBuster]. Ler
    // `action.card` (indefinido num NP) em vez do card do NP descartava o buff
    // e zerava o cardMod. O bug só apareceu ao inspecionar `skippedBuffs`.
    const r = calculateDamage(
      input({ buffStack: [{ kind: "ownSkill", skillNum: 2, level: 10 }] }),
      data,
    );
    expect(ARTORIA.np!.card).toBe("buster");
    expect(r.breakdown.cardMod).toBeGreaterThan(0);
    expect(r.assumptions.appliedBuffs.some((b) => b.buffType === "upCommandall")).toBe(true);
  });

  it("buff de Buster não vale num NP Arts", () => {
    // Gilgamesh: Enuma Elish é Buster... conferido pelo próprio dado.
    const busterNp = ARTORIA.np!.card === "buster";
    expect(busterNp).toBe(true);
    // Ação de card Arts com o mesmo buff: precisa ser descartado.
    const arts = calculateDamage(
      input({
        buffStack: [{ kind: "ownSkill", skillNum: 2, level: 10 }],
        action: { kind: "card", card: "arts", position: 1, isCrit: false, busterChain: false, braveChain: false },
      }),
      data,
    );
    expect(arts.breakdown.cardMod).toBe(0);
  });

  it("buff pulado é reportado, nunca sumido em silêncio", () => {
    const r = calculateDamage(
      input({
        buffStack: [{ kind: "ownSkill", skillNum: 1, level: 10 }],
        action: { kind: "card", card: "quick", position: 1, isCrit: false, busterChain: false, braveChain: false },
      }),
      data,
    );
    for (const s of r.assumptions.skippedBuffs) expect(s.reason).toBeTruthy();
  });

  it("CE entra com ATK e efeito", () => {
    const sem = calculateDamage(input(), data);
    const com = calculateDamage(
      input({
        attacker: { servantId: ARTORIA.id, level: 90, fou: 1000, npLevel: 1, overcharge: 1, ce: { id: KALEID.id, level: 100, mlb: true } },
      }),
      data,
    );
    expect(com.breakdown.servantAtk).toBe(sem.breakdown.servantAtk + 2000);
  });
});

describe("assumptions", () => {
  it("sempre relata o que assumiu", () => {
    const r = calculateDamage(input(), data);
    expect(r.assumptions.resolved).toContain("NP1");
    expect(r.assumptions.resolved).toContain("1000 fou");
    expect(r.assumptions.rollMode).toBe("avg");
  });

  it("buff com chance < 100% é aplicado mas registrado", () => {
    // Nada filtra por chance (D18); o registro é o que mantém a resposta honesta.
    const r = calculateDamage(input({ buffStack: [{ kind: "ownSkill", skillNum: 1, level: 10 }] }), data);
    for (const u of r.assumptions.uncertainBuffs) expect(u.chance).toBeLessThan(100);
  });
});
