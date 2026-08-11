/**
 * Transformação raw (Atlas) -> modelo canônico.
 *
 * Junto com atlas.ts, o único lugar do projeto que conhece o formato do Atlas.
 * Cada regra não óbvia aqui existe porque a alternativa produz erro silencioso;
 * a justificativa de cada uma está em docs/SCHEMA.md §5 e em PLANO.md (R7..R14).
 */

import type {
  Attribute,
  CardType,
  Constants,
  CraftEssence,
  Effect,
  MysticCode,
  NoblePhantasm,
  Servant,
  Skill,
  SuperEffective,
  Trait,
} from "../core/model.js";
import { convertMultiplier, convertRate, convertValues, isSupportedBuff, valueRuleFor } from "../core/units.js";
import type {
  AtlasAttributeRelation,
  AtlasCard,
  AtlasClassAttackRate,
  AtlasClassRelation,
  AtlasConstant,
  AtlasEquip,
  AtlasExtraAssets,
  AtlasFunction,
  AtlasMysticCode,
  AtlasNoblePhantasm,
  AtlasServant,
  AtlasSkill,
  AtlasSval,
  AtlasTrait,
} from "./atlas.js";

// ------------------------------------------------------------------ primitivos

/** O Atlas devolve o card como string numérica; nada disso sobrevive à ingestão. */
const CARD_BY_CODE: Record<string, CardType> = {
  "1": "arts",
  "2": "buster",
  "3": "quick",
  "4": "extra",
};

const WELFARE_FLAG = "ignoreCombineLimitSpecial";

function toCard(code: string | undefined): CardType | null {
  return code ? CARD_BY_CODE[code] ?? null : null;
}

function toTraits(ts: AtlasTrait[] | undefined): Trait[] {
  return (ts ?? []).map((t) => ({ id: t.id, name: t.name ?? "unknown" }));
}

function firstAsset(group: Record<string, Record<string, string>> | undefined): string | null {
  for (const bucket of Object.values(group ?? {})) {
    for (const url of Object.values(bucket)) return url;
  }
  return null;
}

function allAssets(group: Record<string, Record<string, string>> | undefined): string[] {
  const out: string[] = [];
  for (const bucket of Object.values(group ?? {})) out.push(...Object.values(bucket));
  return out;
}

// -------------------------------------------------------------------- efeitos

/**
 * Dicionário global de traits, id -> nome.
 *
 * Necessário porque o campo `Target` do super-efetivo traz só o id (2008), sem
 * nome. O dicionário é montado varrendo todos os pares `{id, name}` do dump —
 * 1070 ids — em vez de manter uma lista à mão que envelheceria.
 *
 * Estado de módulo é aceitável aqui: `ingest/` é o estágio de setup do pipeline,
 * roda uma vez por build. `core/` continua sem estado.
 */
let traitNames = new Map<number, string>();

export function setTraitNames(dict: Map<number, string>): void {
  traitNames = dict;
}

/** Varre o dump inteiro recolhendo pares `{id, name}` que parecem trait. */
export function collectTraitNames(raw: unknown): Map<number, string> {
  const dict = new Map<number, string>();
  const walk = (o: unknown): void => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) {
      o.forEach(walk);
      return;
    }
    const rec = o as Record<string, unknown>;
    if (typeof rec["id"] === "number" && typeof rec["name"] === "string" && Object.keys(rec).length <= 3) {
      dict.set(rec["id"] as number, rec["name"] as string);
    }
    for (const v of Object.values(rec)) walk(v);
  };
  walk(raw);
  return dict;
}

const traitById = (id: number): Trait => ({ id, name: traitNames.get(id) ?? "unknown" });

/**
 * Bônus super-efetivo, de `Target`/`TargetList` (traits do alvo) + `Correction`
 * (multiplicador). Só existe em funções `damageNp*`.
 *
 * `Correction` varia com overcharge em **52%** dos casos — bem mais que os
 * efeitos comuns —, então a matriz de OC aqui é a regra, não a exceção.
 * Gilgamesh: 150% no OC1 subindo até 200% no OC5 contra `weakToEnumaElish`.
 */
