/**
 * Calculadora de dano. Função pura: sem I/O, sem React, sem banco.
 *
 * Implementa a fórmula de `damage_formula.txt` termo a termo, mantendo os
 * nomes do arquivo original para que a conferência seja linha a linha:
 *
 *   dano = [ servantAtk
 *          * npDamageMultiplier
 *          * (firstCardBonus + cardDamageValue * (1 + cardMod))
 *          * classAtkBonus * triangleModifier * attributeModifier
 *          * randomModifier * ATTACK_RATE
 *          * (1 + atkMod - defMod)
 *          * criticalModifier * extraCardModifier
 *          * (1 - specialDefMod)
 *          * (1 + powerMod + selfDamageMod + critDamageMod*isCrit + npDamageMod*isNP)
 *          * (1 + (superEffectiveModifier - 1) * isSuperEffective) ]
 *          + dmgPlusAdd + selfDmgCutAdd + servantAtk * busterChainMod
 *
 * Nenhuma constante é literal: todas vêm de `constants.json`, gerado dos dumps.
 *
 * Ver docs/DAMAGE.md.
 */

import { PIERCE_FUNCS, signOf, specFor, type DamageSlot } from "./buffs.js";
import type {
  CardType,
  Constants,
  CraftEssence,
  Effect,
  MysticCode,
  Servant,
  Trait,
} from "./model.js";

// ------------------------------------------------------------------- entrada

export type RollMode = "min" | "avg" | "max" | "range";

export interface Enemy {
  className: string;
  attribute: string;
  /** Identidade escolhida pelo usuário. Classe e atributo viram trait sozinhos. */
  traits: Trait[];
  /** % — buff de defesa já ativo no inimigo. */
  defMod: number;
  /** % — resistência especial de alguns bosses. Pierce NÃO ignora isto. */
  specialDefMod: number;
}

export type BuffSource =
  | { kind: "ownSkill"; skillNum: number; level: number }
  | { kind: "append"; num: number; level: number }
  | { kind: "ce"; id: number; mlb: boolean }
  | { kind: "mysticCode"; id: number; skillIndex: number; level: number }
  | { kind: "support"; servantId: number; skills: number[]; skillLevel: number; targetsAttacker: boolean }
  | { kind: "npSelfBuff" };

export interface DamageInput {
  attacker: {
    servantId: number;
    level: number;
    fou: number;
    npLevel: 1 | 2 | 3 | 4 | 5;
    overcharge: 1 | 2 | 3 | 4 | 5;
    ce?: { id: number; level: number; mlb: boolean };
  };
  buffStack: BuffSource[];
  enemy: Enemy;
  action: {
    kind: "np" | "card" | "extra";
    card?: CardType;
    position?: 1 | 2 | 3;
    isCrit: boolean;
    busterChain: boolean;
    braveChain: boolean;
  };
  options: { rollMode: RollMode };
}

/** Documentos já carregados. O caller faz o I/O; o cálculo continua puro. */
export interface DamageData {
  servants: Map<number, Servant>;
  equips: Map<number, CraftEssence>;
  mysticCodes: Map<number, MysticCode>;
  constants: Constants;
}

// -------------------------------------------------------------------- saída

export interface ResolvedBuff {
  source: string;
  buffType: string;
  slot: DamageSlot;
  value: number;
  chance: number;
}

export interface SkippedBuff {
  source: string;
  buffType: string;
  reason: string;
}

export interface DamageResult {
  min: number;
  avg: number;
  max: number;
  perHit: number[];
  breakdown: {
    servantAtk: number;
    npDamageMultiplier: number;
    /** Termo `cardMod` da fórmula, isolado. */
    cardMod: number;
    /** `firstCardBonus + cardDamageValue * (1 + cardMod)` já resolvido. */
    cardTerm: number;
    classAtkBonus: number;
    triangleModifier: number;
    attributeModifier: number;
    atkMod: number;
    defMod: number;
    powerMod: number;
    critDamageMod: number;
    npDamageMod: number;
    specialDefMod: number;
    superEffectiveModifier: number;
    flatDamage: number;
    pierceDefence: boolean;
  };
  assumptions: {
    rollMode: RollMode;
    resolved: string[];
    appliedBuffs: ResolvedBuff[];
    skippedBuffs: SkippedBuff[];
    uncertainBuffs: { source: string; buffType: string; chance: number }[];
    unmodeled: string[];
  };
}

// ------------------------------------------------------------------ inimigo

