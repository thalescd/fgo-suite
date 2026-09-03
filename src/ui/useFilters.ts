/**
 * Filtros vivem na query string, não no estado do React.
 *
 * Três razões (PLANO §3.1): link compartilhável, botão voltar funciona, e — o
 * principal — estes parâmetros são a assinatura da tool do MCP na fase 4. UI e
 * servidor passam a falar a mesma linguagem de filtro em vez de divergir.
 *
 *   /?kind=servant&class=archer&rarity=5&np=aoe&sort=atk&dir=desc
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { EMPTY_FILTERS, type SearchFilters, type SortDir, type SortKey } from "../core/search.js";

/** Chaves curtas: o link é para ser lido e compartilhado. */
const KEYS = {
  kind: "kind",
  text: "q",
  rarity: "rarity",
  className: "class",
  attribute: "attr",
  npTarget: "np",
  npCard: "card",
  welfare: "welfare",
  traitIds: "trait",
  capabilities: "cap",
  category: "cat",
  origin: "origin",
  statKind: "stat",
  sort: "sort",
  dir: "dir",
} as const satisfies Record<keyof SearchFilters, string>;

const list = (p: URLSearchParams, k: string): string[] => {
  const v = p.get(k);
  return v ? v.split(",").filter(Boolean) : [];
};
const nums = (p: URLSearchParams, k: string): number[] =>
  list(p, k).map(Number).filter((n) => Number.isFinite(n));

export function parseFilters(p: URLSearchParams): SearchFilters {
  const kind = p.get(KEYS.kind) === "equip" ? "equip" : "servant";
  const sort = (p.get(KEYS.sort) ?? EMPTY_FILTERS.sort) as SortKey;
  const dir = (p.get(KEYS.dir) === "desc" ? "desc" : "asc") as SortDir;
  const welfareRaw = p.get(KEYS.welfare);

  return {
    kind,
    text: p.get(KEYS.text) ?? "",
    rarity: nums(p, KEYS.rarity),
    className: list(p, KEYS.className),
    attribute: list(p, KEYS.attribute),
    npTarget: list(p, KEYS.npTarget),
    npCard: list(p, KEYS.npCard),
    welfare: welfareRaw === null ? null : welfareRaw === "1",
    traitIds: nums(p, KEYS.traitIds),
    capabilities: list(p, KEYS.capabilities),
    category: list(p, KEYS.category),
    origin: list(p, KEYS.origin),
    statKind: list(p, KEYS.statKind),
    sort,
    dir,
  };
}

export function serializeFilters(f: SearchFilters): URLSearchParams {
  const p = new URLSearchParams();
  const put = (k: string, v: string) => { if (v) p.set(k, v); };

  if (f.kind !== EMPTY_FILTERS.kind) p.set(KEYS.kind, f.kind);
  put(KEYS.text, f.text.trim());
  put(KEYS.rarity, f.rarity.join(","));
  put(KEYS.className, f.className.join(","));
  put(KEYS.attribute, f.attribute.join(","));
  put(KEYS.npTarget, f.npTarget.join(","));
  put(KEYS.npCard, f.npCard.join(","));
  if (f.welfare !== null) p.set(KEYS.welfare, f.welfare ? "1" : "0");
  put(KEYS.traitIds, f.traitIds.join(","));
  put(KEYS.capabilities, f.capabilities.join(","));
  put(KEYS.category, f.category.join(","));
  put(KEYS.origin, f.origin.join(","));
  put(KEYS.statKind, f.statKind.join(","));
  if (f.sort !== EMPTY_FILTERS.sort) p.set(KEYS.sort, f.sort);
  if (f.dir !== EMPTY_FILTERS.dir) p.set(KEYS.dir, f.dir);
  return p;
}

type ArrayKeys =
  | "rarity" | "traitIds" | "capabilities" | "className" | "attribute"
  | "npTarget" | "npCard" | "category" | "origin" | "statKind";

export interface FilterApi {
  filters: SearchFilters;
  set: (patch: Partial<SearchFilters>) => void;
  /** Marca/desmarca um valor de faceta multi-seleção. */
  toggle: <K extends ArrayKeys>(key: K, value: SearchFilters[K][number]) => void;
  reset: () => void;
}

export function useFilters(): FilterApi {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);

  const set = useCallback(
    (patch: Partial<SearchFilters>) => {
      setParams(serializeFilters({ ...parseFilters(params), ...patch }), { replace: true });
    },
    [params, setParams],
  );

  const toggle = useCallback(
    <K extends ArrayKeys>(key: K, value: SearchFilters[K][number]) => {
      const cur = parseFilters(params)[key] as (typeof value)[];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      set({ [key]: next } as Partial<SearchFilters>);
    },
    [params, set],
  );

  const reset = useCallback(() => {
    // Preserva a aba (servo/CE) e a ordenação; zera só os filtros.
    const cur = parseFilters(params);
    setParams(serializeFilters({ ...EMPTY_FILTERS, kind: cur.kind, sort: cur.sort, dir: cur.dir }), {
      replace: true,
    });
  }, [params, setParams]);

  return { filters, set, toggle, reset };
}
