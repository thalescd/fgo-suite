/**
 * Tabela única de tradução de buffs.
 *
 * Um buff do Atlas precisa ser interpretado por dois consumidores:
 *
 *   - a **busca** (fase 2), que quer uma tag semântica — "dá ATK pra party";
 *   - a **calculadora** (fase 3), que quer saber em qual termo da fórmula ele
 *     entra — `atkMod`, `cardMod`, `npDamageMod`…
 *
 * As duas decisões são a mesma leitura do mesmo dado, então moram na mesma
 * tabela. Manter dois catálogos separados garantiria que divergissem.
 *
 * Buff fora desta tabela não é ignorado: vira `slot: null` e `tag: null`, e a
 * calculadora reporta em `assumptions.unmodeled` (R12).
 */

/**
 * Termos da fórmula em `damage_formula.txt` que um buff pode alimentar.
 *
 * Os nomes são os do próprio arquivo, de propósito — quem for conferir a
 * implementação contra a fórmula não precisa traduzir nada.
 */
export type DamageSlot =
  | "atkMod" // (1 + atkMod - defMod)
  | "defMod" // idem, do lado do alvo
  | "cardMod" // (firstCardBonus + cardDamageValue * (1 + cardMod))
  | "powerMod" // {1 + powerMod + ...}
  | "critDamageMod" // idem, só em crítico
  | "npDamageMod" // idem, só em NP
  | "specialDefMod" // (1 - specialDefMod)
  | "flatDamage" // + dmgPlusAdd
  | "pierceDefence"; // ignora def up (mas não specialDefMod)

export interface BuffSpec {
  /** Termo da fórmula, ou `null` quando o buff não afeta dano. */
  slot: DamageSlot | null;
  /**
   * Raiz da tag de busca. O escopo (`self`/`party`) e o card, quando houver,
   * são acrescentados em `capabilities.ts` — aqui fica só o "o quê".
   *
   * `null` quando o efeito não interessa à busca (ruído de engine).
   */
  tag: string | null;
}

/**
 * Buffs que afetam dano.
 *
 * `downX` entra com sinal invertido no mesmo slot — a inversão é aplicada em
 * `signOf()`, não duplicada aqui.
 */
const DAMAGE: Record<string, BuffSpec> = {
  upAtk: { slot: "atkMod", tag: "atk_up" },
  downAtk: { slot: "atkMod", tag: "atk_down" },

  upDefence: { slot: "defMod", tag: "def_up" },
  downDefence: { slot: "defMod", tag: "def_down" },
  downDefencecommandall: { slot: "defMod", tag: "def_down" },

  // Card power up. A restrição de card vem de `condSelf` (R11) e vira parte da
  // tag: `buster_up`, `arts_up`… Sem isso a tag casaria com 87% do roster.
  upCommandall: { slot: "cardMod", tag: "card_up" },
  downCommandall: { slot: "cardMod", tag: "card_down" },

  upDamage: { slot: "powerMod", tag: "power_up" },
  downDamage: { slot: "powerMod", tag: "power_down" },
  upDamageIndividuality: { slot: "powerMod", tag: "power_up_vs_trait" },
  upDamageIndividualityActiveonly: { slot: "powerMod", tag: "power_up_vs_trait" },
  upSpecialdamage: { slot: "powerMod", tag: "power_up_vs_trait" },

  upCriticaldamage: { slot: "critDamageMod", tag: "crit_damage_up" },
  downCriticaldamage: { slot: "critDamageMod", tag: "crit_damage_down" },

  upNpdamage: { slot: "npDamageMod", tag: "np_damage_up" },
  downNpdamage: { slot: "npDamageMod", tag: "np_damage_down" },

  addDamage: { slot: "flatDamage", tag: "flat_damage" },
  subSelfdamage: { slot: "flatDamage", tag: "damage_cut" },

  pierceDefence: { slot: "pierceDefence", tag: "pierce_defence" },
  pierceInvincible: { slot: null, tag: "pierce_invincible" },

  /**
   * Multiplica o **valor de outros buffs**, então não tem slot próprio: age
   * sobre o slot de quem ele alcança. Quem alcança está em
   * `Effect.boostsBuffTraits`, e a aplicação fica em `damage.ts`.
   */
  buffRate: { slot: null, tag: "buff_boost" },
};

