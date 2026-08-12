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

import { PIERCE_FUNCS, SLOT_SIDE, sideOfTarget, signOf, specFor, type DamageSlot } from "./buffs.js";
import type {
  CardType,
  ClassRelationOverride,
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
  /** Já com o boost aplicado, quando houver. */
  value: number;
  chance: number;
  /** Valor antes do boost, e de onde ele veio. Ausentes quando não houve boost. */
  boostedFrom?: number;
  boostedBy?: string;
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
    /** Já com a sobrescrita aplicada, quando houver. */
    triangleModifier: number;
    /** Da matriz padrão. Diferente de `triangleModifier` só quando houve override (R22). */
    triangleModifierBase: number;
    attributeModifier: number;
    atkMod: number;
    defMod: number;
    powerMod: number;
    /**
     * Soma dos buffs no slot, **esteja ou não valendo nesta ação**.
     *
     * `critDamageMod` só entra na fórmula num crítico e `npDamageMod` só num NP.
     * Quem lê o breakdown precisa dos dois fatos separados — "tenho o buff" e
     * "ele contou" —, por isso o valor fica cru aqui e `isCrit`/`isNP` dizem se
     * foi usado. Zerar o campo esconderia um buff que o jogador tem.
     */
    critDamageMod: number;
    npDamageMod: number;
    isNP: boolean;
    isCrit: boolean;
    specialDefMod: number;
    superEffectiveModifier: number;
    /** 1 ou `CRITICAL_ATTACK_RATE`. */
    criticalModifier: number;
    /** 1, `EXTRA_ATTACK_RATE_SINGLE` ou `_GRAND`. */
    extraCardModifier: number;
    flatDamage: number;
    /** `servantAtk * busterChainMod`, somado fora do produto. */
    busterChainBonus: number;
    pierceDefence: boolean;
  };
  /**
   * As premissas do cálculo, em texto.
   *
   * **Estas strings vão para a tela e para a resposta do MCP, então são em
   * inglês** — ao contrário dos comentários deste projeto. Quem editar `reason`
   * ou `source` está editando interface, não log.
   */
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
): {
  applied: ResolvedBuff[];
  skipped: SkippedBuff[];
  unmodeled: string[];
  relationOverrides: { source: string; buffType: string; rows: ClassRelationOverride[] }[];
} {
  const applied: ResolvedBuff[] = [];
  /** Traits de cada buff aplicado, paralelo a `applied` — só para casar boosts. */
  const appliedTraits: number[][] = [];
  const boosts: Boost[] = [];
  const relationOverrides: { source: string; buffType: string; rows: ClassRelationOverride[] }[] = [];
  const skipped: SkippedBuff[] = [];
  const unmodeled = new Set<string>();

  /** Condições de aplicação. Devolve o motivo da recusa, ou `null` se o efeito vale. */
  const rejectionOf = (e: Effect): string | null => {
    // condSelf: restrição do lado do atacante — quase sempre tipo de card.
    const cardConds = e.condSelf.filter((t) => t.name.startsWith("card"));
    if (cardConds.length > 0 && !cardConds.some((t) => t.name === CARD_TRAIT[actionCard])) {
      return `restricted to ${cardConds.map((t) => t.name).join("/")}, this attack uses ${CARD_TRAIT[actionCard]}`;
    }
    // condTarget: restrição do lado do inimigo.
    if (e.condTarget.length > 0 && !e.condTarget.some((t) => enemyTraits.has(t.name))) {
      return `requires a target with ${e.condTarget.map((t) => t.name).join("/")}`;
    }
    return null;
  };

  for (const c of candidates) {
    const e = c.effect;
    if (e.buffType === null) continue; // funções sem buff não alimentam slots
    const label = e.buffType;

    // Alcance: um buff `self` de um suporte fica no suporte. Debuff no inimigo
    // não passa por aqui — qualquer um da party pode aplicá-lo, e o def down de
    // um suporte é uma das maiores fontes de dano do jogo.
    const side = sideOfTarget(e.target);
    if (side === "attacker" && c.fromSupport && !REACHES_ALLY.has(e.target)) {
      skipped.push({ source: c.source, buffType: label, reason: `target ${e.target} does not reach the attacker` });
      continue;
    }

    const spec = specFor(e.buffType);
    if (spec === null) {
      unmodeled.add(e.buffType);
      continue;
    }

    // Nem boost nem override têm slot próprio: um age sobre o slot alheio, o
    // outro sobre o `triangleModifier`.
    const boostTargets = e.boostsBuffTraits ?? [];
    const relationRows = e.classRelationOverrides ?? [];
    if (spec.slot === null && boostTargets.length === 0 && relationRows.length === 0) continue;

    // Lado errado: o Def Up do atacante não é a defesa do alvo, e o Atk Down
    // aplicado no alvo não é o ataque do atacante. Nenhum dos dois muda o dano
    // causado, e os dois entrariam se o slot fosse lido sem o lado.
    if (spec.slot !== null && SLOT_SIDE[spec.slot] !== side) {
      skipped.push({
        source: c.source,
        buffType: label,
        reason:
          SLOT_SIDE[spec.slot] === "enemy"
            ? `lands on the attacker; only the target's ${spec.slot} changes damage dealt`
            : `lands on the target; only the attacker's ${spec.slot} changes damage dealt`,
      });
      continue;
    }

    const reason = rejectionOf(e);
    if (reason !== null) {
      skipped.push({ source: c.source, buffType: label, reason });
      continue;
    }

    if (relationRows.length > 0) {
      relationOverrides.push({ source: c.source, buffType: label, rows: relationRows });
      continue;
    }

    const raw = valueOf(e, c.levelIndex, input.attacker.overcharge);

    if (boostTargets.length > 0) {
      boosts.push({
        source: c.source,
        buffType: label,
        // Por id, nunca por nome: o Atlas não traduz todos os traits (R10).
        traitIds: new Set(boostTargets.map((t) => t.id)),
        traitNames: boostTargets.map((t) => t.name).join("/"),
        rate: raw,
      });
      continue;
    }

    applied.push({
      source: c.source,
      buffType: label,
      slot: spec.slot!,
      value: raw * signOf(e.buffType),
      chance: e.chance,
    });
    appliedTraits.push(e.buffTraits.map((t) => t.id));
  }

  applyBoosts(applied, appliedTraits, boosts, skipped);
  return { applied, skipped, unmodeled: [...unmodeled], relationOverrides };
}

