/**
 * Resultado do cálculo, com a auditoria junto.
 *
 * O número sozinho não serve: uma calculadora de dano que só devolve um total é
 * impossível de conferir, e um número errado é indistinguível de um certo. Por
 * isso cada termo da fórmula aparece com o valor que assumiu, e cada buff
 * aparece — inclusive **os que não entraram, com o motivo**.
 *
 * Foi lendo um desses motivos que o bug do card do NP apareceu (DAMAGE.md §3.1).
 */

import type { DamageResult } from "../core/damage.js";
import type { Constants } from "../core/model.js";

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const mult = (n: number) => `x${n.toFixed(2)}`;

/** Fração -> percentual legível: 0.3 vira "+30%", -0.2 vira "-20%". */
function pct(n: number): string {
  const v = n * 100;
  const s = Math.abs(v) < 0.05 ? "0" : Math.abs(v).toFixed(1).replace(/\.0$/, "");
  return `${v < 0 ? "-" : "+"}${s}%`;
}

interface Term {
  label: string;
  value: string;
  note?: string;
}

/**
 * Um termo por linha, na ordem em que aparecem na fórmula.
 *
 * Os termos neutros ficam de fora — mostrar dez linhas de `x1.00` esconde as
 * poucas que importam. O rodapé diz que o que não está listado é neutro, para
 * ausência não virar mistério.
 */
function termsOf(r: DamageResult, k: Constants): Term[] {
  const b = r.breakdown;
  const t: Term[] = [{ label: "Servant ATK", value: num(b.servantAtk) }];

  if (b.npDamageMultiplier !== 1) t.push({ label: "NP damage multiplier", value: mult(b.npDamageMultiplier) });

  t.push({
    label: "Card term",
    value: mult(b.cardTerm),
    note: b.cardMod !== 0 ? `includes ${pct(b.cardMod)} from card buffs` : undefined,
  });

  t.push({ label: "Class ATK rate", value: mult(b.classAtkBonus) });
  if (b.triangleModifier !== 1) t.push({ label: "Class advantage", value: mult(b.triangleModifier) });
  if (b.attributeModifier !== 1) t.push({ label: "Attribute", value: mult(b.attributeModifier) });
  t.push({ label: "Attack rate", value: mult(k.attackRate), note: "game constant" });

  if (b.atkMod !== 0 || b.defMod !== 0) {
    t.push({
      label: "ATK / DEF",
      value: mult(1 + b.atkMod - b.defMod),
      note: `${pct(b.atkMod)} attack, ${pct(b.defMod)} enemy defence${b.pierceDefence ? " (pierce: defence up ignored)" : ""}`,
    });
  } else if (b.pierceDefence) {
    t.push({ label: "ATK / DEF", value: mult(1), note: "pierce: defence up ignored" });
  }

  if (b.criticalModifier !== 1) t.push({ label: "Critical", value: mult(b.criticalModifier) });
  if (b.extraCardModifier !== 1) t.push({ label: "Extra card", value: mult(b.extraCardModifier) });
  if (b.specialDefMod !== 0) t.push({ label: "Special defence", value: mult(1 - b.specialDefMod), note: pct(-b.specialDefMod) });

  // Só o que a fórmula de fato somou: crit damage exige crítico, NP damage exige
  // NP. Somar os três sempre daria um fator que o número não usou.
  const crit = b.isCrit ? b.critDamageMod : 0;
  const npDmg = b.isNP ? b.npDamageMod : 0;
  const power = b.powerMod + crit + npDmg;
  if (power !== 0) {
    const parts = [
      b.powerMod !== 0 ? `${pct(b.powerMod)} power` : null,
      crit !== 0 ? `${pct(crit)} crit damage` : null,
      npDmg !== 0 ? `${pct(npDmg)} NP damage` : null,
    ].filter(Boolean);
    t.push({ label: "Damage bonuses", value: mult(1 + power), note: parts.join(", ") });
  }

  if (b.superEffectiveModifier !== 100) {
    t.push({ label: "Super effective", value: mult(b.superEffectiveModifier / 100) });
  }
  if (b.flatDamage !== 0) t.push({ label: "Flat damage", value: `+${num(b.flatDamage)}`, note: "added outside the product" });
  if (b.busterChainBonus !== 0) {
    t.push({ label: "Buster chain", value: `+${num(b.busterChainBonus)}`, note: "added outside the product" });
  }

  return t;
}

export function DamageReport({ result, constants }: { result: DamageResult; constants: Constants }) {
  const a = result.assumptions;
  const chosen = a.rollMode === "min" ? result.min : a.rollMode === "max" ? result.max : result.avg;
  const rollLabel =
    a.rollMode === "min" ? "minimum roll (x0.9)" : a.rollMode === "max" ? "maximum roll (x1.1)" : "average roll";

  return (
    <div className="report">
      <div className="headline">
        <div className="big">{num(chosen)}</div>
        <div className="roll">{rollLabel}</div>
        <div className="range">
          guaranteed <strong>{num(result.min)}</strong> · average {num(result.avg)} · up to {num(result.max)}
        </div>
      </div>

      <div className="assumed">
        {a.resolved.map((x, i) => <span key={i} className="chip">{x}</span>)}
      </div>

      {result.perHit.length > 1 && (
        <p className="hitline">
          {result.perHit.length} hits: {result.perHit.map(num).join(" · ")}
        </p>
      )}

      <h4>Formula terms</h4>
      <table className="terms">
        <tbody>
          {termsOf(result, constants).map((t) => (
            <tr key={t.label}>
              <td className="label">{t.label}</td>
              <td className="value">{t.value}</td>
              <td className="note">{t.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="footnote">Terms not listed are neutral for this attack.</p>

      <h4>Buffs applied ({a.appliedBuffs.length})</h4>
      {a.appliedBuffs.length === 0 ? (
        <p className="footnote">None — this is the bare damage, with no buffs at all.</p>
      ) : (
        <ul className="bufflist">
          {a.appliedBuffs.map((b, i) => {
            // O buff está no stack, mas o slot dele não vale para esta ação.
            const idle =
              (b.slot === "npDamageMod" && !result.breakdown.isNP) ||
              (b.slot === "critDamageMod" && !result.breakdown.isCrit);
            return (
              <li key={i}>
                <span className="slot">{b.slot}</span>
                <span className="ftype">{b.buffType}</span>
                <span className="val">{b.slot === "flatDamage" ? `+${num(b.value)}` : pct(b.value / 100)}</span>
                <span className="src">{b.source}</span>
                {b.chance < 100 && <span className="warn">{b.chance}% chance</span>}
                {idle && (
                  <span className="reason">
                    not counted: {b.slot === "npDamageMod" ? "only applies to NP damage" : "only applies to critical hits"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {a.skippedBuffs.length > 0 && (
        <>
          <h4>Not applied ({a.skippedBuffs.length})</h4>
          <ul className="bufflist skipped">
            {a.skippedBuffs.map((b, i) => (
              <li key={i}>
                <span className="ftype">{b.buffType}</span>
                <span className="src">{b.source}</span>
                <span className="reason">{b.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {a.uncertainBuffs.length > 0 && (
        <p className="footnote warn">
          Not guaranteed to trigger: {a.uncertainBuffs.map((b) => `${b.buffType} (${b.chance}%)`).join(", ")}.
          They are counted anyway — deciding whether a buff is up is yours, not the calculator's.
        </p>
      )}

      {a.unmodeled.length > 0 && (
        <p className="footnote warn">
          Present but not modelled, so <strong>not</strong> in the number: {a.unmodeled.join(", ")}.
        </p>
      )}
    </div>
  );
}
