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

import { calculateDamage, selectableNps, type DamageData, type DamageInput, type Enemy } from "./damage.js";
import { parseCalc, toDamageInput } from "./scenario.js";
import type { CardType, Constants, CraftEssence, IndexEntry, IndexEntryServant, MysticCode, Servant } from "./model.js";

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
const OBERON = loadServant(316); // único servo com `buffRate`: dobra buffs de dano de NP (R21)
const KALEID = loadEquip(34);
// 5a — 2400 de ATK **e** upNpdamage 60/80: prende os dois caminhos da CE de uma
// vez, e separa `effectsBase` de `effectsMlb`.
const GRAIL = loadEquip(48);
// 5b — CE que buffa a PARTY: upAtk 15% -> ptFull, sem condição. É o que um
// suporte carrega para o time; o Black Grail é `self` e fica com ele.
const CROWN = loadEquip(191);
// R29 — CE de evento: dá ATK e upAtk como anuncia, mais um `upDamage` de 100%
// (200% no MLB) que só vale dentro do evento e não aparece na descrição.
const SUMO = loadEquip(261);

// R25 — os dois mecanismos de escala por HP, um servo por forma:
const CU = loadServant(17); // skill 1 `RatioHPLow` sobre um Value != 0: 20% -> 50% de ATK
const LEONIDAS = loadServant(21); // skill 1 `RatioHPLow` sobre Value 0: o buff inteiro é a escala
const LIP = loadServant(164); // única faixa (`RatioHPRange*`): só ativa em 50% de HP ou menos
const HIJIKATA = loadServant(161); // os dois mecanismos no mesmo servo: NP e crit damage
const ANNE = loadServant(66); // `damageNpHpratioLow` cujo bônus escala com overcharge

// R27 — `damageNpIndividualSum`, as duas formas:
const MUSASHI = loadServant(153); // super-efetivo fixo em `Value2`, sem contagem
const CHARLEMAGNE = loadServant(343); // base neutra + 10% por stack em si mesmo, até 12