function toSuperEffective(f: AtlasFunction): SuperEffective | null {
  const first = f.svals?.[0];
  if (!first || first.Correction === undefined) return null;

  // `Target: 0` é placeholder de "sem trait único" — não vira entrada.
  const ids = [...(first.Target ? [first.Target] : []), ...(first.TargetList ?? [])].filter((id) => id !== 0);
  const corrections = (rows: AtlasSval[] | undefined) => (rows ?? []).map((s) => (s.Correction ?? 0) / 10);

  const values = corrections(f.svals);
  const ocRows = [f.svals, f.svals2, f.svals3, f.svals4, f.svals5];
  let valuesByOvercharge: number[][] | null = null;
  if (ocRows.every(Boolean)) {
    const rows = ocRows.map(corrections);
    if (rows.some((r) => JSON.stringify(r) !== JSON.stringify(rows[0]))) valuesByOvercharge = rows;
  }

  return { traits: ids.map(traitById), values, valuesByOvercharge };
}

function toEffect(f: AtlasFunction): Effect {
  const buff = f.buffs?.[0];
  const buffType = buff?.type ?? null;
  const svals = f.svals ?? [];

  const rule = valueRuleFor(f.funcType, buff !== undefined, buffType);
  const values = convertValues(
    svals.map((s) => s.Value),
    rule,
  );

  // Overcharge: o Atlas guarda uma lista por nível de OC. `svals` é o OC1;
  // svals2..svals5 são os demais. Só guardamos quando o valor realmente muda —
  // 75,7% das funções de NP são constantes e não precisam do array extra.
  const ocRows = [svals, f.svals2, f.svals3, f.svals4, f.svals5];
  const valuesByOvercharge = ocRows.every(Boolean)
    ? (() => {
        const rows = ocRows.map((r) => convertValues((r ?? []).map((s) => s.Value), rule));
        const varies = rows.some((r) => JSON.stringify(r) !== JSON.stringify(rows[0]));
        return varies ? rows : null;
      })()
    : null;

  const first = svals[0];

  return {
    funcType: f.funcType,
    target: f.funcTargetType,
    buffType,
    values,
    valuesByOvercharge,
    valueUnit: rule.unit,
    turns: first?.Turn ?? null,
    count: first?.Count ?? null,
    chance: convertRate(first?.Rate),
    // Obrigatórias — sem elas um buff de Buster é aplicado a um NP Arts (R11).
    condSelf: toTraits(buff?.ckSelfIndv),
    condTarget: toTraits(buff?.ckOpIndv),
    condFunc: toTraits(f.functvals),
    superEffective: toSuperEffective(f),
    supported: isSupportedBuff(buffType),
  };
}

function toEffects(fs: AtlasFunction[] | undefined): Effect[] {
  return (fs ?? []).map(toEffect);
}

// --------------------------------------------------------------------- skills

function toSkill(s: AtlasSkill): Skill {
  return {
    id: s.id,
    num: s.num ?? 0,
    name: s.name ?? "",
    detail: s.detail ?? "",
    cooldown: s.coolDown ?? [],
    effects: toEffects(s.functions),
    priority: s.priority ?? 0,
    condQuestId: s.condQuestId ?? 0,
  };
}

/**
 * Rank ups: 245 de 466 servos (53%) têm mais de uma versão da mesma skill, até 5.
 * Agrupa por `num`, mantém a de maior `priority` e guarda o resto em
 * `previousVersions`. Sem isso o ingestor pegaria uma versão arbitrária e a
 * calculadora erraria em metade do roster (R8).
 */
function resolveSkills(raw: AtlasSkill[] | undefined): Skill[] {
  const byNum = new Map<number, Skill[]>();
  for (const s of raw ?? []) {
    const skill = toSkill(s);
    const bucket = byNum.get(skill.num);
    if (bucket) bucket.push(skill);
    else byNum.set(skill.num, [skill]);
  }

  const out: Skill[] = [];
  for (const [, versions] of [...byNum.entries()].sort((a, b) => a[0] - b[0])) {
    versions.sort((a, b) => b.priority - a.priority);
    const active = versions[0]!;
    if (versions.length > 1) active.previousVersions = versions.slice(1);
    out.push(active);
  }
  return out;
}

// ------------------------------------------------------------------------- NP

