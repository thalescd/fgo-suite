/**
 * Motor de busca. Função pura sobre o índice — sem I/O, sem React.
 *
 * Genérico sobre `IndexEntry`: servos e Craft Essences compartilham texto,
 * raridade, ordenação e paginação; só as facetas são específicas de cada tipo.
 *
 * Os mesmos filtros viram a assinatura da tool do MCP na fase 4, por isso o
 * formato é serializável e plano.
 */

import type { IndexEntry, IndexEntryEquip, IndexEntryServant } from "./model.js";

// -------------------------------------------------------------------- filtros

export type SortKey = "collectionNo" | "rarity" | "atk" | "hp" | "name";
export type SortDir = "asc" | "desc";

export interface SearchFilters {
  kind: "servant" | "equip";
  text: string;

  // comuns
  rarity: number[];

  // servo
  className: string[];
  attribute: string[];
  npTarget: string[];
  npCard: string[];
  /** null = tanto faz */
  welfare: boolean | null;
  /** todos precisam bater (AND) */
  traitIds: number[];
  /** todas precisam bater (AND) — vale para servos e CEs */
  capabilities: string[];

  // craft essence
  category: string[];
  origin: string[];

  sort: SortKey;
  dir: SortDir;
}

export const EMPTY_FILTERS: SearchFilters = {
  kind: "servant",
  text: "",
  rarity: [],
  className: [],
  attribute: [],
  npTarget: [],
  npCard: [],
  welfare: null,
  traitIds: [],
  capabilities: [],
  category: [],
  origin: [],
  sort: "collectionNo",
  dir: "asc",
};

export function isDefaultFilters(f: SearchFilters): boolean {
  return (
    f.text === "" &&
    f.rarity.length === 0 &&
    f.className.length === 0 &&
    f.attribute.length === 0 &&
    f.npTarget.length === 0 &&
    f.npCard.length === 0 &&
    f.welfare === null &&
    f.traitIds.length === 0 &&
    f.capabilities.length === 0 &&
    f.category.length === 0 &&
    f.origin.length === 0
  );
}

// --------------------------------------------------------------------- texto

/**
 * Normaliza para busca: minúsculas, sem acento, sem pontuação.
 *
 * Não é firula: o roster tem "Scáthach", "Aŋra Mainiiu", "Jeanne d'Arc".
 * Sem isso, digitar "scathach" não acha nada.
 */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // marcas de acento que o NFD separou
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Campos onde o texto é procurado, já normalizados. */
function haystack(e: IndexEntry): string {
  if (e.kind === "servant") {
    return normalize([e.name, e.displayName, ...e.aliases, String(e.collectionNo)].join(" "));
  }
  return normalize([e.name, String(e.collectionNo)].join(" "));
}

/** Cada termo tem de aparecer (AND), em qualquer ordem. */
function matchesText(e: IndexEntry, query: string): boolean {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const hay = haystack(e);
  return terms.every((t) => hay.includes(t));
}

// -------------------------------------------------------------------- filtro

const anyOf = <T,>(selected: T[], value: T): boolean => selected.length === 0 || selected.includes(value);

function matchesServant(e: IndexEntryServant, f: SearchFilters): boolean {
  if (!anyOf(f.className, e.className)) return false;
  if (!anyOf(f.attribute, e.attribute)) return false;
  if (f.npTarget.length && (e.npTarget === null || !f.npTarget.includes(e.npTarget))) return false;
  if (f.npCard.length && (e.npCard === null || !f.npCard.includes(e.npCard))) return false;
  if (f.welfare !== null && e.isWelfare !== f.welfare) return false;
  // AND: "divino E dragão" devolve só quem tem os dois.
  if (f.traitIds.length && !f.traitIds.every((id) => e.traitIds.includes(id))) return false;
  return true;
}

function matchesEquip(e: IndexEntryEquip, f: SearchFilters): boolean {
  if (!anyOf(f.category, e.category)) return false;
  if (!anyOf(f.origin, e.origin)) return false;
  return true;
}

export function matches(e: IndexEntry, f: SearchFilters): boolean {
  if (e.kind !== f.kind) return false;
  if (!anyOf(f.rarity, e.rarity)) return false;
  // AND: "buff de Buster na party E carga de NP" devolve só quem faz os dois.
  if (f.capabilities.length && !f.capabilities.every((c) => e.capabilities.includes(c))) return false;
  if (!matchesText(e, f.text)) return false;
  return e.kind === "servant" ? matchesServant(e, f) : matchesEquip(e, f);
}

// ------------------------------------------------------------------ ordenação

function sortValue(e: IndexEntry, key: SortKey): number | string {
  switch (key) {
    case "collectionNo":
      return e.collectionNo;
    case "rarity":
      return e.rarity;
    case "atk":
      return e.atkAtDefault;
    case "hp":
      return e.hpAtDefault;
    case "name":
      return normalize(e.name);
  }
}

export function sortEntries(entries: IndexEntry[], key: SortKey, dir: SortDir): IndexEntry[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === vb) return (a.collectionNo - b.collectionNo) * sign;
    return (typeof va === "string" ? String(va).localeCompare(String(vb)) : Number(va) - Number(vb)) * sign;
  });
}

export function search(index: IndexEntry[], f: SearchFilters): IndexEntry[] {
  return sortEntries(index.filter((e) => matches(e, f)), f.sort, f.dir);
}

// -------------------------------------------------------------------- facetas

export interface FacetOption<T = string> {
  value: T;
  label: string;
  /** Quantos resultados teria se esta opção fosse adicionada aos filtros atuais. */
  count: number;
}

/**
 * Contagem por opção, calculada IGNORANDO a própria dimensão.
 *
 * Sem isso, marcar "saber" zeraria a contagem de todas as outras classes e o
 * usuário não conseguiria ver quantos archers existem para trocar o filtro.
 */
export function facetCounts<K extends keyof SearchFilters>(
  index: IndexEntry[],
  filters: SearchFilters,
  dimension: K,
  valueOf: (e: IndexEntry) => (string | number)[] | string | number | null,
): Map<string, number> {
  const relaxed = { ...filters, [dimension]: EMPTY_FILTERS[dimension] } as SearchFilters;
  const counts = new Map<string, number>();
  for (const e of index) {
    if (!matches(e, relaxed)) continue;
    const raw = valueOf(e);
    if (raw === null) continue;
    for (const v of Array.isArray(raw) ? raw : [raw]) {
      const key = String(v);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}