const data: DamageData = {
  servants: new Map(
    [ARTORIA, GIL, OBERON, CU, LEONIDAS, LIP, HIJIKATA, ANNE, MUSASHI, CHARLEMAGNE].map((s) => [s.id, s]),
  ),
  equips: new Map([[KALEID.id, KALEID], [GRAIL.id, GRAIL], [SUMO.id, SUMO], [CROWN.id, CROWN]]),
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

  it("afinidade de atributo aplica o valor da matriz", () => {
    // Artoria é earth, e earth -> sky é 0.9 (não 1.1 — o comentário anterior
    // dizia o contrário; a asserção sempre leu a matriz, então nada quebrou).
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
    // A Divinity do Gilgamesh soma 175 planos FORA do produto, então a razão
    // dos danos finais não é 1,5 exata — sobra o mesmo termo nos dois lados.
    // Tirar `flatDamage` é o que isola o multiplicador, que é o que este teste
    // diz medir. Enquanto a Divinity valia 17,5 por engano, o desvio cabia na
    // tolerância e a distinção não aparecia.
    const produto = (r: ReturnType<typeof calculateDamage>) => r.avg - r.breakdown.flatDamage;
    const sem = produto(calculateDamage(gilInput(), data));
    const com = produto(calculateDamage(gilInput({}, { traits: [{ id: 2008, name: "weakToEnumaElish" }] }), data));
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

/**
 * Buffs que multiplicam o valor de outros buffs (R21).
 *
 * `damage_formula.txt` não prevê isto: o post é anterior ao Oberon, que é o
 * único servo do jogo com `buffRate`. Sem este tratamento, a skill 3 dele
 * apareceria como "não modelada" e o dano sairia calculado pela metade.
 */
describe("boost de buff — Oberon (R21)", () => {
  const ober = (over: Partial<DamageInput> = {}): DamageInput =>
    input({
      attacker: { servantId: OBERON.id, level: OBERON.lvMax, fou: 1000, npLevel: 1, overcharge: 1 },
      ...over,
    });
  const skill = (num: number, level = 10) => ({ kind: "ownSkill" as const, skillNum: num, level });

  it("a skill 3 dobra o buff de dano de NP: 30% vira 60%", () => {
    const semBoost = calculateDamage(ober({ buffStack: [skill(1)] }), data);
    const comBoost = calculateDamage(ober({ buffStack: [skill(1), skill(3)] }), data);

    expect(semBoost.breakdown.npDamageMod).toBeCloseTo(0.3, 5);
    expect(comBoost.breakdown.npDamageMod).toBeCloseTo(0.6, 5);

    const boosted = comBoost.assumptions.appliedBuffs.find((b) => b.buffType === "upNpdamage")!;
    expect(boosted.boostedFrom).toBe(30);
    expect(boosted.value).toBe(60);
  });

  it("o boost escala com o nível da skill — 50% no lv1", () => {
    // upNpdamage lv1 = 20%, boost lv1 = 50% -> 30%.
    const r = calculateDamage(ober({ buffStack: [skill(1, 1), skill(3, 1)] }), data);
    expect(r.breakdown.npDamageMod).toBeCloseTo(0.3, 5);
  });

  it("boost sem nada para dobrar é reportado, não some", () => {
    const r = calculateDamage(ober({ buffStack: [skill(3)] }), data);
    expect(r.breakdown.npDamageMod).toBe(0);
    expect(r.assumptions.skippedBuffs.some((s) => s.buffType === "buffRate" && /nothing to boost/.test(s.reason))).toBe(true);
    // E não pode virar aviso de "não modelado": o buff é conhecido.
    expect(r.assumptions.unmodeled).not.toContain("buffRate");
  });

  it("o boost alcança só quem tem o trait, não todo buff da mesma skill", () => {
    // A própria skill 3 dá upCommandall; ele não carrega `buffNpDamageUp`.
    const r = calculateDamage(ober({ buffStack: [skill(1), skill(3)] }), data);
    const card = r.assumptions.appliedBuffs.find((b) => b.buffType === "upCommandall")!;
    expect(card.boostedFrom).toBeUndefined();
    expect(card.value).toBe(50);
  });

  it("o boost chega pelo caminho de suporte, não só quando o Oberon ataca", () => {
    const sozinha = calculateDamage(input({ buffStack: [] }), data);
    const comOberon = calculateDamage(
      input({
        buffStack: [
          { kind: "support", servantId: OBERON.id, skills: [1, 3], skillLevel: 10, targetsAttacker: true },
        ],
      }),
      data,
    );
    expect(sozinha.breakdown.npDamageMod).toBe(0);
    expect(comOberon.breakdown.npDamageMod).toBeCloseTo(0.6, 5);
  });

  it("nenhum outro servo tem buffRate — se isso mudar, o teste avisa", () => {
    // Medido no dump inteiro: 1 ocorrência, a skill 3 do Oberon. O dia em que
    // aparecer outra, vale conferir se o novo boost é do mesmo formato.
    const withBuffRate = servantIndex.filter((e) => {
      const s = JSON.parse(readFileSync(`public/data/servant/${e.id}.json`, "utf8")) as Servant;
      return [...s.skills, ...s.classPassive, ...s.appendPassive, ...(s.np ? [s.np] : [])].some((sk) =>
        sk.effects.some((ef) => ef.boostsBuffTraits !== null),
      );
    });
    expect(withBuffRate.map((e) => e.name)).toEqual(["Oberon"]);
  });
});

/**
 * Passiva de classe e de que lado o buff cai (R22).
 *
 * Duas correções que vieram do mesmo relato — a passiva da Kiara não pegava:
 *
 *  1. passivas de classe nunca entravam no cálculo, e **407 dos 462 servos** têm
 *     alguma que afeta dano;
 *  2. o slot era escolhido sem olhar em quem o efeito cai, então um Def Up no
 *     próprio atacante entrava como defesa do alvo e reduzia o dano dele.
 */
describe("passiva de classe e lado do efeito (R22)", () => {
  const KIARA = loadServant(167); // alterEgo (a moonCancer é a 285); Nega-Saver: 1,5x vs Ruler
  const HERC = loadServant(47); // berserker; Mad Enhancement e Divinity são passivas
  const TAMAMO = loadServant(128); // a lancer; skill 2 dá def down no inimigo

  const dataWith = (...extra: Servant[]): DamageData => ({
    ...data,
    servants: new Map([...data.servants, ...extra.map((s) => [s.id, s] as const)]),
  });

  const attack = (s: Servant, over: Partial<DamageInput> = {}) =>
    calculateDamage(
      input({
        attacker: { servantId: s.id, level: s.lvMax, fou: 1000, npLevel: 1, overcharge: 1 },
        buffStack: [],
        ...over,
      }),
      dataWith(s, TAMAMO),
    );

  it("passiva de classe entra sem ser declarada", () => {
    // Mad Enhancement B = +8% Buster; Divinity A = +200 de dano plano.
    // O 200 é o valor do jogo: `addDamage` é número puro, não percentual, e
    // por isso escapa do `/10` que vale para os outros buffs.
    const r = attack(HERC);
    const passives = r.assumptions.appliedBuffs.filter((b) => /passive/.test(b.source));
    expect(passives.map((b) => b.buffType).sort()).toEqual(["addDamage", "upCommandall"]);
    expect(r.breakdown.cardMod).toBeCloseTo(0.08, 5);
    expect(r.breakdown.flatDamage).toBe(200);
  });

  it("passiva de classe respeita restrição de card como qualquer buff", () => {
    // Riding da Artoria é Quick up: vale num card Quick, não no NP Buster.
    const np = calculateDamage(input({ buffStack: [] }), data);
    const quick = calculateDamage(
      input({
        buffStack: [],
        action: { kind: "card", card: "quick", position: 1, isCrit: false, busterChain: false, braveChain: false },
      }),
      data,
    );
    expect(np.breakdown.cardMod).toBe(0);
    expect(quick.breakdown.cardMod).toBeGreaterThan(0);
  });

  it("Nega-Saver dá 1,5x contra Ruler, onde a matriz dava 1x", () => {
    const vsRuler = attack(KIARA, { enemy: enemy({ className: "ruler" }) });
    expect(vsRuler.breakdown.triangleModifierBase).toBe(1);
    expect(vsRuler.breakdown.triangleModifier).toBe(1.5);
    expect(vsRuler.assumptions.resolved.some((r) => /class advantage x1.5/.test(r))).toBe(true);
  });

  it("contra classe sem regra, a matriz vale e a recusa é registrada", () => {
    const vsSaber = attack(KIARA, { enemy: enemy({ className: "saber" }) });
    expect(vsSaber.breakdown.triangleModifier).toBe(vsSaber.breakdown.triangleModifierBase);
    expect(
      vsSaber.assumptions.skippedBuffs.some((s) => /no class relation rule for alterEgo vs saber/.test(s.reason)),
    ).toBe(true);
  });

  it("Def Up no próprio atacante não reduz o dano que ele causa", () => {
    // Logos Eater da Kiara: upDefence 16% em si mesma, condicionado a alvo
    // `humanoid`. Lido sem o lado, virava defesa do inimigo e cortava 16%.
    const humanoid = enemy({ className: "ruler", traits: [{ id: 1000, name: "humanoid" }] });
    const semTrait = attack(KIARA, { enemy: enemy({ className: "ruler" }) });
    const comTrait = attack(KIARA, { enemy: humanoid });

    expect(comTrait.breakdown.defMod).toBe(0);
    expect(comTrait.avg).toBe(semTrait.avg);
    expect(
      comTrait.assumptions.skippedBuffs.some(
        (s) => s.buffType === "upDefence" && /lands on the attacker/.test(s.reason),
      ),
    ).toBe(true);
  });

  it("def down de um suporte alcança o inimigo — não precisa alcançar o atacante", () => {
    // O alcance só vale para buff de aliado. Debuff no inimigo qualquer um
    // aplica, e def down de suporte é das maiores fontes de dano do jogo.
    const sozinha = attack(ARTORIA);
    const comTamamo = attack(ARTORIA, {
      buffStack: [{ kind: "support", servantId: TAMAMO.id, skills: [2], skillLevel: 10, targetsAttacker: false }],
    });
    expect(comTamamo.breakdown.defMod).toBeCloseTo(-0.3, 5);
    expect(comTamamo.avg / sozinha.avg).toBeCloseTo(1.3, 3);
  });
});

/**
 * Três famílias de condição dentro de `condTarget` (R23).
 *
 * O campo é lido como "identidade do alvo", mas carrega três coisas diferentes,
 * e tratar as três como identidade recusa efeitos que valem.
 */
describe("famílias de condição em condTarget (R23)", () => {
  const KIARA = loadServant(167); // NP Arts; skill 1 dá Arts resistance down
  const MUSASHI = loadServant(153); // skill 1: upDamage restrito a `faceCard`

  const dataWith = (s: Servant): DamageData => ({ ...data, servants: new Map([...data.servants, [s.id, s]]) });
  const act = (s: Servant, action: DamageInput["action"], skills: number[]) =>
    calculateDamage(
      input({
        attacker: { servantId: s.id, level: s.lvMax, fou: 1000, npLevel: 1, overcharge: 1 },
        buffStack: skills.map((n) => ({ kind: "ownSkill" as const, skillNum: n, level: 10 })),
        action,
      }),
      dataWith(s),
    );

  const np: DamageInput["action"] = { kind: "np", isCrit: false, busterChain: false, braveChain: false };
  const card = (c: CardType): DamageInput["action"] => ({
    kind: "card", card: c, position: 1, isCrit: false, busterChain: false, braveChain: false,
  });

  it("Arts resistance down vale no NP Arts e no card Arts", () => {
    // `downDefencecommandall -> enemy` com condTarget [cardArts]: a restrição de
    // card está do lado do ALVO, porque o debuff é de resistência ao card que
    // vem. Lida como identidade, era recusada sempre.
    expect(KIARA.np!.card).toBe("arts");
    expect(act(KIARA, np, [1]).breakdown.defMod).toBeCloseTo(-0.3, 5);
    expect(act(KIARA, card("arts"), [1]).breakdown.defMod).toBeCloseTo(-0.3, 5);
  });

  it("e não vale num card de outro tipo", () => {
    const buster = act(KIARA, card("buster"), [1]);
    expect(buster.breakdown.defMod).toBe(0);
    expect(
      buster.assumptions.skippedBuffs.some((s) => /restricted to cardArts/.test(s.reason)),
    ).toBe(true);
  });

  it("def down sem restrição de card soma com o restrito", () => {
    // Skill 2 é def down puro; as duas fontes entram no mesmo slot.
    expect(act(KIARA, np, [1, 2]).breakdown.defMod).toBeCloseTo(-0.6, 5);
  });

  it("`faceCard` restringe a command card, não a NP", () => {
    // Skill 1 da Musashi: upDamage 30% só em card comum.
    expect(act(MUSASHI, card("arts"), [1]).breakdown.powerMod).toBeCloseTo(0.3, 5);
    expect(act(MUSASHI, np, [1]).breakdown.powerMod).toBe(0);
  });

  it("condição de estado do inimigo é recusada dizendo que é estado", () => {
    // `buff*` em condTarget é buff no alvo, não trait — e estado é D14. O que
    // não pode é recusar como se fosse identidade, escondendo o motivo real.
    const muramasa = loadServant(302); // crit damage se o alvo tiver evade/invencibilidade
    const r = act(muramasa, card("buster"), [1, 2, 3]);
    const state = r.assumptions.skippedBuffs.filter((s) => /enemy buff state is not modelled/.test(s.reason));
    expect(state.length).toBeGreaterThan(0);
    expect(state.every((s) => /buff/.test(s.reason))).toBe(true);
  });
});

/**
 * Escolha entre vários NPs (R24).
 *
 * Cinco servos trocam o card do NP, e o multiplicador troca junto. Calcular
 * sempre pelo `np` de maior prioridade erra por quase o dobro na Mélusine.
 */
describe("mais de um NP por servo (R24)", () => {
  const ISHTAR = loadServant(268); // 3 cards: arts 450%, buster 300%, quick 600%
  const MELUSINE = loadServant(312); // 2 NPs de nomes diferentes: 300% e 900%
  const EMIYA = loadServant(11); // dois eixos: card E rank up
  const MASH = loadServant(1); // 8 versões Arts de histórico + 1 Buster de forma

  const dataWith = (s: Servant): DamageData => ({ ...data, servants: new Map([...data.servants, [s.id, s]]) });
  const npDamage = (s: Servant, npId: number) =>
    calculateDamage(
      input({
        attacker: { servantId: s.id, level: s.lvMax, fou: 1000, npLevel: 1, overcharge: 1, npId },
        buffStack: [],
      }),
      dataWith(s),
    );

  it("agrupa por card: variante é escolha, rank up é histórico", () => {
    // A Mash tem 9 NPs no documento, mas só 2 são escolha — as outras 7 são
    // versões Arts antigas, e dentro do mesmo card vale a de maior prioridade.
    expect(MASH.npAlternatives.length + 1).toBe(9);
    expect(selectableNps(MASH).map((n) => n.card)).toEqual(["arts", "buster"]);
    expect(selectableNps(ARTORIA)).toHaveLength(1);
  });

  it("mesma carta, alvos diferentes: a chave é card + alvo", () => {
    // UDK-Barghest tem dois NPs Arts, AoE 450% e ST 900%. Agrupar só por card
    // escondia justamente a versão de dobro do multiplicador.
    const udk = loadServant(391);
    const opts = selectableNps(udk);
    expect(opts.map((n) => `${n.card}/${n.target}`).sort()).toEqual(["arts/aoe", "arts/st"]);
    const st = opts.find((n) => n.target === "st")!;
    const aoe = opts.find((n) => n.target === "aoe")!;
    expect((st.damageMultiplier?.[0] ?? 0) / (aoe.damageMultiplier?.[0] ?? 1)).toBe(2);
    expect(npDamage(udk, st.id).avg / npDamage(udk, aoe.id).avg).toBeCloseTo(2, 3);
  });

  it("Space Ishtar: três cards, três multiplicadores", () => {
    const byCard = new Map(selectableNps(ISHTAR).map((n) => [n.card, n]));
    expect([...byCard.keys()].sort()).toEqual(["arts", "buster", "quick"]);
    expect(byCard.get("buster")!.damageMultiplier![0]).toBe(300);
    expect(byCard.get("arts")!.damageMultiplier![0]).toBe(450);
    expect(byCard.get("quick")!.damageMultiplier![0]).toBe(600);
  });

  it("o NP escolhido muda o número, não só o rótulo", () => {
    const opts = selectableNps(MELUSINE);
    const buster = opts.find((n) => n.card === "buster")!;
    const arts = opts.find((n) => n.card === "arts")!;
    expect(npDamage(MELUSINE, arts.id).breakdown.npDamageMultiplier).toBe(9);
    expect(npDamage(MELUSINE, buster.id).breakdown.npDamageMultiplier).toBe(3);
    // 900% num Arts (x1.0) contra 300% num Buster (x1.5) daria 2,0x. Dá 2,18
    // porque a passiva Territory Creation B+ é +9% de Arts, e só vale num deles
    // — exatamente o tipo de interação que some quando a passiva é ignorada.
    expect(npDamage(MELUSINE, arts.id).avg / npDamage(MELUSINE, buster.id).avg).toBeCloseTo(2.18, 2);
  });

  it("Emiya: com card e rank up cruzados, vence a versão pós rank up dos dois", () => {
    // As duas Arts empatam em `priority`; sem desempate por `condQuestId` a
    // escolha seria a ordem do array.
    const opts = selectableNps(EMIYA);
    expect(opts.map((n) => n.damageMultiplier?.[0] ?? 0).sort((a, b) => a - b)).toEqual([400, 600]);
    expect(opts.every((n) => n.condQuestId > 0)).toBe(true);
  });

  it("sem escolha explícita, usa o NP ativo do servo", () => {
    const semId = calculateDamage(
      input({ attacker: { servantId: MELUSINE.id, level: MELUSINE.lvMax, fou: 1000, npLevel: 1, overcharge: 1 }, buffStack: [] }),
      dataWith(MELUSINE),
    );
    expect(semId.avg).toBe(npDamage(MELUSINE, MELUSINE.np!.id).avg);
  });

  it("id desconhecido cai no padrão em vez de quebrar", () => {
    expect(npDamage(MELUSINE, 999999).avg).toBe(npDamage(MELUSINE, MELUSINE.np!.id).avg);
  });

  it("oito servos têm mais de uma variante de NP — se mudar, o teste avisa", () => {
    const many = servantIndex.filter((e) => {
      const s = JSON.parse(readFileSync(`public/data/servant/${e.id}.json`, "utf8")) as Servant;
      return selectableNps(s).length > 1;
    });
    expect(many.map((e) => e.name).sort()).toEqual([
      "BB Dubai", "Emiya", "Jade Rabbit", "Mash Kyrielight",
      "Mélusine", "Ptolemaîos", "Space Ishtar", "UDK-Barghest",
    ]);
  });
});

/**
 * R25 — escala por HP.
 *
 * Dois mecanismos independentes, os dois truncados no valor de HP cheio até
 * aqui: o `funcType` `damageNpHpratioLow`, que engorda o multiplicador do NP, e
 * o campo `RatioHPLow` do `sval`, que engorda o valor de um buff.
 *
 * Nenhum dos dois dava sintoma. Sobrava um número plausível — e em dois casos
 * (Leonidas, Passionlip) sobrava um buff contado valendo zero.
 */
describe("escala por HP (R25)", () => {
  const atHp = (s: Servant, hp: number, over: Partial<DamageInput> = {}) =>
    calculateDamage(
      input({
        attacker: { servantId: s.id, level: 90, fou: 1000, npLevel: 1, overcharge: 1, hpPercent: hp },
        ...over,
      }),
      data,
    );
  const skillBuff = (s: Servant, num: number, hp: number, buffType: string) =>
    atHp(s, hp, { buffStack: [{ kind: "ownSkill", skillNum: num, level: 10 }] })
      .assumptions.appliedBuffs.filter((b) => b.buffType === buffType)
      .find((b) => b.atFullHp !== undefined);

  it("interpola linearmente entre as pontas da faixa", () => {
    // Cú Chulainn skill 1: `Value 200` + `RatioHPLow 300` = 20% a 50% de ATK.
    const at = (hp: number) => skillBuff(CU, 1, hp, "upAtk")?.value;
    expect([at(100), at(50), at(0)]).toEqual([20, 35, 50]);
  });

  it("com HP cheio devolve o que a ingestão já guardava — nada certo mudou", () => {
    const b = skillBuff(CU, 1, 100, "upAtk");
    expect(b?.value).toBe(20);
    // `atFullHp` é o mesmo em qualquer HP: é a referência, não o valor atual.
    expect([skillBuff(CU, 1, 0, "upAtk")?.atFullHp, b?.atFullHp]).toEqual([20, 20]);
  });

  it("quando o Value é 0, o buff inteiro é a escala", () => {
    // Leonidas tem dois `upAtk` na mesma skill: um fixo de 20% e um que só
    // existe conforme o HP cai. Antes, o segundo era contado valendo zero.
    const at = (hp: number) => skillBuff(LEONIDAS, 1, hp, "upAtk")?.value;
    expect([at(100), at(50), at(0)]).toEqual([0, 15, 30]);
    // O fixo não se move, então o slot inteiro vai de 20% a 50%.
    const total = (hp: number) =>
      atHp(LEONIDAS, hp, { buffStack: [{ kind: "ownSkill", skillNum: 1, level: 10 }] }).breakdown.atkMod;
    expect([total(100), total(0)]).toEqual([0.2, 0.5]);
  });

  it("a faixa é um gatilho, não um limite — o valor cai a zero acima dela", () => {
    // Passionlip é a única com `RatioHPRange*`: "HP50%以下で発動".
    const at = (hp: number) => skillBuff(LIP, 2, hp, "upAtk")?.value;
    expect([at(100), at(51)]).toEqual([0, 0]);
    expect([at(50), at(25), at(0)]).toEqual([30, 40, 50]);
  });

  it("escala também fora do atkMod: crit damage do Hijikata vai a 100%", () => {
    const at = (hp: number) => skillBuff(HIJIKATA, 3, hp, "upCriticaldamage")?.value;
    expect([at(100), at(50), at(0)]).toEqual([20, 60, 100]);
  });

  it("o bônus do NP escala com overcharge, que era inerte nesses servos", () => {
    const mult = (oc: 1 | 5, hp: number) =>
      atHp(HIJIKATA, hp, {
        attacker: { servantId: HIJIKATA.id, level: 90, fou: 1000, npLevel: 1, overcharge: oc, hpPercent: hp },
      }).breakdown.npDamageMultiplier;
    // Com HP cheio o overcharge não muda nada: o bônus é multiplicado por zero.
    expect(mult(1, 100)).toBe(mult(5, 100));
    // Com HP zerado ele é a diferença inteira — antes os dois davam 8.
    expect([mult(1, 0), mult(5, 0)]).toEqual([16, 20]);
  });

  it("Anne & Mary: o overcharge só aparece quando há HP faltando", () => {
    const dano = (oc: 1 | 3 | 5, hp: number) =>
      atHp(ANNE, hp, {
        attacker: { servantId: ANNE.id, level: 90, fou: 1000, npLevel: 1, overcharge: oc, hpPercent: hp },
      }).avg;
    expect(dano(1, 100)).toBe(dano(5, 100));
    expect(dano(1, 0)).toBeLessThan(dano(3, 0));
    expect(dano(3, 0)).toBeLessThan(dano(5, 0));
  });

  it("servo sem escala é indiferente ao HP, e não ganha o campo de auditoria", () => {
    expect(atHp(ARTORIA, 0).avg).toBe(atHp(ARTORIA, 100).avg);
    const buffs = atHp(ARTORIA, 1, { buffStack: [{ kind: "ownSkill", skillNum: 2, level: 10 }] })
      .assumptions.appliedBuffs;
    expect(buffs.length).toBeGreaterThan(0);
    expect(buffs.every((b) => b.atFullHp === undefined)).toBe(true);
  });

  it("HP fora de 0..100 é preso na borda, venha de onde vier", () => {
    expect(atHp(CU, 500).avg).toBe(atHp(CU, 100).avg);
    expect(atHp(CU, -20).avg).toBe(atHp(CU, 0).avg);
  });
});

/**
 * R27 — `damageNpIndividualSum`: o multiplicador está em `Value2`.
 *
 * Nas outras famílias de dano o super-efetivo vem de `Correction`. Aqui não:
 * `Correction` é o acréscimo **por unidade contada**, e vale 0 em quatro NPs.
 * Lê-lo como multiplicador dava 0%, e multiplicador zero **zera o produto
 * inteiro** — a Musashi causava 1 de dano contra AlterEgo.
 *
 * Este é o único dos defeitos achados até aqui que não produz número plausível:
 * produz absurdo. Por isso sobreviveu tanto tempo — só dispara contra o alvo
 * certo, e ninguém testa o alvo certo por acaso.
 */
describe("super-efetivo por soma (R27)", () => {
  const npVs = (
    s: Servant,
    className: string,
    st: { stacksSelf?: number; stacksTarget?: number } = {},
  ) =>
    calculateDamage(
      input({
        attacker: { servantId: s.id, level: 90, fou: 1000, npLevel: 1, overcharge: 1, stacks: st.stacksSelf },
        enemy: enemy({ className, stacks: st.stacksTarget }),
      }),
      data,
    );
  const seOf = (s: Servant) => s.np!.effects[s.np!.damageEffectIndex!]!.superEffective!;

  it("o multiplicador sai de Value2, não de Correction", () => {
    const se = seOf(MUSASHI);
    expect(se.values[0]).toBe(150);
    // `Correction` é 0 neste NP: era ele que zerava tudo.
    expect(se.perCount).toBe(0);
  });

  it("e o dano deixa de ser aniquilado contra o alvo certo", () => {
    const neutro = npVs(MUSASHI, "shielder");
    const alvo = npVs(MUSASHI, "alterEgo");
    expect(alvo.breakdown.superEffectiveModifier).toBe(150);
    expect(ratio(alvo.avg, neutro.avg)).toBeCloseTo(1.5, 2);
    // O sintoma antigo, para não voltar: `Math.max(1, ...)` era o resultado.
    expect(alvo.avg).toBeGreaterThan(1000);
  });

  it("o lado da contagem sai do Target, que aqui não é trait", () => {
    // Antes, `Target: 1` virava um trait id 1 inexistente na lista.
    expect(seOf(MUSASHI).traits.map((t) => t.name)).toEqual(["classAlterEgo", "classMoonCancer"]);
    expect(seOf(MUSASHI).countsOn).toBe("target");
    expect(seOf(CHARLEMAGNE).countsOn).toBe("self");
  });

  it("quem conta stacks tem base neutra, então zero stacks não inventa bônus", () => {
    const se = seOf(CHARLEMAGNE);
    expect([se.values[0], se.perCount, se.maxCount]).toEqual([100, 10, 12]);
    expect(npVs(CHARLEMAGNE, "shielder").breakdown.superEffectiveModifier).toBe(100);
  });

  it("a contagem é declarada, com ou sem stacks", () => {
    const nota = (r: ReturnType<typeof calculateDamage>) =>
      r.assumptions.resolved.find((l) => /stacks/.test(l));
    expect(nota(npVs(CHARLEMAGNE, "shielder"))).toBe("0 of up to 12 own Heroic King stacks — none counted");
    expect(nota(npVs(CHARLEMAGNE, "shielder", { stacksSelf: 8 }))).toBe(
      "8 of up to 12 own Heroic King stacks (+80% super effective)",
    );
  });

  it("as outras famílias continuam lendo Correction", () => {
    // Gilgamesh é `damageNpIndividual`: ali `Value2` não existe e `Correction`
    // é o multiplicador. A correção não pode ter mexido nele.
    const r = calculateDamage(
      input({
        attacker: { servantId: GIL.id, level: 90, fou: 1000, npLevel: 1, overcharge: 1 },
        enemy: enemy({ traits: [{ id: 2008, name: "weakToEnumaElish" }] }),
      }),
      data,
    );
    expect(r.breakdown.superEffectiveModifier).toBe(150);
  });
});

/**
 * R27, segunda parte — os dois contadores.
 *
 * Dois campos e não um: `Heroic King` no Charlemagne e `roman` no alvo do
 * Romulus são contagens de **entidades diferentes**. Um campo só mudaria de
 * significado conforme o servo escolhido, que é o formato de defeito que este
 * projeto já pagou em R23, R25 e no próprio R27.
 */
describe("contagem de stacks (R27)", () => {
  const ROMULUS = loadServant(280);
  const dataR: DamageData = { ...data, servants: new Map([...data.servants, [ROMULUS.id, ROMULUS]]) };
  const np = (s: Servant, st: { self?: number; target?: number } = {}) =>
    calculateDamage(
      input({
        attacker: { servantId: s.id, level: 90, fou: 1000, npLevel: 1, overcharge: 1, stacks: st.self },
        enemy: enemy({ stacks: st.target }),
      }),
      dataR,
    );

  it("cada lado lê o seu campo, e só o seu", () => {
    // Charlemagne conta em si: `stacksTarget` não pode fazer nada por ele.
    expect(np(CHARLEMAGNE, { target: 12 }).breakdown.superEffectiveStacks).toBe(0);
    expect(np(CHARLEMAGNE, { self: 12 }).breakdown.superEffectiveStacks).toBe(12);
    // Romulus conta no alvo: o espelho exato.
    expect(np(ROMULUS, { self: 10 }).breakdown.superEffectiveStacks).toBe(0);
    expect(np(ROMULUS, { target: 10 }).breakdown.superEffectiveStacks).toBe(10);
  });

  it("o bônus é linear no número de stacks", () => {
    // Charlemagne: base 100% + 10% por stack.
    const se = (n: number) => np(CHARLEMAGNE, { self: n }).breakdown.superEffectiveModifier;
    expect([se(0), se(1), se(6), se(12)]).toEqual([100, 110, 160, 220]);
  });

  it("o teto do dado prende, mesmo se pedirem mais", () => {
    expect(np(CHARLEMAGNE, { self: 999 }).breakdown.superEffectiveStacks).toBe(12);
    expect(np(CHARLEMAGNE, { self: 999 }).breakdown.superEffectiveModifier).toBe(220);
    // Romulus tem teto 10, não 12: o limite é por NP, não global.
    expect(np(ROMULUS, { target: 999 }).breakdown.superEffectiveStacks).toBe(10);
  });

  it("negativo não vira bônus reverso", () => {
    expect(np(CHARLEMAGNE, { self: -5 }).breakdown.superEffectiveStacks).toBe(0);
    expect(np(CHARLEMAGNE, { self: -5 }).avg).toBe(np(CHARLEMAGNE).avg);
  });

  it("stack no máximo mais que dobra o dano do Charlemagne", () => {
    expect(ratio(np(CHARLEMAGNE, { self: 12 }).avg, np(CHARLEMAGNE).avg)).toBeCloseTo(2.2, 2);
  });

  it("quem não conta stacks ignora os dois campos", () => {
    const semStack = np(MUSASHI).avg;
    expect(np(MUSASHI, { self: 10, target: 10 }).avg).toBe(semStack);
  });
});

/**
 * R28 — funcType de dano fora da tabela de divisores.
 *
 * `valueRuleFor` devolve `unknown` para funcType desconhecido, e o valor fica
 * **cru**. Para quase todo campo isso é a proteção certa: o número sai
 * obviamente não convertido. Para o multiplicador de NP é o contrário — ele vai
 * direto para a fórmula e ninguém consulta `valueUnit` no caminho.
 *
 * Resultado: dano 10x, sem sintoma. A Ereshkigal batia 128.759 onde deveria
 * bater 12.876.
 */
describe("unidade do multiplicador de NP (R28)", () => {
  const ERESH = loadServant(417);
  const dataE: DamageData = { ...data, servants: new Map([...data.servants, [ERESH.id, ERESH]]) };

  it("o multiplicador está em % e na escala dos outros NPs", () => {
    expect(ERESH.np!.damageMultiplier).toEqual([450, 600, 675, 712.5, 750]);
    const r = calculateDamage(
      input({ attacker: { servantId: ERESH.id, level: 90, fou: 1000, npLevel: 1, overcharge: 1 } }),
      dataE,
    );
    expect(r.breakdown.npDamageMultiplier).toBe(4.5);
  });

  it("nenhum NP de dano do roster escapa da tabela de unidades", () => {
    // A trava que impede o próximo funcType novo do Atlas de virar dano 10x.
    const escapou: string[] = [];
    for (const s of servantIndex) {
      const f = loadServant(s.collectionNo);
      for (const np of [f.np, ...f.npAlternatives]) {
        if (!np || np.damageEffectIndex === null) continue;
        const e = np.effects[np.damageEffectIndex];
        if (e && e.valueUnit !== "percent") escapou.push(`${f.name}/${e.funcType}`);
      }
    }
    expect(escapou).toEqual([]);
  });
});

/**
 * 5a — Craft Essence e Mystic Code.
 *
 * O núcleo já resolvia os dois desde a fase 3; o que faltava era poder pedi-los.
 * O teste que mais importa aqui é o primeiro: uma CE se declara em **um** lugar.
 * Antes eram dois — `attacker.ce` dava a ATK e uma entrada no `buffStack` dava
 * os efeitos —, e declarar metade produzia um número plausível.
 */
describe("Craft Essence e Mystic Code (5a)", () => {
  const np = (over: Partial<DamageInput["attacker"]> = {}, rest: Partial<DamageInput> = {}) =>
    calculateDamage(
      input({
        attacker: { servantId: ARTORIA.id, level: 90, fou: 1000, npLevel: 1, overcharge: 1, ...over },
        ...rest,
      }),
      data,
    );

  it("uma CE declarada dá ATK e efeito juntos — nunca só metade", () => {
    const sem = np();
    const com = np({ ce: { id: GRAIL.id, mlb: false } });
    // ATK: +2400 do Black Grail no nível máximo.
    expect(com.breakdown.servantAtk).toBe(sem.breakdown.servantAtk + 2400);
    // E o efeito, no mesmo gesto: +60% de dano de NP.
    expect(com.breakdown.npDamageMod).toBeCloseTo(0.6, 5);
    expect(com.assumptions.appliedBuffs.some((b) => /Black Grail/.test(b.source))).toBe(true);
  });

  it("MLB troca o conjunto de efeitos, não o nível", () => {
    // `effectsBase` e `effectsMlb` são conjuntos diferentes (D17): o MLB muda o
    // valor do buff e não encosta na ATK.
    const base = np({ ce: { id: GRAIL.id, mlb: false } });
    const mlb = np({ ce: { id: GRAIL.id, mlb: true } });
    expect([base.breakdown.npDamageMod, mlb.breakdown.npDamageMod]).toEqual([0.6, 0.8]);
    expect(mlb.breakdown.servantAtk).toBe(base.breakdown.servantAtk);
    expect(mlb.assumptions.appliedBuffs.find((b) => /Black Grail/.test(b.source))?.source).toMatch(/MLB/);
  });

  it("nível omitido = o máximo daquela CE, resolvido no núcleo", () => {
    const cheio = np({ ce: { id: GRAIL.id, mlb: true } });
    const lv1 = np({ ce: { id: GRAIL.id, mlb: true, level: 1 } });
    expect(cheio.breakdown.servantAtk - lv1.breakdown.servantAtk).toBe(1800);
    // Fora da faixa é preso, não vira ATK zero em silêncio.
    expect(np({ ce: { id: GRAIL.id, mlb: true, level: 999 } }).breakdown.servantAtk).toBe(
      cheio.breakdown.servantAtk,
    );
  });

  it("Mystic Code: só as skills marcadas entram", () => {
    const mc = { id: 20, level: 10 }; // Chaldea Combat Uniform: skill 1 = ATK up ptAll
    expect(np({}, { mysticCode: mc }).breakdown.atkMod).toBe(0);
    const comSkill = np({}, { mysticCode: mc, buffStack: [{ kind: "mysticCodeSkill", index: 0 }] });
    expect(comSkill.breakdown.atkMod).toBeCloseTo(0.3, 5);
  });

  it("skill de MC sem MC equipado não faz nada", () => {
    // O estado é representável pela query string (`mcs=1` sem `mc=`), então
    // precisa ser inofensivo em vez de estourar.
    const r = np({}, { buffStack: [{ kind: "mysticCodeSkill", index: 0 }] });
    expect(r.avg).toBe(np().avg);
  });

  it("CE e MC somam nos slots certos, sem se atropelar", () => {
    const r = np(
      { ce: { id: GRAIL.id, mlb: true } },
      { mysticCode: { id: 20, level: 10 }, buffStack: [{ kind: "mysticCodeSkill", index: 0 }] },
    );
    expect(r.breakdown.npDamageMod).toBeCloseTo(0.8, 5); // CE
    expect(r.breakdown.atkMod).toBeCloseTo(0.3, 5); // MC
    expect(r.breakdown.servantAtk).toBe(14621); // 12221 + 2400
  });
});

/**
 * R29 — bônus de dano que só vale dentro do evento da CE.
 *
 * Reportado pelo Thales: Gilgamesh com Golden Sumo ganhava +100% de dano ao
 * marcar MLB (+200%). No dump o efeito chega como `upDamage` **sem condição
 * nenhuma**, e qual evento é vive em dado de quest que não ingerimos.
 *
 * O que autoriza a recusa é a assimetria entre servos e CEs — ver
 * `isEventOnlyBonus`.
 */
describe("bônus de evento em CE (R29)", () => {
  const np = (ce?: { id: number; mlb: boolean }) =>
    calculateDamage(
      input({ attacker: { servantId: ARTORIA.id, level: 90, fou: 1000, npLevel: 1, overcharge: 1, ...(ce ? { ce } : {}) } }),
      data,
    );

  it("o upDamage sem condição da CE de evento não entra no dano", () => {
    const r = np({ id: SUMO.id, mlb: true });
    expect(r.breakdown.powerMod).toBe(0);
    // A CE tem mesmo o efeito no dado — não é que ele não exista.
    expect(SUMO.effectsMlb.some((e) => e.buffType === "upDamage" && e.values[0] === 200)).toBe(true);
  });

  it("e a recusa é dita, com o motivo", () => {
    const s = np({ id: SUMO.id, mlb: true }).assumptions.skippedBuffs.find((b) => /Golden Sumo/.test(b.source));
    expect(s?.buffType).toBe("upDamage");
    expect(s?.reason).toMatch(/event-only/);
  });

  it("o que a CE anuncia continua valendo", () => {
    // ATK plana e `upAtk` estão na descrição: 10% base, 15% MLB.
    const base = np({ id: SUMO.id, mlb: false });
    const mlb = np({ id: SUMO.id, mlb: true });
    expect(base.breakdown.servantAtk).toBe(np().breakdown.servantAtk + 2000);
    expect([base.breakdown.atkMod, mlb.breakdown.atkMod]).toEqual([0.1, 0.15]);
  });

  it("não pega CE legítima: o Black Grail é upNpdamage, não upDamage", () => {
    const r = np({ id: GRAIL.id, mlb: true });
    expect(r.breakdown.npDamageMod).toBeCloseTo(0.8, 5);
    expect(r.assumptions.skippedBuffs.filter((b) => /Black Grail/.test(b.source))).toEqual([]);
  });

  it("nenhum servo perde buff por esta regra", () => {
    // A regra só vale para CE porque em servo `upDamage` sem condição não
    // existe. Se um servo ganhar um, isto falha e o caso é reexaminado.
    const semCond: string[] = [];
    for (const s of servantIndex) {
      const f = loadServant(s.collectionNo);
      for (const sk of [...f.skills, ...f.classPassive, ...f.appendPassive]) {
        for (const e of sk.effects) {
          if (e.buffType !== "upDamage") continue;
          if (e.condSelf.length + e.condTarget.length + e.condFunc.length === 0) semCond.push(`${f.name}/${sk.name}`);
        }
      }
    }
    expect(semCond).toEqual([]);
  });
});

/**
 * Fase 5b — buffs externos.
 *
 * Não é "party": é uma lista de contribuições. Sem posição, sem limite de três,
 * repetição permitida — Order Change deixa mais de dois buffarem o mesmo ataque
 * num turno, e duas cópias do mesmo suporte somam.
 *
 * Guardadas por **referência** (D13): quem e quais skills, nunca valores
 * resolvidos. É o que preserva a condição de card do buff e os traits dele.
 */
describe("buffs externos (5b)", () => {
  const CASTORIA = loadServant(284); // sk1 upAtk ptAll · sk3 upCommandall ptOne [cardArts] · NP sem dano
  const LANLING = loadServant(227); // NP de suporte com upAtk que escala com overcharge
  const dataX: DamageData = {
    ...data,
    servants: new Map([...data.servants, [CASTORIA.id, CASTORIA], [LANLING.id, LANLING]]),
  };
  const arts = (query: string) =>
    calculateDamage(
      toDamageInput(parseCalc(new URLSearchParams(`s=${ARTORIA.id}&act=arts&ec=saber&ea=earth&${query}`)), ARTORIA, () => "?"),
      dataX,
    );

  it("um suporte contribui, e o mesmo suporte duas vezes soma", () => {
    const sozinha = arts("");
    const uma = arts(`sup=${CASTORIA.id}:1,2,3`);
    const duas = arts(`sup=${CASTORIA.id}:1,2,3&sup=${CASTORIA.id}:1,2,3`);
    expect([sozinha.breakdown.atkMod, sozinha.breakdown.cardMod]).toEqual([0, 0]);
    expect([uma.breakdown.atkMod, uma.breakdown.cardMod]).toEqual([0.2, 0.5]);
    // Duas cópias empilham aditivamente: é assim no jogo.
    expect([duas.breakdown.atkMod, duas.breakdown.cardMod]).toEqual([0.4, 1]);
  });

  it("buff de alvo único só chega se apontado para quem ataca", () => {
    // A skill 3 da Castoria é `ptOne`: buffa UM aliado, e qual é escolha de quem
    // joga. Antes de 5b um `ptOne` passava mesmo com `targetsAttacker: false`,
    // porque estava na mesma lista do `ptAll`.
    expect(arts(`sup=${CASTORIA.id}:3`).breakdown.cardMod).toBe(0.5);
    expect(arts(`sup=${CASTORIA.id}:3;t0`).breakdown.cardMod).toBe(0);
  });

  it("e a recusa distingue 'nunca chegaria' de 'não foi apontado'", () => {
    const r = arts(`sup=${CASTORIA.id}:3;t0`);
    // Filtrar por fonte: a passiva Riding da própria Artoria também é um
    // `upCommandall` recusado aqui, e com toda a razão — ela é Quick.
    const s = r.assumptions.skippedBuffs.find((b) => /Altria Caster/.test(b.source) && b.buffType === "upCommandall");
    expect(s?.reason).toMatch(/not pointed at the attacker/);
  });

  it("NP de suporte não tem função de dano — então tudo nele vale", () => {
    // `damageEffectIndex` é null em 20 dos 47 NPs que buffam a party, e é onde
    // estão Castoria e Merlin. Cortar em null os deixaria com zero buff (D20).
    expect(CASTORIA.np?.damageEffectIndex).toBeNull();
    expect(arts(`sup=${CASTORIA.id}:;np=5`).breakdown.atkMod).toBe(0.5);
  });

  it("o overcharge do NP do suporte é dele, não de quem ataca", () => {
    // Prince of Lan Ling: upAtk 30/35/40/45/50 por overcharge. 26 dos 47 escalam.
    expect(arts(`sup=${LANLING.id}:;np=1;oc=1`).breakdown.atkMod).toBe(0.3);
    expect(arts(`sup=${LANLING.id}:;np=1;oc=5`).breakdown.atkMod).toBe(0.5);
    // E o overcharge do atacante não mexe no NP do suporte.
    expect(arts(`oc=5&sup=${LANLING.id}:;np=1;oc=1`).breakdown.atkMod).toBe(0.3);
  });

  it("a CE do suporte entra com os efeitos e NUNCA com a ATK", () => {
    // Crown of the Star: upAtk 15% -> ptFull, sem condição.
    const sem = arts(`sup=${CASTORIA.id}:`);
    const com = arts(`sup=${CASTORIA.id}:;ce=${CROWN.id}`);
    // A ATK daquela CE é da Castoria. Somá-la em quem ataca daria centenas de
    // ATK vindas do nada — plausível, errado, sem sintoma.
    expect(com.breakdown.servantAtk).toBe(sem.breakdown.servantAtk);
    expect(com.breakdown.atkMod).toBeCloseTo(0.15, 5);
    expect(com.assumptions.appliedBuffs.some((b) => /Altria Caster's CE Crown of the Star/.test(b.source))).toBe(true);
  });

  it("CE de suporte com efeito `self` fica com o suporte", () => {
    // O Black Grail é `upNpdamage -> self`: numa Castoria ele buffa o NP DELA.
    // Não é caso de somar em quem ataca, é caso de recusar com o motivo.
    const r = arts(`sup=${CASTORIA.id}:;ce=${GRAIL.id};mlb`);
    expect(r.breakdown.npDamageMod).toBe(0);
    const s = r.assumptions.skippedBuffs.find((b) => /Black Grail/.test(b.source));
    expect(s?.reason).toMatch(/does not reach the attacker/);
  });

  it("passiva de classe e append do suporte ficam com ele", () => {
    // São `self`: o filtro de alcance barra, e isso é o certo.
    const r = arts(`sup=${CASTORIA.id}:1`);
    expect(r.assumptions.appliedBuffs.some((b) => /Altria Caster passive/.test(b.source))).toBe(false);
  });
});
