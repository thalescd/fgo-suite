/**
 * Build: raw/ -> public/data/
 *
 * Lê os dumps baixados, aplica transform.ts e grava os artefatos que o site e o
 * MCP server consomem. Determinístico: mesma entrada, mesma saída.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { tagsForEffects } from "../core/capabilities.js";
import {
  SCHEMA_VERSION,
  type Constants,
  type CraftEssence,
  type Effect,
  type IndexEntry,
  type Meta,
  type MysticCode,
  type Servant,
  type Trait,
} from "../core/model.js";
import type {
  AtlasAttributeRelation,
  AtlasCard,
  AtlasClassAttackRate,
  AtlasClassRelation,
  AtlasConstant,
  AtlasEquip,
  AtlasMysticCode,
  AtlasServant,
} from "./atlas.js";
import { OUT_DIR, REGION } from "./sources.js";
import { loadManifest, readRaw } from "./sync.js";
import {
  PLAYABLE_TYPES,
  classifyEquip,
  collectTraitNames,
  setTraitNames,
  disambiguate,
  toConstants,
  toCraftEssence,
  linkCombatForms,
  toMysticCode,
  toServant,
} from "./transform.js";

/** Fou padrão do preset (§4.2 do PLANO): 1000 de ATK plano. */
const DEFAULT_FOU = 1000;

const write = async (rel: string, data: unknown) => {
  const path = join(OUT_DIR, rel);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(data));
};

/** ATK no preset padrão: nível natural máximo + fou. Nunca `atkMax` (R7). */
function statAtDefault(growth: number[], lvMax: number, fou: number): number {
  const idx = Math.min(Math.max(lvMax - 1, 0), growth.length - 1);
  return (growth[idx] ?? 0) + fou;
}

async function loadAliases(servants: Servant[]): Promise<string[]> {
  const warnings: string[] = [];
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await readFile(join("data", "aliases.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return ["data/aliases.json não encontrado — nenhum apelido carregado"];
  }

  const byCollectionNo = new Map<number, Servant[]>();
  for (const s of servants) {
    const bucket = byCollectionNo.get(s.collectionNo);
    if (bucket) bucket.push(s);
    else byCollectionNo.set(s.collectionNo, [s]);
  }

  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    const cn = Number(key);
    const matches = byCollectionNo.get(cn) ?? [];
    if (matches.length !== 1) {
      warnings.push(`aliases.json: collectionNo ${key} resolve para ${matches.length} servos — ignorado`);
      continue;
    }
    if (!Array.isArray(value)) {
      warnings.push(`aliases.json: valor de ${key} não é lista — ignorado`);
      continue;
    }
    matches[0]!.aliases = value.map(String);
  }
  return warnings;
}

/**
 * Nomes curados para traits que o dump não nomeia (R27).
 *
 * Aplicado **depois** de `collectTraitNames`, e só por cima de `unknown`: se o
 * Atlas passar a nomear o trait, o nome dele vence e a entrada curada vira
 * ruído — que é avisado, para a tabela não envelhecer calada.
 *
 * Nome vazio é pendência declarada, não erro: fica `unknown` sem reclamar.
 */
async function loadTraitNames(dict: Map<number, string>): Promise<string[]> {
  const warnings: string[] = [];
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await readFile(join("data", "traitNames.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return ["data/traitNames.json não encontrado — traits sem nome ficam `unknown`"];
  }

  let named = 0;
  let pending = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    const id = Number(key);
    if (!Number.isFinite(id)) {
      warnings.push(`traitNames.json: chave "${key}" não é um id — ignorada`);
      continue;
    }
    if (typeof value !== "string") {
      warnings.push(`traitNames.json: valor de ${key} não é string — ignorado`);
      continue;
    }
    if (value === "") {
      pending++;
      continue;
    }
    const atual = dict.get(id);
    if (atual !== undefined && atual !== "unknown") {
      warnings.push(`traitNames.json: ${id} já se chama "${atual}" no dump — entrada curada desnecessária`);
      continue;
    }
    dict.set(id, value);
    named++;
  }
  if (named > 0 || pending > 0) {
    warnings.push(`traitNames.json: ${named} trait(s) nomeado(s) à mão, ${pending} pendente(s)`);
  }
  return warnings;
}

