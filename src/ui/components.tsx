/** Componentes pequenos compartilhados entre listagem e detalhe. */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import type { Effect, IndexEntry, NoblePhantasm } from "../core/model.js";
import type { FacetOption } from "../core/search.js";

export const Stars = ({ n }: { n: number }) => (
  <span className="stars" title={`${n}★`}>{n === 0 ? "0★" : "★".repeat(n)}</span>
);

export function Facet({
  title,
  selectedCount,
  options,
  isSelected,
  onToggle,
  open = false,
}: {
  title: string;
  selectedCount: number;
  options: FacetOption<string | number>[];
  isSelected: (v: string | number) => boolean;
  onToggle: (v: string | number) => void;
  open?: boolean;
}) {
  if (options.length === 0) return null;
  return (
    <details className="facet" open={open || selectedCount > 0}>
      <summary>
        {title}
        {selectedCount > 0 && <span className="badge">{selectedCount}</span>}
      </summary>
      <div className="opts">
        {options.map((o) => {
          const on = isSelected(o.value);
          return (
            <label key={String(o.value)} className={`opt${o.count === 0 && !on ? " off" : ""}`}>
              <input type="checkbox" checked={on} onChange={() => onToggle(o.value)} />
              <span>{o.label}</span>
              <span className="count">{o.count}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}

export function ResultCard({ entry }: { entry: IndexEntry }) {
  const to = entry.kind === "servant" ? `/servant/${entry.id}` : `/equip/${entry.id}`;
  return (
    <Link to={to} className="card">
      {entry.face ? (
        <img src={entry.face} alt="" loading="lazy" width={128} height={128} />
      ) : (
        <div style={{ aspectRatio: 1, background: "var(--panel-2)" }} />
      )}
      <div className="body">
        <div className="name">{entry.name}</div>
        <div className="sub">
          <Stars n={entry.rarity} />
          {entry.kind === "servant" ? (
            <>
              <span>{entry.className}</span>
              {entry.npTarget && <span className={`chip ${entry.npTarget}`}>{entry.npTarget}</span>}
              {entry.npCard && <span className={`chip ${entry.npCard}`}>{entry.npCard}</span>}
              {entry.isWelfare && <span className="chip">welfare</span>}
            </>
          ) : (
            <>
              <span className={`chip ${entry.category === "combat" ? "st" : "support"}`}>{entry.category}</span>
              <span>cost {entry.cost}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

const unitOf = (e: Effect) => (e.valueUnit === "percent" ? "%" : "");

const varies = (xs: unknown[]) => new Set(xs.map((x) => JSON.stringify(x))).size > 1;

/**
 * Em qual eixo o valor deste efeito varia.
 *
 * Medido no dataset inteiro: **nenhum** efeito de NP varia nos dois eixos ao
 * mesmo tempo — 469 variam só por nível de NP, 446 só por overcharge, 963 são
 * constantes, 0 variam nos dois. Por isso uma coluna 1–5 pode servir aos dois
 * blocos, cada linha caindo no seu.
 *
 * O caso "both" é impossível hoje, mas fica tratado: se o Atlas passar a ter um
 * efeito assim, ele aparece marcado em vez de mostrar metade da verdade em
 * silêncio.
 */
export type ValueAxis = "npLevel" | "overcharge" | "constant" | "both";

export function axisOf(values: number[], byOvercharge: number[][] | null): ValueAxis {
  const byNp = varies(values);
  const byOc = byOvercharge !== null && varies(byOvercharge.map((r) => r[0]));
  if (byNp && byOc) return "both";
  if (byNp) return "npLevel";
  if (byOc) return "overcharge";
  return "constant";
}

/** Série de 5 valores no eixo em que o efeito varia. */
export function seriesFor(values: number[], byOvercharge: number[][] | null, axis: ValueAxis): number[] {
  if (axis === "overcharge" && byOvercharge) return byOvercharge.map((r) => r[0] ?? 0);
  return values;
}

/**
 * Parte qualitativa de um efeito: o que ele faz, em quem, sob que condição.
 *
 * As condições (`condSelf`/`condTarget`), a chance abaixo de 100% e os avisos
 * de unidade/buff não catalogado ficam visíveis de propósito — escondidos, são
 * exatamente o que vira cálculo errado silencioso na fase 3.
 */
export function EffectLabel({ effect }: { effect: Effect }) {
  const conds = [...effect.condSelf, ...effect.condTarget].map((t) => t.name);
  return (
    <>
      <span className="ftype">{effect.funcType}</span>
      {effect.buffType && <span> {effect.buffType}</span>}
      <span style={{ color: "var(--muted)", fontSize: 11 }}> → {effect.target}</span>
      {effect.turns !== null && effect.turns > 0 && (
        <span style={{ color: "var(--muted)", fontSize: 11 }}> · {effect.turns}t</span>
      )}
      {conds.length > 0 && <span className="cond"> if {conds.join(" + ")}</span>}
      {effect.chance < 100 && <span className="warn"> {effect.chance}% chance</span>}
      {effect.valueUnit === "unknown" && <span className="warn"> unit not mapped (raw value)</span>}
      {!effect.supported && <span className="warn"> uncatalogued buff</span>}
    </>
  );
}

/** Efeito em linha única — usado onde só existe um valor (Craft Essences). */
export function EffectRow({ effect, level }: { effect: Effect; level?: number }) {
  const idx = level !== undefined ? Math.min(level, effect.values.length - 1) : effect.values.length - 1;
  const value = effect.values[idx];
  return (
    <div className="effect">
      <EffectLabel effect={effect} />
      {value !== undefined && value !== 0 && (
        <span className="val">{value}{unitOf(effect)}</span>
      )}
    </div>
  );
}

/**
 * Tabela do Noble Phantasm.
 *
 * Um NP tem duas dimensões de cinco valores — nível de NP e overcharge — mas
 * **nenhum efeito varia nas duas** (medido: 0 de 1878). Então uma única régua de
 * colunas 1–5 serve às duas, com uma linha de cabeçalho por bloco dizendo o que
 * elas significam ali. É o que dispensa qualquer botão: tudo fica na tela.
 *
 * Os efeitos aparecem primeiro em ordem de execução, com o valor inline quando
 * é constante e a marcação de quais entram no próprio dano do NP.
 */
export function NpTable({ np }: { np: NoblePhantasm }) {
  interface Row {
    label: ReactNode;
    axis: ValueAxis;
    series: number[];
    unit: string;
  }

  const rows: Row[] = [];
  for (const e of np.effects) {
    const axis = axisOf(e.values, e.valuesByOvercharge);
    if (axis !== "constant") {
      rows.push({
        label: e.funcType.startsWith("damageNp") ? "NP damage" : e.buffType ?? e.funcType,
        axis,
        series: seriesFor(e.values, e.valuesByOvercharge, axis),
        unit: unitOf(e),
      });
    }
    const se = e.superEffective;
    if (se) {
      const seAxis = axisOf(se.values, se.valuesByOvercharge);
      const names = se.traits.map((t) => (t.name === "unknown" ? `trait ${t.id}` : t.name)).join(", ");
      const label = <span className="super">vs {names || "target"} — extra damage</span>;
      if (seAxis === "constant") {
        rows.push({ label, axis: "overcharge", series: Array(5).fill(se.values[0] ?? 0), unit: "%" });
      } else {
        rows.push({ label, axis: seAxis, series: seriesFor(se.values, se.valuesByOvercharge, seAxis), unit: "%" });
      }
    }
  }

  const npRows = rows.filter((r) => r.axis === "npLevel" || r.axis === "both");
  const ocRows = rows.filter((r) => r.axis === "overcharge");

  const block = (title: string, list: Row[]) =>
    list.length === 0 ? null : (
      <>
        <tr className="axis-head">
          <th>{title}</th>
          {[1, 2, 3, 4, 5].map((n) => (
            <th key={n}>{n}</th>
          ))}
        </tr>
        {list.map((r, i) => (
          <tr key={`${title}${i}`}>
            <td className="label">
              {r.label}
              {r.axis === "both" && <span className="warn"> varies on both axes — showing NP level</span>}
            </td>
            {[0, 1, 2, 3, 4].map((c) => (
              <td key={c}>{r.series[c] === undefined ? "—" : `${r.series[c]}${r.unit}`}</td>
            ))}
          </tr>
        ))}
      </>
    );

  return (
    <>
      <div className="np-effects">
        {np.effects.map((e, i) => {
          const axis = axisOf(e.values, e.valuesByOvercharge);
          const isDamage = np.damageEffectIndex === i;
          const before = np.damageEffectIndex !== null && i < np.damageEffectIndex;
          const v = e.values[0];
          return (
            <div key={i} className={`effect${isDamage ? " dmg" : ""}`}>
              {isDamage && <span className="step">DAMAGE</span>}
              {before && <span className="step pre">activates first</span>}
              <EffectLabel effect={e} />
              {axis === "constant" && v !== undefined && v !== 0 && (
                <span className="val">{v}{unitOf(e)}</span>
              )}
            </div>
          );
        })}
      </div>

      {(npRows.length > 0 || ocRows.length > 0) && (
        <div style={{ overflowX: "auto" }}>
          <table className="levels np">
            <tbody>
              {block("NP Level", npRows)}
              {block("Overcharge", ocRows)}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * Progressão de valores em tabela: uma linha por efeito, uma coluna por nível
 * (skill 1–10) ou por overcharge (NP 1–5).
 *
 * Efeitos cujo valor não muda ao longo das colunas são colapsados numa célula
 * só, com `colSpan`. Repetir dez vezes o mesmo número é ruído, e colapsar deixa
 * óbvio à primeira vista o que escala e o que não escala.
 */
export function EffectTable({
  effects,
  columns,
  valueAt,
  highlight,
}: {
  effects: Effect[];
  columns: string[];
  /** Valor do efeito na coluna i, ou undefined se não houver. */
  valueAt: (effect: Effect, columnIndex: number) => number | undefined;
  /** Índice da coluna a destacar (nível de skill em uso, overcharge padrão). */
  highlight?: number;
}) {
  if (effects.length === 0) return null;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="levels">
        <thead>
          <tr>
            <th />
            {columns.map((c, i) => (
              <th key={c} className={i === highlight ? "hl" : undefined}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {effects.flatMap((e, ei) => {
            const vals = columns.map((_, i) => valueAt(e, i));
            const first = vals[0];
            const constant = vals.every((v) => v === first);
            const rows = [
              <tr key={ei}>
                <td className="label"><EffectLabel effect={e} /></td>
                {constant ? (
                  <td className="same" colSpan={columns.length}>
                    {first === undefined || first === 0 ? "—" : `${first}${unitOf(e)} — constant`}
                  </td>
                ) : (
                  vals.map((v, i) => (
                    <td key={i} className={i === highlight ? "hl" : undefined}>
                      {v === undefined ? "—" : `${v}${unitOf(e)}`}
                    </td>
                  ))
                )}
              </tr>,
            ];

            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}

export const Block = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="block">
    <h3>{title}</h3>
    {children}
  </section>
);