/** effectFlags classifica o NP; conferido batendo 100% com funcTargetType. */
function npTarget(np: AtlasNoblePhantasm): "st" | "aoe" | "support" {
  const flags = np.effectFlags ?? [];
  if (flags.includes("attackEnemyOne")) return "st";
  if (flags.includes("attackEnemyAll")) return "aoe";
  if (flags.includes("support")) return "support";
  // Fallback para NPs sem flag: deduz pelo alvo da função de dano.
  const dmg = (np.functions ?? []).find((f) => f.funcType.startsWith("damageNp"));
  if (!dmg) return "support";
  return dmg.funcTargetType === "enemyAll" ? "aoe" : "st";
}

function npDamageMultiplier(np: AtlasNoblePhantasm): number[] | null {
  const dmg = (np.functions ?? []).find((f) => f.funcType.startsWith("damageNp"));
  if (!dmg) return null;
  const rule = valueRuleFor(dmg.funcType, false);
  return convertValues((dmg.svals ?? []).map((s) => s.Value), rule);
}

function toNp(np: AtlasNoblePhantasm): NoblePhantasm {
  const effects = toEffects(np.functions);
  // A ordem do array do Atlas É a ordem de execução; efeitos antes do dano
  // valem para o próprio dano deste NP.
  const dmgIndex = effects.findIndex((e) => e.funcType.startsWith("damageNp"));
  return {
    id: np.id,
    name: np.name ?? "",
    rank: np.rank ?? "",
    type: np.type ?? "",
    card: toCard(np.card) ?? "arts",
    target: npTarget(np),
    hits: np.npDistribution ?? [],
    damageMultiplier: npDamageMultiplier(np),
    effects,
    damageEffectIndex: dmgIndex >= 0 ? dmgIndex : null,
    priority: np.priority ?? 0,
    condQuestId: np.condQuestId ?? 0,
  };
}

/** 190 servos têm 2 NPs, um tem 9. Maior priority é o ativo (§5.1). */
function resolveNps(raw: AtlasNoblePhantasm[] | undefined): {
  np: NoblePhantasm | null;
  alternatives: NoblePhantasm[];
} {
  const all = (raw ?? []).map(toNp).sort((a, b) => b.priority - a.priority);
  if (all.length === 0) return { np: null, alternatives: [] };
  return { np: all[0]!, alternatives: all.slice(1) };
}

// ---------------------------------------------------------------------- servo

export const PLAYABLE_TYPES = new Set(["normal", "heroine"]);

function hitsByCard(raw: Record<string, number[]> | undefined): Partial<Record<CardType, number[]>> {
  const out: Partial<Record<CardType, number[]>> = {};
  for (const [code, dist] of Object.entries(raw ?? {})) {
    const card = CARD_BY_CODE[code];
    if (card) out[card] = dist;
  }
  return out;
}

export function toServant(s: AtlasServant, assets: AtlasExtraAssets | undefined): Servant {
  const { np, alternatives } = resolveNps(s.noblePhantasms);
  return {
    id: s.id,
    collectionNo: s.collectionNo,
    name: s.name,
    originalName: s.originalName ?? s.name,
    displayName: "", // preenchido em disambiguate()
    aliases: [],
    className: s.className,
    attribute: s.attribute as Attribute,
    rarity: s.rarity,
    cost: s.cost ?? 0,
    traits: toTraits(s.traits),
    isWelfare: s.flag === WELFARE_FLAG,
    lvMax: s.lvMax ?? 0,
    // `atkMax` do Atlas NÃO é copiado: é o ATK em lvMax, não o real. Ver R7.
    atkGrowth: s.atkGrowth ?? [],
    hpGrowth: s.hpGrowth ?? [],
    starGen: (s.starGen ?? 0) / 10,
    instantDeathChance: (s.instantDeathChance ?? 0) / 10,
    cards: (s.cards ?? []).map((c) => toCard(c)).filter((c): c is CardType => c !== null),
    hitsDistribution: hitsByCard(s.hitsDistribution),
    skills: resolveSkills(s.skills),
    classPassive: (s.classPassive ?? []).map(toSkill),
    appendPassive: (s.appendPassive ?? []).map((a) => toSkill(a.skill)),
    np,
    npAlternatives: alternatives,
    combatFormOf: null, // preenchido em linkCombatForms()
    combatForms: [],
    capabilities: [], // fase 2
    assets: {
      face: firstAsset(assets?.faces),
      charaGraph: allAssets(assets?.charaGraph),
    },
  };
}

