import { useMemo, useState } from "react";

import type { IndexEntry } from "../core/model.js";
import { facetCounts, isDefaultFilters, search, type FacetOption } from "../core/search.js";
import { Facet, ResultCard } from "./components.js";
import type { Bootstrap } from "./data.js";
import { useFilters } from "./useFilters.js";

const PAGE = 120;

/** Ordem canônica das classes; as demais entram depois, alfabéticas. */
const CLASS_ORDER = [
  "saber", "archer", "lancer", "rider", "caster", "assassin", "berserker",
  "shielder", "ruler", "avenger", "alterEgo", "moonCancer", "foreigner", "pretender",
];

function build(
  counts: Map<string, number>,
  order?: string[],
  label: (v: string) => string = (v) => v,
): FacetOption<string | number>[] {
  const keys = [...counts.keys()];
  keys.sort((a, b) => {
    if (order) {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    }
    return a.localeCompare(b);
  });
  return keys.map((k) => ({ value: k, label: label(k), count: counts.get(k) ?? 0 }));
}

export function SearchPage({ boot }: { boot: Bootstrap }) {
  const { filters, set, toggle, reset } = useFilters();
  const [shown, setShown] = useState(PAGE);
  const { index, traits } = boot;

  const results = useMemo(() => search(index, filters), [index, filters]);

  // Contagens calculadas ignorando a própria dimensão, para o usuário conseguir
  // ver quantos resultados as outras opções teriam.
  const fc = (dim: Parameters<typeof facetCounts>[2], valueOf: (e: IndexEntry) => unknown) =>
    facetCounts(index, filters, dim, valueOf as never);

  const rarityOpts = useMemo(
    () =>
      [...fc("rarity", (e) => e.rarity).entries()]
        .map(([v, count]) => ({ value: Number(v), label: `${v}★`, count }))
        .sort((a, b) => Number(b.value) - Number(a.value)),
    [index, filters],
  );

  const classOpts = useMemo(
    () => build(fc("className", (e) => (e.kind === "servant" ? e.className : null)), CLASS_ORDER),
    [index, filters],
  );
  const attrOpts = useMemo(
    () => build(fc("attribute", (e) => (e.kind === "servant" ? e.attribute : null))),
    [index, filters],
  );
  const npOpts = useMemo(
    () => build(fc("npTarget", (e) => (e.kind === "servant" ? e.npTarget : null)), ["st", "aoe", "support"]),
    [index, filters],
  );
  const cardOpts = useMemo(
    () => build(fc("npCard", (e) => (e.kind === "servant" ? e.npCard : null)), ["buster", "arts", "quick"]),
    [index, filters],
  );
  const catOpts = useMemo(
    () => build(fc("category", (e) => (e.kind === "equip" ? e.category : null)), ["combat", "farm"]),
    [index, filters],
  );
  const originOpts = useMemo(
    () => build(fc("origin", (e) => (e.kind === "equip" ? e.origin : null))),
    [index, filters],
  );

  const traitOpts = useMemo(() => {
    const counts = fc("traitIds", (e) => (e.kind === "servant" ? e.traitIds : null));
    const named = new Map(traits.map((t) => [String(t.id), t.name]));
    return traits
      .filter((t) => counts.has(String(t.id)))
      .slice(0, 40)
      .map((t) => ({
        value: t.id as string | number,
        label: named.get(String(t.id)) ?? String(t.id),
        count: counts.get(String(t.id)) ?? 0,
      }));
  }, [index, filters, traits]);

  const isServant = filters.kind === "servant";
  const visible = results.slice(0, shown);

  return (
    <div className="layout">
      <aside className="sidebar">
        <Facet
          title="Rarity"
          selectedCount={filters.rarity.length}
          options={rarityOpts}
          isSelected={(v) => filters.rarity.includes(Number(v))}
          onToggle={(v) => { toggle("rarity", Number(v)); setShown(PAGE); }}
          open
        />
        {isServant ? (
          <>
            <Facet title="Class" selectedCount={filters.className.length} options={classOpts} open
              isSelected={(v) => filters.className.includes(String(v))}
              onToggle={(v) => { toggle("className", String(v)); setShown(PAGE); }} />
            <Facet title="NP target" selectedCount={filters.npTarget.length} options={npOpts} open
              isSelected={(v) => filters.npTarget.includes(String(v))}
              onToggle={(v) => { toggle("npTarget", String(v)); setShown(PAGE); }} />
            <Facet title="NP card" selectedCount={filters.npCard.length} options={cardOpts}
              isSelected={(v) => filters.npCard.includes(String(v))}
              onToggle={(v) => { toggle("npCard", String(v)); setShown(PAGE); }} />
            <Facet title="Attribute" selectedCount={filters.attribute.length} options={attrOpts}
              isSelected={(v) => filters.attribute.includes(String(v))}
              onToggle={(v) => { toggle("attribute", String(v)); setShown(PAGE); }} />
            <Facet title="Traits" selectedCount={filters.traitIds.length} options={traitOpts}
              isSelected={(v) => filters.traitIds.includes(Number(v))}
              onToggle={(v) => { toggle("traitIds", Number(v)); setShown(PAGE); }} />
            <details className="facet" open={filters.welfare !== null}>
              <summary>Availability</summary>
              <div className="opts">
                <label className="opt">
                  <input type="checkbox" checked={filters.welfare === true}
                    onChange={() => set({ welfare: filters.welfare === true ? null : true })} />
                  <span>welfare only</span>
                </label>
                <label className="opt">
                  <input type="checkbox" checked={filters.welfare === false}
                    onChange={() => set({ welfare: filters.welfare === false ? null : false })} />
                  <span>exclude welfare</span>
                </label>
              </div>
            </details>
          </>
        ) : (
          <>
            <Facet title="Category" selectedCount={filters.category.length} options={catOpts} open
              isSelected={(v) => filters.category.includes(String(v))}
              onToggle={(v) => { toggle("category", String(v)); setShown(PAGE); }} />
            <Facet title="Origin" selectedCount={filters.origin.length} options={originOpts}
              isSelected={(v) => filters.origin.includes(String(v))}
              onToggle={(v) => { toggle("origin", String(v)); setShown(PAGE); }} />
          </>
        )}
      </aside>

      <main>
        <div className="toolbar">
          <div className="tabs">
            <button aria-pressed={isServant} onClick={() => { set({ kind: "servant" }); setShown(PAGE); }}>
              Servants
            </button>
            <button aria-pressed={!isServant} onClick={() => { set({ kind: "equip" }); setShown(PAGE); }}>
              Craft Essences
            </button>
          </div>

          <input
            className="search-input"
            placeholder="name, alias or number…"
            value={filters.text}
            onChange={(e) => { set({ text: e.target.value }); setShown(PAGE); }}
          />

          <select value={`${filters.sort}:${filters.dir}`} onChange={(e) => {
            const [sort, dir] = e.target.value.split(":");
            set({ sort: sort as never, dir: dir as never });
          }}>
            <option value="collectionNo:asc">no. ↑</option>
            <option value="collectionNo:desc">no. ↓</option>
            <option value="rarity:desc">rarity ↓</option>
            <option value="rarity:asc">rarity ↑</option>
            <option value="atk:desc">ATK ↓</option>
            <option value="atk:asc">ATK ↑</option>
            <option value="hp:desc">HP ↓</option>
            <option value="name:asc">name A-Z</option>
          </select>

          {!isDefaultFilters(filters) && (
            <button className="linkish" onClick={() => { reset(); setShown(PAGE); }}>clear</button>
          )}
        </div>

        <p className="count-line">
          <strong>{results.length}</strong> {isServant ? "servants" : "craft essences"}
          {visible.length < results.length && <> · showing {visible.length}</>}
        </p>

        {results.length === 0 ? (
          <div className="empty">No results. Try relaxing the filters.</div>
        ) : (
          <>
            <div className="grid">
              {visible.map((e) => <ResultCard key={`${e.kind}${e.id}`} entry={e} />)}
            </div>
            {visible.length < results.length && (
              <div className="more">
                <button className="linkish" onClick={() => setShown((n) => n + PAGE)}>
                  show {Math.min(PAGE, results.length - visible.length)} more
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
