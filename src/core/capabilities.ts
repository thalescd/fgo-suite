/**
 * Derivação das tags de busca a partir dos efeitos.
 *
 * Traduz `(funcType, buffType, condSelf, target, valor)` numa tag que alguém
 * digitaria. Consome a mesma tabela que a calculadora (`buffs.ts`), para que
 * busca e fórmula nunca discordem sobre o que um buff é.
 *
 * Função pura: entra efeito, sai lista de strings.
 */

import { FUNC_TAGS, specFor } from "./buffs.js";
import type { CardType, Effect } from "./model.js";

/**
 * Alvos que alcançam aliados. `self` fica de fora de propósito: um buff que o
 * servo dá só a si mesmo é uma capability diferente de um que ele dá ao time.
 */
const PARTY_TARGETS = new Set([
  "ptAll",
  "ptFull",
  "ptOne",
  "ptOneOther",
  "ptOther",
  "ptSelfAnotherFirst",
  "ptselectOneSub",
  "ptselectSub",
]);

const ENEMY_TARGETS = new Set(["enemy", "enemyAll", "enemyFull", "enemyOther"]);

export type Scope = "self" | "party" | "enemy";

export function scopeOf(target: string): Scope {
  if (PARTY_TARGETS.has(target)) return "party";
  if (ENEMY_TARGETS.has(target)) return "enemy";
  return "self";
}

const CARD_BY_TRAIT: Record<string, CardType> = {
  cardBuster: "buster",
  cardArts: "arts",
  cardQuick: "quick",
  cardExtra: "extra",
};

/**
 * Card ao qual o buff está restrito, via `condSelf`.
 *
 * Sem isto, `card_up` casaria com 403 dos 462 servos (87%) e não filtraria
 * nada. Separado, vira `buster_up` (192), `arts_up` (216), `quick_up` (210).
 */
function cardOf(effect: Effect): CardType[] {
  return effect.condSelf
    .map((t) => CARD_BY_TRAIT[t.name])
    .filter((c): c is CardType => c !== undefined);
}

/**
 * Limiares de magnitude, para tags que sem eles não discriminam.
 *
 * `np_charge` aparece em 66% do roster; saber que "tem alguma carga" é inútil.
 * O que se busca é quem carrega o bastante para soltar o NP de cara. Idem para
 * buffs de ATK, card e crítico, todos acima de 45% sem o corte.
 *
 * Os valores seguem o vocabulário da comunidade: 20 / 30 / 50%.
 */
const THRESHOLDS: Record<string, number[]> = {
  np_charge: [20, 30, 50],
  atk_up: [20, 30, 50],
  crit_damage_up: [20, 30, 50],
  np_damage_up: [20, 30, 50],
  buster_up: [20, 30, 50],
  arts_up: [20, 30, 50],
  quick_up: [20, 30, 50],
  def_down: [20, 30, 50],
};

/** Valor de referência da tag: o maior nível disponível (skill lv10, NP5). */
function peakValue(effect: Effect): number {
  return effect.values.length === 0 ? 0 : Math.max(...effect.values);
}

/**
 * Limiares são **cumulativos**: quem carrega 50% também satisfaz "pelo menos
 * 20%".
 *
 * Atribuir só o maior limiar atingido pareceria natural mas quebra o filtro —
 * `np_charge_30` esconderia justamente os melhores carregadores, que teriam
 * apenas `_50`.
 */
function withThreshold(tag: string, value: number): string[] {
  const cuts = THRESHOLDS[tag];
  if (!cuts) return [tag];
  return [tag, ...cuts.filter((c) => value >= c).map((c) => `${tag}_${c}`)];
}

/**
 * Tags de um único efeito.
 *
 * Formato: `<o quê>_<escopo>`, com o card embutido quando há restrição —
 * `buster_up_party`, `np_charge_50_self`, `def_down_enemy`.
 */
export function tagsForEffect(effect: Effect): string[] {
  const scope = scopeOf(effect.target);
  const out: string[] = [];

  const spec = specFor(effect.buffType);
  const roots: string[] = [];

  if (spec?.tag) {
    if (spec.tag === "card_up" || spec.tag === "card_down") {
      const cards = cardOf(effect);
      const dir = spec.tag === "card_up" ? "up" : "down";
      // Sem restrição de card o buff vale para todos — tag genérica.
      roots.push(...(cards.length ? cards.map((c) => `${c}_${dir}`) : [`card_${dir}_all`]));
    } else {
      roots.push(spec.tag);
    }
  }

  const funcTag = FUNC_TAGS[effect.funcType];
  if (funcTag) roots.push(funcTag);

  for (const root of roots) {
    for (const t of withThreshold(root, peakValue(effect))) out.push(`${t}_${scope}`);
  }
  return out;
}

/** Tags de um conjunto de efeitos, sem repetição e em ordem estável. */
export function tagsForEffects(effects: Effect[]): string[] {
  const set = new Set<string>();
  for (const e of effects) for (const t of tagsForEffect(e)) set.add(t);
  return [...set].sort();
}

/**
 * Rótulo legível de uma tag, para a UI.
 *
 * Derivado por regra em vez de tabela manual: tag nova aparece na interface
 * sem precisar de edição.
 */
export function labelForTag(tag: string): string {
  const parts = tag.split("_");
  const scope = parts.pop() ?? "";
  const body = parts.join(" ").replace(/\bup\b/, "up").replace(/\bdown\b/, "down");
  const scopeLabel = scope === "self" ? "self" : scope === "party" ? "party" : "enemy";
  return `${body} (${scopeLabel})`;
}