/**
 * 76 nomes colidem ("Altria Pendragon" aparece 4×) e collectionNo não é único
 * (4 servos têm 0). displayName precisa distinguir sozinho (R9).
 */
export function disambiguate(servants: Servant[]): { collisions: number } {
  const seen = new Map<string, number>();
  let collisions = 0;

  for (const s of servants) {
    const base = `${s.name} (${s.className}, ${s.rarity}★)`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    if (n === 0) {
      s.displayName = base;
    } else {
      collisions++;
      s.displayName = `${s.name} (${s.className}, ${s.rarity}★ #${n + 1})`;
    }
  }
  return { collisions };
}

/**
 * Identifica **formas de combate** e as liga ao servo base.
 *
 * Alguns servos se transformam em batalha e a forma transformada é uma entrada
 * separada no dump — Hyde depois do NP do Jekyll, a segunda Aoko, Flora,
 * Prelati. Sem tratar isso, a busca mostra o mesmo personagem duas vezes.
 *
 * Detecção: a função `transformServant` carrega o `id` do alvo em `values[0]`.
 * Uma entrada é forma de combate quando é alvo de um `transformServant` vindo
 * de **outro** servo **e** tem `collectionNo === 0`.
 *
 * As duas condições juntas são necessárias:
 *  - só "é alvo" pegaria Ptolemaîos e Mélusine, que se transformam em si mesmos
 *    e têm número de coleção próprio;
 *  - só `collectionNo === 0` seria frágil, porque um lançamento ainda sem número
 *    cairia na regra.
 *
 * Conferência: excluir as formas resulta em 462 servos e 56 welfare — exatamente
 * o que o `basic_servant` do Atlas reporta, que faz o mesmo recorte.
 */
export function linkCombatForms(servants: Servant[]): { forms: Servant[] } {
  const byId = new Map(servants.map((s) => [s.id, s]));

  // alvo -> quem transforma nele
  const transformedBy = new Map<number, Set<number>>();
  for (const s of servants) {
    const effects = [
      ...s.skills.flatMap((k) => k.effects),
      ...s.classPassive.flatMap((k) => k.effects),
      ...(s.np?.effects ?? []),
      ...s.npAlternatives.flatMap((np) => np.effects),
    ];
    for (const e of effects) {
      if (e.funcType !== "transformServant") continue;
      const target = e.values[0];
      if (target === undefined || target === 0) continue;
      (transformedBy.get(target) ?? transformedBy.set(target, new Set()).get(target)!).add(s.id);
    }
  }

  const forms: Servant[] = [];
  for (const [targetId, sources] of transformedBy) {
    const target = byId.get(targetId);
    if (!target || target.collectionNo !== 0) continue;

    const base = [...sources].filter((id) => id !== targetId).map((id) => byId.get(id)).find(Boolean);
    if (!base) continue;

    target.combatFormOf = base.id;
    base.combatForms.push(target.id);
    forms.push(target);
  }
  return { forms };
}

/** NP level default: welfare tem precedência sobre raridade (§5.6). */
export function defaultNpLevel(s: Pick<Servant, "rarity" | "isWelfare">): 1 | 5 {
  return s.rarity <= 3 || s.isWelfare ? 5 : 1;
}

// ------------------------------------------------------------- craft essences

/**
 * funcTypes que só servem a farm/progressão. Se uma CE tem apenas estes, ela é
 * `farm`; se tem qualquer outro, é `combat`; se não tem nenhum efeito real, é
 * inerte e some na ingestão.
 *
 * Classificar por EFEITO e não por flag de origem é deliberado: as 462 CEs
 * `svtEquipFriendShip` são as bond CEs, das mais fortes do jogo (§5.7).
 */
const FARM_FUNCS = new Set([
  "eventDropUp",
  "eventDropRateUp",
  "eventPointUp",
  "expUp",
  "userEquipExpUp",
  "friendPointUp",
  "friendPointUpDuplicate",
  "servantFriendshipUp",
  "qpDropUp",
  "qpUp",
]);

export type EquipCategory = "combat" | "farm" | "inert";

