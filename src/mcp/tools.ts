/**
 * As tools, sem transporte.
 *
 * Funções puras sobre um `Store`: recebem os argumentos já validados, devolvem
 * um objeto. `server.ts` só amarra isto ao SDK. A separação existe para os
 * testes rodarem sem levantar stdio — uma tool quebrada precisa falhar num
 * `expect`, não num cliente MCP.
 *
 * **Toda string daqui é interface**, em inglês, pelo mesmo motivo de
 * `assumptions` (ver DAMAGE.md §5): é o que chega ao assistente.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { labelForTag } from "../core/capabilities.js";
import { calculateDamage, selectableNps, type DamageData } from "../core/damage.js";
import type { Effect, IndexEntryServant, NoblePhantasm, Servant, Skill } from "../core/model.js";
import { parseCalc, toDamageInput } from "../core/scenario.js";
import { EMPTY_FILTERS, search, type SearchFilters } from "../core/search.js";
import type { Store } from "./store.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Quantos cenários já foram conferidos contra fonte externa (R4).
 *
 * Lido do arquivo, não escrito à mão: a ressalva que acompanha todo cálculo
 * precisa envelhecer junto com a validação, senão vira decoração.
 */
export function validationState(): string {
  try {
    const f = JSON.parse(readFileSync(join(ROOT, "data", "validation.json"), "utf8")) as {
      cases: { expected: number | null }[];
    };
    const done = f.cases.filter((c) => c.expected !== null).length;
    return `${done}/${f.cases.length} scenarios verified against an external calculator`;
  } catch {
    return "validation state unknown";
  }
}

// ------------------------------------------------------------------ efeitos

/** Um efeito em uma linha. Verboso em JSON aninhado, legível assim. */
function describeEffect(e: Effect, levelIndex: number): string {
  const unit = e.valueUnit === "percent" ? "%" : "";
  const v = e.values[Math.min(levelIndex, e.values.length - 1)];
  const what = e.buffType ?? e.funcType;
  const parts = [`${what}${v !== undefined && v !== 0 ? ` ${v}${unit}` : ""} -> ${e.target}`];

  if (e.turns !== null && e.turns > 0) parts.push(`${e.turns}t`);
  if (e.chance < 100) parts.push(`${e.chance}% chance`);

  const conds = [...e.condSelf, ...e.condTarget].map((t) => t.name);
  if (conds.length > 0) parts.push(`only if ${conds.join("/")}`);

  if (e.valuesByOvercharge) {
    const row = e.valuesByOvercharge.map((r) => r[levelIndex] ?? r[0]);
    parts.push(`OC1-5: ${row.join("/")}${unit}`);
  }
  if (e.superEffective) {
    const names = e.superEffective.traits.map((t) => t.name).join("/");
    const vals = e.superEffective.valuesByOvercharge
      ? e.superEffective.valuesByOvercharge.map((r) => r[levelIndex] ?? r[0]).join("/")
      : String(e.superEffective.values[levelIndex] ?? e.superEffective.values[0]);
    parts.push(`extra damage vs ${names}: ${vals}%`);
  }
  if (!e.supported) parts.push("NOT MODELLED by the calculator");

  return parts.join(" · ");
}

const describeSkill = (sk: Skill, levelIndex: number) => ({
  num: sk.num,
  name: sk.name,
  ...(sk.cooldown.length > 0 ? { cooldown: `${sk.cooldown[0]}->${sk.cooldown[sk.cooldown.length - 1]}` } : {}),
  effects: sk.effects.map((e) => describeEffect(e, levelIndex)),
});

const describeNp = (np: NoblePhantasm, npLevelIndex: number, isDefault: boolean) => ({
  id: np.id,
  name: np.name,
  card: np.card,
  target: np.target,
  ...(isDefault ? { isDefault: true } : {}),
  damageMultiplierByNpLevel: np.damageMultiplier,
  hits: np.hits,
  // A ordem é contratual (D20): o que vem antes do dano entra no próprio golpe.
  effectsInExecutionOrder: np.effects.map((e, i) => {
    const mark =
      np.damageEffectIndex === i ? "[DAMAGE] " : np.damageEffectIndex !== null && i < np.damageEffectIndex ? "[before damage] " : "";
    return mark + describeEffect(e, npLevelIndex);
  }),
});