/**
 * Traits de identidade que algum efeito realmente checa, ordenados por frequência.
 * Gerado a partir dos dados (D16) para que servo novo traga o trait dele sem
 * edição manual. Exclui os namespaces que não são identidade do inimigo:
 * buff* (estado), card* (lado do atacante), class* (derivado da classe).
 *
 * Três origens, e as três importam:
 *  - `condTarget` — o efeito só vale contra alvo com o trait;
 *  - `condFunc` — condição extra da função;
 *  - `superEffective.traits` — o dano extra do NP.
 *
 * A terceira ficou de fora até a fase 3 e o buraco só apareceu na tela: sem ela
 * `weakToEnumaElish` não existia no catálogo, ou seja, era impossível declarar o
 * alvo do Enuma Elish — justamente o caso que a calculadora precisa acertar.
 */
function buildTraitCatalog(
  servants: Servant[],
  equips: CraftEssence[],
  mysticCodes: MysticCode[],
): { id: number; name: string; uses: number }[] {
  const counts = new Map<number, { name: string; uses: number }>();

  const bump = (t: Trait) => {
    const skip = /^(buff|card|class)/.test(t.name) || t.name === "unknown";
    if (skip) return;
    const cur = counts.get(t.id);
    if (cur) cur.uses++;
    else counts.set(t.id, { name: t.name, uses: 1 });
  };

  const scan = (effects: Effect[]) => {
    for (const e of effects) {
      for (const t of e.condTarget) bump(t);
      for (const t of e.condFunc) bump(t);
      // Na família soma o trait pode descrever o **atacante** (R27): 〔Heroic
      // King〕 é stack do Charlemagne, não algo que um inimigo carregue. Este
      // catálogo é a lista de traits do inimigo (D16), então `countsOn: "self"`
      // fica de fora — senão a tela ofereceria um checkbox que não faz nada.
      if (e.superEffective && e.superEffective.countsOn !== "self") {
        for (const t of e.superEffective.traits) bump(t);
      }
    }
  };

  for (const s of servants) {
    const skills = [...s.skills, ...s.classPassive, ...s.appendPassive];
    scan(skills.flatMap((sk) => sk.effects));
    scan(s.np?.effects ?? []);
    scan(s.npAlternatives.flatMap((np) => np.effects));
  }
  for (const e of equips) scan([...e.effectsBase, ...e.effectsMlb]);
  for (const mc of mysticCodes) scan(mc.skills.flatMap((sk) => sk.effects));

  return [...counts.entries()]
    .map(([id, v]) => ({ id, name: v.name, uses: v.uses }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}

export interface BuildStats {
  servants: number;
  combatForms: number;
  equipsCombat: number;
  equipsFarm: number;
  equipsDropped: number;
  mysticCodes: number;
  traitCatalog: number;
  displayNameCollisions: number;
  warnings: string[];
}

export async function build(): Promise<BuildStats> {
  const warnings: string[] = [];
  const manifest = await loadManifest();
  if (!manifest.syncedAt) throw new Error("Nenhum sync registrado — rode `npm run data:sync` primeiro.");

  console.log("Lendo dumps...");
  const [rawServants, rawEquips, rawMcs, constant, classAttack, classRel, attrRel, card] = await Promise.all([
    readRaw<AtlasServant[]>("servants"),
    readRaw<AtlasEquip[]>("equips"),
    readRaw<AtlasMysticCode[]>("mystic_codes"),
    readRaw<AtlasConstant>("constant"),
    readRaw<AtlasClassAttackRate>("class_attack_rate"),
    readRaw<AtlasClassRelation>("class_relation"),
    readRaw<AtlasAttributeRelation>("attribute_relation"),
    readRaw<AtlasCard>("card"),
  ]);

  // O super-efetivo referencia traits só por id; o dicionário resolve os nomes.
  // A curadoria entra por cima, para os traits que o dump não nomeia (R27).
  const traitDict = collectTraitNames(rawServants);
  const traitWarnings = await loadTraitNames(traitDict);
  setTraitNames(traitDict);

  // ---- servos
  const servants: Servant[] = rawServants
    .filter((s) => PLAYABLE_TYPES.has(s.type))
    .map((s) => toServant(s, s.extraAssets))
    .sort((a, b) => a.collectionNo - b.collectionNo || a.id - b.id);

  // Formas de combate (Hyde, a 2ª Aoko, Flora, Prelati) continuam no artefato,
  // mas ficam fora do índice — apareceriam como duplicata do mesmo personagem.
  const { forms: combatForms } = linkCombatForms(servants);
  const indexed = servants.filter((s) => s.combatFormOf === null);

  // Capabilities (fase 2): derivadas dos mesmos efeitos que a calculadora lê.
  for (const s of servants) {
    s.capabilities = tagsForEffects([
      ...s.skills.flatMap((k) => k.effects),
      ...s.classPassive.flatMap((k) => k.effects),
      ...(s.np?.effects ?? []),
    ]);
  }

  const { collisions } = disambiguate(servants);
  warnings.push(...traitWarnings);
  warnings.push(...(await loadAliases(servants)));

  const noNp = servants.filter((s) => s.np === null);
  if (noNp.length) warnings.push(`${noNp.length} servo(s) sem NP: ${noNp.map((s) => s.name).join(", ")}`);

  const shortGrowth = servants.filter((s) => s.atkGrowth.length < s.lvMax);
  if (shortGrowth.length) {
    warnings.push(`${shortGrowth.length} servo(s) com atkGrowth menor que lvMax — ATK no preset pode estar truncado`);
  }

  // ---- craft essences
  const equips: CraftEssence[] = [];
  let dropped = 0;
  for (const e of rawEquips) {
    const category = classifyEquip(e);
    if (category === "inert") {
      dropped++;
      continue;
    }
    const ce = toCraftEssence(e, category);
    ce.capabilities = tagsForEffects(ce.effectsMlb);
    equips.push(ce);
  }
  equips.sort((a, b) => a.collectionNo - b.collectionNo || a.id - b.id);

  // ---- mystic codes
  const mysticCodes: MysticCode[] = rawMcs.map(toMysticCode).sort((a, b) => a.id - b.id);

  // ---- constantes
  const constants: Constants = toConstants(constant, classAttack, classRel, attrRel, card);

  // ---- índice
  const index: IndexEntry[] = [
    ...indexed.map((s) => ({
      kind: "servant" as const,
      id: s.id,
      collectionNo: s.collectionNo,
      name: s.name,
      displayName: s.displayName,
      aliases: s.aliases,
      face: s.assets.face,
      className: s.className,
      attribute: s.attribute,
      rarity: s.rarity,
      isWelfare: s.isWelfare,
      npTarget: s.np?.target ?? null,
      npCard: s.np?.card ?? null,
      traitIds: s.traits.map((t) => t.id),
      capabilities: s.capabilities,
      atkAtDefault: statAtDefault(s.atkGrowth, s.lvMax, DEFAULT_FOU),
      hpAtDefault: statAtDefault(s.hpGrowth, s.lvMax, DEFAULT_FOU),
    })),
    ...equips.map((e) => ({
      kind: "equip" as const,
      id: e.id,
      collectionNo: e.collectionNo,
      name: e.name,
      face: e.assets.face,
      rarity: e.rarity,
      cost: e.cost,
      category: e.category,
      origin: e.origin,
      capabilities: e.capabilities,
      atkAtDefault: statAtDefault(e.atkGrowth, e.lvMax, 0),
      hpAtDefault: statAtDefault(e.hpGrowth, e.lvMax, 0),
    })),
  ];

  const traitCatalog = buildTraitCatalog(servants, equips, mysticCodes);

  // ---- escrita
  console.log("Gravando artefatos...");
  await rm(OUT_DIR, { recursive: true, force: true });

  const meta: Meta = {
    schemaVersion: SCHEMA_VERSION,
    gameDataHash: manifest.gameDataHash,
    gameDataTimestamp: manifest.gameDataTimestamp,
    region: REGION,
    syncedAt: manifest.syncedAt,
    builtAt: new Date().toISOString(),
    counts: {
      servants: indexed.length,
      combatForms: combatForms.length,
      craftEssences: equips.length,
      craftEssencesDropped: dropped,
      mysticCodes: mysticCodes.length,
    },
  };

  await write("meta.json", meta);
  await write("index.json", index);
  await write("constants.json", constants);
  await write("traits.json", traitCatalog);
  await write("mysticCodes.json", mysticCodes);
  await Promise.all(servants.map((s) => write(`servant/${s.id}.json`, s)));
  await Promise.all(equips.map((e) => write(`equip/${e.id}.json`, e)));

  return {
    servants: indexed.length,
    combatForms: combatForms.length,
    equipsCombat: equips.filter((e) => e.category === "combat").length,
    equipsFarm: equips.filter((e) => e.category === "farm").length,
    equipsDropped: dropped,
    mysticCodes: mysticCodes.length,
    traitCatalog: traitCatalog.length,
    displayNameCollisions: collisions,
    warnings,
  };
}