export function classifyEquip(e: AtlasEquip): EquipCategory {
  const funcs = (e.skills ?? [])
    .flatMap((s) => s.functions ?? [])
    .map((f) => f.funcType)
    .filter((t) => t !== "none");

  if (funcs.length === 0) return "inert";
  // Desconhecido conta como combate: descartar é a ação destrutiva, então na
  // dúvida a CE fica.
  return funcs.some((t) => !FARM_FUNCS.has(t)) ? "combat" : "farm";
}

export function toCraftEssence(e: AtlasEquip, category: "combat" | "farm"): CraftEssence {
  const skills = e.skills ?? [];
  // condLimitCount separa o efeito base do de max limit break (R13):
  // Kaleidoscope dá 80% de NP base e 100% MLB.
  const base = skills.filter((s) => (s.condLimitCount ?? 0) === 0);
  const mlb = skills.filter((s) => (s.condLimitCount ?? 0) === 4);

  return {
    id: e.id,
    collectionNo: e.collectionNo,
    name: e.name,
    originalName: e.originalName ?? e.name,
    rarity: e.rarity,
    cost: e.cost ?? 0,
    lvMax: e.lvMax ?? 0,
    atkGrowth: e.atkGrowth ?? [],
    hpGrowth: e.hpGrowth ?? [],
    category,
    origin: e.flag ?? "unknown",
    effectsBase: base.flatMap((s) => toEffects(s.functions)),
    // Se a CE não tem variante MLB, o efeito base vale nos dois casos.
    effectsMlb: mlb.length ? mlb.flatMap((s) => toEffects(s.functions)) : base.flatMap((s) => toEffects(s.functions)),
    capabilities: [],
    assets: {
      face: firstAsset(e.extraAssets?.faces),
      charaGraph: firstAsset(e.extraAssets?.charaGraph),
    },
  };
}

// ---------------------------------------------------------------- mystic code

export function toMysticCode(m: AtlasMysticCode): MysticCode {
  const graphs = allAssets(m.extraAssets?.charaGraph);
  return {
    id: m.id,
    name: m.name,
    shortName: m.shortName ?? m.name,
    detail: m.detail ?? "",
    maxLv: m.maxLv ?? 10,
    // num é 0 nos três: a ordem no array É a identidade da skill.
    skills: (m.skills ?? []).map(toSkill),
    capabilities: [],
    assets: { male: graphs[0] ?? null, female: graphs[1] ?? null },
  };
}

// ----------------------------------------------------------------- constantes

export function toConstants(
  constant: AtlasConstant,
  classAttack: AtlasClassAttackRate,
  classRel: AtlasClassRelation,
  attrRel: AtlasAttributeRelation,
  card: AtlasCard,
): Constants {
  const div1000 = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, convertMultiplier(v)]));

  const cardMultiplier = {} as Constants["cardMultiplier"];
  for (const [code, positions] of Object.entries(card)) {
    const name = CARD_BY_CODE[code];
    if (!name) continue;
    const byPos: Record<number, { adjustAtk: number; addAtk: number }> = {};
    for (const [pos, v] of Object.entries(positions)) {
      byPos[Number(pos)] = {
        adjustAtk: convertMultiplier(v.adjustAtk),
        addAtk: convertMultiplier(v.addAtk),
      };
    }
    cardMultiplier[name] = byPos;
  }

  const need = (key: string): number => {
    const v = constant[key];
    if (v === undefined) throw new Error(`NiceConstant não tem a chave ${key}`);
    return convertMultiplier(v);
  };

  return {
    attackRate: need("ATTACK_RATE"),
    criticalAttackRate: need("CRITICAL_ATTACK_RATE"),
    extraAttackRateSingle: need("EXTRA_ATTACK_RATE_SINGLE"),
    extraAttackRateGrand: need("EXTRA_ATTACK_RATE_GRAND"),
    randomMin: need("ATTACK_RATE_RANDOM_MIN"),
    randomMax: need("ATTACK_RATE_RANDOM_MAX"),
    busterChainMod: need("CHAINBONUS_BUSTER_RATE"),
    classAttackRate: div1000(classAttack),
    classRelation: Object.fromEntries(
      Object.entries(classRel).map(([atk, row]) => [atk, div1000(row)]),
    ),
    attributeRelation: Object.fromEntries(
      Object.entries(attrRel).map(([atk, row]) => [atk, div1000(row)]),
    ) as Constants["attributeRelation"],
    cardMultiplier,
  };
}