// -------------------------------------------------------------- search_servants

export interface SearchArgs {
  query?: string;
  className?: string[];
  rarity?: number[];
  attribute?: string[];
  npTarget?: string[];
  npCard?: string[];
  capabilities?: string[];
  traits?: string[];
  welfareOnly?: boolean;
  sort?: string;
  dir?: string;
  limit?: number;
}

export function searchServants(store: Store, a: SearchArgs) {
  const unknownTraits: string[] = [];
  const traitIds = (a.traits ?? []).map((name) => {
    const t = store.traits.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!t) unknownTraits.push(name);
    return t?.id;
  }).filter((x): x is number => x !== undefined);

  const unknownCaps = (a.capabilities ?? []).filter(
    (c) => !store.servantIndex.some((s) => s.capabilities.includes(c)),
  );

  const filters: SearchFilters = {
    ...EMPTY_FILTERS,
    kind: "servant",
    text: a.query ?? "",
    className: a.className ?? [],
    rarity: a.rarity ?? [],
    attribute: a.attribute ?? [],
    npTarget: a.npTarget ?? [],
    npCard: a.npCard ?? [],
    capabilities: a.capabilities ?? [],
    traitIds,
    welfare: a.welfareOnly === true ? true : null,
    sort: (a.sort ?? EMPTY_FILTERS.sort) as SearchFilters["sort"],
    dir: (a.dir ?? EMPTY_FILTERS.dir) as SearchFilters["dir"],
  };

  const hits = search(store.index, filters) as IndexEntryServant[];
  const limit = Math.min(Math.max(a.limit ?? 30, 1), 200);

  return {
    total: hits.length,
    showing: Math.min(limit, hits.length),
    // Filtro que não casa com nada é erro de digitação em 100% dos casos, e
    // devolver zero resultados sem dizer por quê manda o assistente adivinhar.
    ...(unknownTraits.length > 0 ? { unknownTraits } : {}),
    ...(unknownCaps.length > 0 ? { unknownCapabilities: unknownCaps } : {}),
    servants: hits.slice(0, limit).map((s) => ({
      id: s.id,
      no: s.collectionNo,
      name: s.name,
      class: s.className,
      rarity: s.rarity,
      attribute: s.attribute,
      np: s.npTarget && s.npCard ? `${s.npCard} ${s.npTarget}` : null,
      atk: s.atkAtDefault,
      ...(s.isWelfare ? { welfare: true } : {}),
    })),
  };
}

// ----------------------------------------------------------------- get_servant

export function getServant(store: Store, ref: string) {
  const entry = store.findServant(ref);
  if (!entry) return { error: `No servant matches "${ref}". Try search_servants first.` };

  const s: Servant = store.servant(entry.id);
  const npLevelIndex = (s.rarity <= 3 || s.isWelfare ? 5 : 1) - 1;
  const atk = (lv: number) => s.atkGrowth[lv - 1] ?? null;

  return {
    id: s.id,
    no: s.collectionNo,
    name: s.name,
    class: s.className,
    rarity: s.rarity,
    attribute: s.attribute,
    welfare: s.isWelfare,
    deck: s.cards,
    ...(s.aliases.length > 0 ? { aliases: s.aliases } : {}),

    // O preset padrão da calculadora, para o assistente não ter que adivinhar.
    defaults: {
      level: s.lvMax,
      fou: 1000,
      atk: (atk(s.lvMax) ?? 0) + 1000,
      npLevel: npLevelIndex + 1,
      note: `ATK at other levels: lv100 ${atk(100)}, lv120 ${atk(120)} (grail). Fou is always 1000 by default.`,
    },

    // Mais de um quando o servo troca card ou alvo do NP (R24).
    noblePhantasms: selectableNps(s).map((np) => describeNp(np, npLevelIndex, np.id === s.np?.id)),

    skills: s.skills.map((sk) => describeSkill(sk, 9)),
    skillNote: "Effect values shown at skill level 10.",

    classPassives: s.classPassive.map((sk) => describeSkill(sk, 0)),
    classPassiveNote: "Always active. The calculator includes these without being asked.",

    appendPassives: s.appendPassive.map((sk) => describeSkill(sk, 9)),
    appendPassiveNote: "Off by default; the player chooses to unlock them.",

    traits: s.traits.map((t) => t.name),
    capabilities: s.capabilities,
    ...(s.combatForms.length > 0
      ? { transformsInBattleInto: s.combatForms.map((id) => ({ id, name: store.servant(id).name })) }
      : {}),
    ...(s.combatFormOf !== null
      ? { inBattleFormOf: { id: s.combatFormOf, name: store.servant(s.combatFormOf).name } }
      : {}),
  };
}