const CARD_TRAIT: Record<CardType, string> = {
  buster: "cardBuster",
  arts: "cardArts",
  quick: "cardQuick",
  extra: "cardExtra",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Traits efetivos do inimigo: os escolhidos mais os derivados de classe e
 * atributo (D15).
 *
 * Sem a derivação, 71 checagens anti-classe e 16 anti-atributo falhariam em
 * silêncio — um Saber declarado sem o trait `classSaber` não ativaria nenhum
 * bônus anti-Saber.
 */
export function enemyTraitNames(enemy: Enemy): Set<string> {
  const names = new Set(enemy.traits.map((t) => t.name));
  names.add(`class${cap(enemy.className)}`);
  names.add(`attribute${cap(enemy.attribute)}`);
  return names;
}

// --------------------------------------------------------- resolução de buff

/** Alvos que alcançam o atacante quando vindos de um suporte. */
const REACHES_ALLY = new Set(["ptAll", "ptFull", "ptOne", "ptOneOther", "ptOther", "ptSelfAnotherFirst"]);

interface Candidate {
  effect: Effect;
  source: string;
  /** Índice de nível dentro de `effect.values`. */
  levelIndex: number;
  /** true quando o efeito vem de um suporte e precisa alcançar o atacante. */
  fromSupport: boolean;
}

function valueOf(effect: Effect, levelIndex: number, overcharge: number): number {
  const row = effect.valuesByOvercharge ? effect.valuesByOvercharge[overcharge - 1] : effect.values;
  return row?.[Math.min(levelIndex, (row.length || 1) - 1)] ?? 0;
}

/**
 * Filtra e classifica os candidatos em slots da fórmula.
 *
 * Três razões para um buff não entrar, todas reportadas em vez de silenciadas:
 *  - alcance: efeito `self` de um suporte fica no suporte;
 *  - `condSelf`: buff de Buster não vale num NP Arts (R11);
 *  - `condTarget`: buff anti-`human` não vale contra alvo não humano.
 */
function resolveBuffs(
  candidates: Candidate[],
  input: DamageInput,
  enemyTraits: Set<string>,
  /**
   * Card **efetivo** da ação, já resolvido pelo chamador.
   *
   * Não pode ser deduzido de `input.action.card`: num NP o card vem do próprio
   * NP. Ler o campo errado fazia o buff de Buster da skill 2 da Artoria ser
   * descartado num Excalibur, que é Buster.
   */
  actionCard: CardType,
): { applied: ResolvedBuff[]; skipped: SkippedBuff[]; unmodeled: string[] } {
  const applied: ResolvedBuff[] = [];
  const skipped: SkippedBuff[] = [];
  const unmodeled = new Set<string>();

  for (const c of candidates) {
    const e = c.effect;
    if (e.buffType === null) continue; // funções sem buff não alimentam slots
    const label = e.buffType;

    if (c.fromSupport && !REACHES_ALLY.has(e.target)) {
      skipped.push({ source: c.source, buffType: label, reason: `alvo ${e.target} não alcança o atacante` });
      continue;
    }

    const spec = specFor(e.buffType);
    if (spec === null) {
      unmodeled.add(e.buffType);
      continue;
    }
    if (spec.slot === null) continue; // conhecido, mas não afeta dano

    // condSelf: restrição do lado do atacante — quase sempre tipo de card.
    const cardConds = e.condSelf.filter((t) => t.name.startsWith("card"));
    if (cardConds.length > 0) {
      const wanted = CARD_TRAIT[actionCard];
      if (!cardConds.some((t) => t.name === wanted)) {
        skipped.push({
          source: c.source,
          buffType: label,
          reason: `restrito a ${cardConds.map((t) => t.name).join("/")}, ação usa ${wanted}`,
        });
        continue;
      }
    }

    // condTarget: restrição do lado do inimigo.
    if (e.condTarget.length > 0 && !e.condTarget.some((t) => enemyTraits.has(t.name))) {
      skipped.push({
        source: c.source,
        buffType: label,
        reason: `exige alvo com ${e.condTarget.map((t) => t.name).join("/")}`,
      });
      continue;
    }

    const raw = valueOf(e, c.levelIndex, input.attacker.overcharge);
    applied.push({
      source: c.source,
      buffType: label,
      slot: spec.slot,
      value: raw * signOf(e.buffType),
      chance: e.chance,
    });
  }

  return { applied, skipped, unmodeled: [...unmodeled] };
}

/** Monta os candidatos a partir das fontes declaradas no `BuffStack`. */
function collectCandidates(input: DamageInput, data: DamageData): Candidate[] {
  const out: Candidate[] = [];
  const attacker = data.servants.get(input.attacker.servantId);
  if (!attacker) return out;

  for (const src of input.buffStack) {
    switch (src.kind) {
      case "ownSkill": {
        const sk = attacker.skills.find((s) => s.num === src.skillNum);
        if (!sk) break;
        for (const e of sk.effects) {
          out.push({ effect: e, source: `${attacker.name} skill ${src.skillNum}`, levelIndex: src.level - 1, fromSupport: false });
        }
        break;
      }
      case "append": {
        const sk = attacker.appendPassive[src.num - 1];
        if (!sk) break;
        for (const e of sk.effects) {
          out.push({ effect: e, source: `${attacker.name} append ${src.num}`, levelIndex: src.level - 1, fromSupport: false });
        }
        break;
      }
      case "npSelfBuff": {
        // Efeitos do NP que vêm ANTES da função de dano entram no próprio golpe
        // (D20/R20). Os de depois, não — e é por isso que a ordem é contratual.
        const np = attacker.np;
        if (!np || np.damageEffectIndex === null) break;
        for (const e of np.effects.slice(0, np.damageEffectIndex)) {
          out.push({ effect: e, source: `${attacker.name} NP (antes do dano)`, levelIndex: input.attacker.npLevel - 1, fromSupport: false });
        }
        break;
      }
      case "ce": {
        const ce = data.equips.get(src.id);
        if (!ce) break;
        for (const e of src.mlb ? ce.effectsMlb : ce.effectsBase) {
          out.push({ effect: e, source: `CE ${ce.name}${src.mlb ? " (MLB)" : ""}`, levelIndex: 0, fromSupport: false });
        }
        break;
      }
      case "mysticCode": {
        const mc = data.mysticCodes.get(src.id);
        const sk = mc?.skills[src.skillIndex];
        if (!mc || !sk) break;
        for (const e of sk.effects) {
          out.push({ effect: e, source: `${mc.shortName} skill ${src.skillIndex + 1}`, levelIndex: src.level - 1, fromSupport: true });
        }
        break;
      }
      case "support": {
        const sup = data.servants.get(src.servantId);
        if (!sup) break;
        for (const num of src.skills) {
          const sk = sup.skills.find((s) => s.num === num);
          if (!sk) continue;
          for (const e of sk.effects) {
            out.push({ effect: e, source: `${sup.name} skill ${num}`, levelIndex: src.skillLevel - 1, fromSupport: !src.targetsAttacker ? true : !REACHES_ALLY.has(e.target) });
          }
        }
        break;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------- fórmula

const sumSlot = (buffs: ResolvedBuff[], slot: DamageSlot): number =>
  buffs.filter((b) => b.slot === slot).reduce((a, b) => a + b.value, 0) / 100;

export function calculateDamage(input: DamageInput, data: DamageData): DamageResult {
  const k = data.constants;
  const attacker = data.servants.get(input.attacker.servantId);
  if (!attacker) throw new Error(`servo ${input.attacker.servantId} não carregado`);

  const enemyTraits = enemyTraitNames(input.enemy);

  // O card precisa ser resolvido ANTES dos buffs: as restrições `condSelf` são
  // quase todas de tipo de card, e num NP o card vem do NP, não da ação.
  const isNP = input.action.kind === "np";
  const np = attacker.np;
  const card: CardType = isNP
    ? np?.card ?? "arts"
    : input.action.kind === "extra"
      ? "extra"
      : input.action.card ?? "arts";

  const candidates = collectCandidates(input, data);
  const { applied, skipped, unmodeled } = resolveBuffs(candidates, input, enemyTraits, card);

  // ---- ATK
  const base = attacker.atkGrowth[input.attacker.level - 1] ?? 0;
  const ce = input.attacker.ce ? data.equips.get(input.attacker.ce.id) : undefined;
  const ceAtk = ce ? ce.atkGrowth[(input.attacker.ce?.level ?? ce.lvMax) - 1] ?? 0 : 0;
  const servantAtk = base + input.attacker.fou + ceAtk;

  // ---- NP e card
  const npDamageMultiplier =
    isNP && np?.damageMultiplier ? (np.damageMultiplier[input.attacker.npLevel - 1] ?? 0) / 100 : 1;
  // "NP cards act as a First card of the appropriate type."
  const position = isNP ? 1 : input.action.position ?? 1;
  const cardEntry = k.cardMultiplier[card]?.[position] ?? { adjustAtk: 1, addAtk: 0 };
  // "firstCardBonus: 0.5 if first card is a Buster card. No bonus to NPs."
  const firstCardBonus = isNP ? 0 : position === 1 ? cardEntry.addAtk : 0;
  const cardMod = sumSlot(applied, "cardMod");
  const cardTerm = firstCardBonus + cardEntry.adjustAtk * (1 + cardMod);

  // ---- multiplicadores de classe e atributo
  const classAtkBonus = k.classAttackRate[attacker.className] ?? 1;
  const triangleModifier = k.classRelation[attacker.className]?.[input.enemy.className] ?? 1;
  const attributeModifier =
    k.attributeRelation[attacker.attribute]?.[input.enemy.attribute as keyof typeof k.attributeRelation] ?? 1;

  // ---- modificadores de buff
  const atkMod = sumSlot(applied, "atkMod");
  const pierce = applied.some((b) => b.slot === "pierceDefence") || (isNP && np !== null && PIERCE_FUNCS.has(np.effects[np.damageEffectIndex ?? 0]?.funcType ?? ""));
  const defBuff = sumSlot(applied, "defMod") + input.enemy.defMod / 100;
  // "Def Up (mas não Def Down) é ignorado se o NP ignora defesa."
  const defMod = pierce ? Math.min(defBuff, 0) : defBuff;

  const powerMod = sumSlot(applied, "powerMod");
  const critDamageMod = sumSlot(applied, "critDamageMod");
  const npDamageMod = sumSlot(applied, "npDamageMod");
  const specialDefMod = sumSlot(applied, "specialDefMod") + input.enemy.specialDefMod / 100;
  const flatDamage = applied.filter((b) => b.slot === "flatDamage").reduce((a, b) => a + b.value, 0);

  // ---- super-efetivo
  const dmgEffect = isNP && np && np.damageEffectIndex !== null ? np.effects[np.damageEffectIndex] : undefined;
  const se = dmgEffect?.superEffective;
  const seApplies = se !== undefined && se !== null && se.traits.some((t) => enemyTraits.has(t.name));
  const superEffectiveModifier = seApplies
    ? (se.valuesByOvercharge
        ? se.valuesByOvercharge[input.attacker.overcharge - 1]?.[input.attacker.npLevel - 1]
        : se.values[input.attacker.npLevel - 1]) ?? 100
    : 100;

  // ---- termos fixos
  const criticalModifier = input.action.isCrit ? k.criticalAttackRate : 1;
  const extraCardModifier =
    input.action.kind === "extra"
      ? input.action.braveChain
        ? k.extraAttackRateGrand
        : k.extraAttackRateSingle
      : 1;
  const busterChainBonus = input.action.busterChain && card === "buster" ? servantAtk * k.busterChainMod : 0;

  const constantPart =
    servantAtk *
    npDamageMultiplier *
    cardTerm *
    classAtkBonus *
    triangleModifier *
    attributeModifier *
    k.attackRate *
    (1 + atkMod - defMod) *
    criticalModifier *
    extraCardModifier *
    (1 - specialDefMod) *
    (1 + powerMod + (input.action.isCrit ? critDamageMod : 0) + (isNP ? npDamageMod : 0)) *
    (1 + (superEffectiveModifier / 100 - 1) * (seApplies ? 1 : 0));

  const withRoll = (roll: number) => Math.max(1, Math.floor(constantPart * roll + flatDamage + busterChainBonus));

  const min = withRoll(k.randomMin);
  const avg = withRoll(1);
  const max = withRoll(k.randomMax);

  const hits = isNP && np ? np.hits : attacker.hitsDistribution[card] ?? [100];
  const chosen = input.options.rollMode === "min" ? min : input.options.rollMode === "max" ? max : avg;
  const perHit = hits.map((pct) => Math.floor((chosen * pct) / 100));

  return {
    min,
    avg,
    max,
    perHit,
    breakdown: {
      servantAtk,
      npDamageMultiplier,
      cardMod,
      cardTerm,
      classAtkBonus,
      triangleModifier,
      attributeModifier,
      atkMod,
      defMod,
      powerMod,
      critDamageMod,
      npDamageMod,
      specialDefMod,
      superEffectiveModifier,
      flatDamage,
      pierceDefence: pierce,
    },
    assumptions: {
      rollMode: input.options.rollMode,
      resolved: [
        `${attacker.name} lv${input.attacker.level}`,
        `${input.attacker.fou} fou`,
        `NP${input.attacker.npLevel}`,
        `OC${input.attacker.overcharge}`,
        `alvo ${input.enemy.className}/${input.enemy.attribute}`,
        input.action.kind === "np" ? "NP" : `card ${card} pos${position}`,
        ...(input.action.isCrit ? ["crítico"] : []),
        ...(seApplies ? [`super-efetivo ${superEffectiveModifier}%`] : []),
      ],
      appliedBuffs: applied,
      skippedBuffs: skipped,
      // Chance < 100% nunca filtra: quem compõe o stack decide (D18/§4.5).
      uncertainBuffs: applied
        .filter((b) => b.chance < 100)
        .map((b) => ({ source: b.source, buffType: b.buffType, chance: b.chance })),
      unmodeled,
    },
  };
}