interface Boost {
  source: string;
  buffType: string;
  traitIds: Set<number>;
  traitNames: string;
  /** Em %: 100 dobra o valor do buff alcançado. */
  rate: number;
}

/**
 * Buffs que multiplicam o valor de outros buffs (R21).
 *
 * A skill 3 do Oberon é o único caso no jogo: `buffRate` a 100% sobre os buffs
 * marcados `buffNpDamageUp`, ou seja, um `upNpdamage` de 20% passa a contar 40%.
 * `damage_formula.txt` não prevê isso — o post é de antes do Oberon existir.
 *
 * A correspondência é por **trait de buff**, não por nome do buff: se o jogo um
 * dia lançar um boost de ATK up, ele já funciona sem tocar aqui.
 *
 * Um boost que não alcançou nada vai para `skipped` em vez de sumir — a skill do
 * Oberon num alvo sem buff de NP damage não faz nada, e isso precisa aparecer.
 */
function applyBoosts(
  applied: ResolvedBuff[],
  appliedTraits: number[][],
  boosts: Boost[],
  skipped: SkippedBuff[],
): void {
  const used = new Set<Boost>();

  applied.forEach((b, i) => {
    const ids = appliedTraits[i] ?? [];
    const reaching = boosts.filter((x) => ids.some((id) => x.traitIds.has(id)));
    if (reaching.length === 0) return;

    // O estado é 重複不可 (não empilha). Entre vários, vale o maior.
    const best = reaching.reduce((m, x) => (x.rate > m.rate ? x : m));
    used.add(best);
    b.boostedFrom = b.value;
    b.value = b.value * (1 + best.rate / 100);
    b.boostedBy = `${best.source} +${best.rate}%`;
  });

  for (const x of boosts) {
    if (used.has(x)) continue;
    skipped.push({
      source: x.source,
      buffType: x.buffType,
      reason: `nothing to boost — no active buff carries ${x.traitNames}`,
    });
  }
}

/**
 * Monta os candidatos: as fontes declaradas no `BuffStack` **mais** as passivas
 * de classe, que não são declaráveis.
 *
 * Passiva de classe está sempre ativa no jogo — não se liga nem desliga, ao
 * contrário do append passive, que o jogador escolhe destravar (D8). Deixá-la a
 * cargo do chamador foi o que produziu o bug: **407 dos 462 servos** têm alguma
 * que afeta dano (349 só de Mad Enhancement, que é Buster up), e todos saíam
 * subestimados sem nenhum sintoma.
 */