// ------------------------------------------------------------ calculate_damage

export interface DamageArgs {
  servant: string;
  level?: number;
  fou?: number;
  npLevel?: number;
  overcharge?: number;
  hpPercent?: number;
  npId?: number;
  skills?: number[];
  skillLevel?: number;
  appendPassives?: number[];
  action?: string;
  cardPosition?: number;
  critical?: boolean;
  busterChain?: boolean;
  braveChain?: boolean;
  enemyClass?: string;
  enemyAttribute?: string;
  enemyTraits?: string[];
  enemyDefenceBuff?: number;
  enemySpecialDefence?: number;
  roll?: string;
}

export function calculateDamageTool(store: Store, a: DamageArgs) {
  const entry = store.findServant(a.servant);
  if (!entry) return { error: `No servant matches "${a.servant}". Try search_servants first.` };
  const servant = store.servant(entry.id);

  const unknownTraits: string[] = [];
  const traitIds = (a.enemyTraits ?? []).map((name) => {
    const t = store.traits.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!t) unknownTraits.push(name);
    return t?.id;
  }).filter((x): x is number => x !== undefined);

  // Monta a query string e passa pelo MESMO tradutor da tela. Reimplementar a
  // montagem do cenário aqui seria a forma mais fácil de a tool e a interface
  // divergirem em silêncio.
  const p = new URLSearchParams();
  const put = (k: string, v: string | number | undefined | null) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  };
  put("s", servant.id);
  put("lv", a.level);
  put("fou", a.fou);
  put("np", a.npLevel);
  put("oc", a.overcharge);
  put("hp", a.hpPercent);
  put("npid", a.npId);
  put("sk", (a.skills ?? []).join(","));
  put("sklv", a.skillLevel);
  put("ap", (a.appendPassives ?? []).join(","));
  put("act", a.action);
  put("pos", a.cardPosition);
  if (a.critical) p.set("crit", "1");
  if (a.busterChain) p.set("bchain", "1");
  if (a.braveChain) p.set("brave", "1");
  put("ec", a.enemyClass);
  put("ea", a.enemyAttribute);
  put("et", traitIds.join(","));
  put("edef", a.enemyDefenceBuff);
  put("esdef", a.enemySpecialDefence);
  put("roll", a.roll);

  const state = parseCalc(p);
  const data: DamageData = {
    servants: new Map([[servant.id, servant]]),
    equips: new Map(),
    mysticCodes: new Map(),
    constants: store.constants,
  };

  const r = calculateDamage(toDamageInput(state, servant, (id) => store.traitName(id)), data);
  const b = r.breakdown;

  return {
    servant: servant.name,
    damage: { guaranteed: r.min, average: r.avg, maximum: r.max },
    ...(r.perHit.length > 1 ? { perHit: r.perHit } : {}),
    scenario: r.assumptions.resolved,
    // O link reproduz o cenário na tela — dá para conferir sem remontar nada.
    viewInBrowser: `/calc?${p.toString()}`,

    formulaTerms: {
      servantAtk: b.servantAtk,
      npDamageMultiplier: b.npDamageMultiplier,
      // R25: sem isto, o multiplicador dobra e a resposta não diz por quê.
      ...(b.npHpBonus > 0 ? { npMultiplierFromMissingHp: `+${b.npHpBonus}%` } : {}),
      ...(b.hpPercent !== 100 ? { attackerHp: `${b.hpPercent}%` } : {}),
      cardTerm: Number(b.cardTerm.toFixed(4)),
      classAttackRate: b.classAtkBonus,
      classAdvantage: b.triangleModifier,
      ...(b.triangleModifierBase !== b.triangleModifier
        ? { classAdvantageNote: `overridden; the class chart gives ${b.triangleModifierBase}` }
        : {}),
      attributeModifier: b.attributeModifier,
      attackRate: store.constants.attackRate,
      ...(b.atkMod !== 0 ? { atkMod: b.atkMod } : {}),
      ...(b.defMod !== 0 ? { enemyDefMod: b.defMod } : {}),
      ...(b.powerMod !== 0 ? { powerMod: b.powerMod } : {}),
      ...(b.isCrit ? { criticalModifier: b.criticalModifier, critDamageMod: b.critDamageMod } : {}),
      ...(b.isNP && b.npDamageMod !== 0 ? { npDamageMod: b.npDamageMod } : {}),
      ...(b.extraCardModifier !== 1 ? { extraCardModifier: b.extraCardModifier } : {}),
      ...(b.superEffectiveModifier !== 100 ? { superEffective: `${b.superEffectiveModifier}%` } : {}),
      ...(b.flatDamage !== 0 ? { flatDamage: b.flatDamage } : {}),
      ...(b.busterChainBonus !== 0 ? { busterChainBonus: Math.round(b.busterChainBonus) } : {}),
      ...(b.pierceDefence ? { piercesDefence: true } : {}),
    },

    buffsCounted: r.assumptions.appliedBuffs
      .filter((x) => x.counted)
      .map(
        (x) =>
          `${x.buffType} ${x.value} [${x.slot}] from ${x.source}` +
          (x.boostedBy ? ` (boosted by ${x.boostedBy})` : "") +
          // R25: dizer que o buff é sensível a HP importa mesmo com HP cheio,
          // que é justamente quando ele vale menos.
          (x.atFullHp !== undefined ? ` (scales with HP; ${x.atFullHp} at full HP)` : ""),
      ),
    // O que NÃO entrou, com o motivo. É o que permite a quem lê perceber que
    // faltou marcar uma skill, em vez de aceitar um número baixo como verdade.
    notCounted: [
      ...r.assumptions.appliedBuffs
        .filter((x) => !x.counted)
        .map((x) => `${x.buffType} from ${x.source} — only applies to ${x.slot === "npDamageMod" ? "NP damage" : "critical hits"}`),
      ...r.assumptions.skippedBuffs.map((x) => `${x.buffType} from ${x.source} — ${x.reason}`),
    ],
    ...(r.assumptions.uncertainBuffs.length > 0
      ? {
          notGuaranteedToTrigger: r.assumptions.uncertainBuffs.map((x) => `${x.buffType} (${x.chance}%)`),
        }
      : {}),
    ...(r.assumptions.unmodeled.length > 0 ? { presentButNotModelled: r.assumptions.unmodeled } : {}),
    ...(unknownTraits.length > 0 ? { unknownEnemyTraits: unknownTraits } : {}),

    notModelledAtAll:
      "Craft Essences, Mystic Codes, support servants, and state conditions other than HP (buff counts, turn number) are not part of this calculation.",
    validation: validationState(),
  };
}

// ---------------------------------------------------------- list_capabilities

export function listCapabilities(store: Store, filter?: string) {
  const counts = new Map<string, number>();
  for (const s of store.servantIndex) {
    for (const c of s.capabilities) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const q = filter?.trim().toLowerCase();
  const rows = [...counts.entries()]
    .filter(([tag]) => !q || tag.includes(q))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, n]) => ({ tag, servants: n, means: labelForTag(tag) }));

  return {
    total: counts.size,
    matching: rows.length,
    format: "<what>[_<threshold>]_<scope>. Thresholds are cumulative: np_charge_50_self also satisfies np_charge_20_self.",
    usage: "Pass these to search_servants as `capabilities`. Several tags are combined with AND.",
    capabilities: rows,
  };
}