/**
 * Buffs que não afetam dano mas interessam à busca.
 *
 * Existir aqui é o que distingue "conhecido e irrelevante ao dano" de "nunca
 * visto" — a diferença entre a calculadora ficar quieta e ela avisar (R12).
 */
const UTILITY: Record<string, BuffSpec> = {
  upCriticalrate: { slot: null, tag: "crit_rate_up" },
  downCriticalrate: { slot: null, tag: "crit_rate_down" },
  upCriticalpoint: { slot: null, tag: "star_gen_up" },
  downCriticalpoint: { slot: null, tag: "star_gen_down" },
  upStarweight: { slot: null, tag: "star_weight_up" },
  downStarweight: { slot: null, tag: "star_weight_down" },
  upDropnp: { slot: null, tag: "np_gain_up" },
  downDropnp: { slot: null, tag: "np_gain_down" },

  regainNp: { slot: null, tag: "np_regen" },
  regainHp: { slot: null, tag: "heal_over_time" },
  regainStar: { slot: null, tag: "star_regen" },

  avoidance: { slot: null, tag: "evade" },
  invincible: { slot: null, tag: "invuln" },
  avoidInstantdeath: { slot: null, tag: "death_immune" },
  breakAvoidance: { slot: null, tag: "ignore_evade" },
  guts: { slot: null, tag: "guts" },
  gutsRatio: { slot: null, tag: "guts" },

  upTolerance: { slot: null, tag: "debuff_resist_up" },
  downTolerance: { slot: null, tag: "debuff_resist_down" },
  upGrantstate: { slot: null, tag: "debuff_chance_up" },
  avoidState: { slot: null, tag: "debuff_immune" },
  donotAct: { slot: null, tag: "stun" },
  donotSkill: { slot: null, tag: "skill_seal" },
  donotNoble: { slot: null, tag: "np_seal" },

  upHate: { slot: null, tag: "taunt" },
  multiattack: { slot: null, tag: "multiattack" },
  delayFunction: { slot: null, tag: null },
  addIndividuality: { slot: null, tag: null },
  fieldIndividuality: { slot: null, tag: null },
};

export const BUFF_SPECS: Record<string, BuffSpec> = { ...DAMAGE, ...UTILITY };

/** `downX` e `subX` entram no slot com sinal negativo. */
export function signOf(buffType: string): 1 | -1 {
  return /^(down|sub)/.test(buffType) ? -1 : 1;
}

export function specFor(buffType: string | null): BuffSpec | null {
  return buffType === null ? null : BUFF_SPECS[buffType] ?? null;
}

/**
 * Funções sem buff que ainda interessam à busca.
 *
 * `gainNp` é o caso importante: aparece em 66% do roster, então a tag sozinha
 * não filtra nada — `capabilities.ts` acrescenta um limiar de magnitude.
 */
export const FUNC_TAGS: Record<string, string> = {
  gainNp: "np_charge",
  gainNpFromTargets: "np_charge",
  gainNpBuffIndividualSum: "np_charge",
  lossNp: "np_drain",
  gainStar: "stars",
  gainHp: "heal",
  gainHpPer: "heal",
  hastenNpturn: "skill_charge",
  shortenSkill: "skill_cooldown_down",
  extendSkill: "skill_cooldown_up",
  instantDeath: "instant_death",
  forceInstantDeath: "instant_death",
  subState: "cleanse",
  moveToLastSubmember: "self_swap",
  transformServant: "transform",
};

/** Ignora defesa: pode vir do buff ou do próprio funcType do NP. */
export const PIERCE_FUNCS = new Set(["damageNpPierce"]);