function collectCandidates(input: DamageInput, data: DamageData): Candidate[] {
  const out: Candidate[] = [];
  const attacker = data.servants.get(input.attacker.servantId);
  if (!attacker) return out;

  for (const sk of attacker.classPassive) {
    for (const e of sk.effects) {
      // Passiva de classe não tem nível: o array de valores é constante.
      out.push({ effect: e, source: `${attacker.name} passive: ${sk.name}`, levelIndex: 0, fromSupport: false });
    }
  }

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
          out.push({ effect: e, source: `${attacker.name} NP (before the damage)`, levelIndex: input.attacker.npLevel - 1, fromSupport: false });
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

/**
 * Sobrescrita da matriz de classe (R22).
 *
 * A regra casa por **par de classes**, então uma mesma passiva pode trazer
 * várias linhas e nenhuma valer: a Nega-Saver da Kiara declara `assassin→ruler`
 * e `alterEgo→ruler`, e ela é alterEgo. Contra um Saber, nenhuma das duas casa —
 * e é isso que vira registro em `skipped`, para "não fez nada" ter explicação.
 *
 * `overwriteForce` é o único modo que aparece do lado do atacante hoje. O outro
 * (`overwriteMoreThanTarget`) é tratado como "vale o maior", leitura **não
 * conferida contra o jogo** por falta de caso real.
 */
function applyRelationOverrides(
  base: number,
  attackerClass: string,
  targetClass: string,
  overrides: { source: string; buffType: string; rows: ClassRelationOverride[] }[],
  skipped: SkippedBuff[],
): { triangleModifier: number; note: string | null } {
  let value = base;
  let note: string | null = null;

  for (const o of overrides) {
    const row = o.rows.find((r) => r.attackerClass === attackerClass && r.targetClass === targetClass);
    if (!row) {
      skipped.push({
        source: o.source,
        buffType: o.buffType,
        reason: `no class relation rule for ${attackerClass} vs ${targetClass}`,
      });
      continue;
    }
    const next = row.mode === "overwriteForce" ? row.rate : Math.max(value, row.rate);
    if (next === value) continue;
    note = `class advantage x${next} from ${o.source} (was x${value})`;
    value = next;
  }

  return { triangleModifier: value, note };
}

// ------------------------------------------------------------------- fórmula

const sumSlot = (buffs: ResolvedBuff[], slot: DamageSlot): number =>
  buffs.filter((b) => b.slot === slot).reduce((a, b) => a + b.value, 0) / 100;

export function calculateDamage(input: DamageInput, data: DamageData): DamageResult {
  const k = data.constants;
  const attacker = data.servants.get(input.attacker.servantId);
  if (!attacker) throw new Error(`servant ${input.attacker.servantId} is not loaded`);

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
  const { applied, skipped, unmodeled, relationOverrides } = resolveBuffs(candidates, input, enemyTraits, card);

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
  const triangleModifierBase = k.classRelation[attacker.className]?.[input.enemy.className] ?? 1;
  const { triangleModifier, note: relationNote } = applyRelationOverrides(
    triangleModifierBase,
    attacker.className,
    input.enemy.className,
    relationOverrides,
    skipped,
  );
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
  // `dmgPlusAdd` é o dano plano do atacante; `selfDmgCutAdd` é o corte de dano
  // do alvo, que entra negativo. Slots distintos porque os lados são distintos.
  const flatDamage =
    applied.filter((b) => b.slot === "dmgPlusAdd" || b.slot === "selfDmgCutAdd").reduce((a, b) => a + b.value, 0);

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
  // Duas regras do jogo sobre o que uma ação pode ser, não sobre como o dano é
  // calculado — mas moram aqui, e não na tela, para que nenhum chamador
  // (inclusive o MCP da fase 4) consiga pedir o impossível:
  //   1. um NP nunca é crítico;
  //   2. um NP nunca faz parte de uma chain, que é feita de command cards.
  const isCrit = input.action.isCrit && !isNP;
  const criticalModifier = isCrit ? k.criticalAttackRate : 1;
  const extraCardModifier =
    input.action.kind === "extra"
      ? input.action.braveChain
        ? k.extraAttackRateGrand
        : k.extraAttackRateSingle
      : 1;
  const busterChainBonus =
    input.action.kind === "card" && card === "buster" && input.action.busterChain
      ? servantAtk * k.busterChainMod
      : 0;

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
    (1 + powerMod + (isCrit ? critDamageMod : 0) + (isNP ? npDamageMod : 0)) *
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
      triangleModifierBase,
      attributeModifier,
      atkMod,
      defMod,
      powerMod,
      critDamageMod,
      npDamageMod,
      isNP,
      isCrit,
      specialDefMod,
      superEffectiveModifier,
      criticalModifier,
      extraCardModifier,
      flatDamage,
      busterChainBonus,
      pierceDefence: pierce,
    },
    assumptions: {
      rollMode: input.options.rollMode,
      resolved: [
        `${attacker.name} lv${input.attacker.level}`,
        `${input.attacker.fou} fou`,
        `NP${input.attacker.npLevel}`,
        `OC${input.attacker.overcharge}`,
        `vs ${input.enemy.className}/${input.enemy.attribute}`,
        input.action.kind === "np" ? "NP" : `card ${card} pos${position}`,
        ...(isCrit ? ["critical"] : []),
        ...(seApplies ? [`super effective ${superEffectiveModifier}%`] : []),
        ...(relationNote ? [relationNote] : []),
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
