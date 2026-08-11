/** Componentes pequenos compartilhados entre listagem e detalhe. */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import type { Effect, IndexEntry } from "../core/model.js";
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
          {effects.map((e, ei) => {
            const vals = columns.map((_, i) => valueAt(e, i));
            const first = vals[0];
            const constant = vals.every((v) => v === first);
            return (
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
              </tr>
            );
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
