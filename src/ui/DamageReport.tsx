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

  if (b.npDamageMultiplier !== 1)
    t.push({
      label: "NP damage multiplier",
      value: mult(b.npDamageMultiplier),
      // R25: sem esta nota, o multiplicador do Hijikata muda de 8 para 16 e a
      // tela não diz por quê.
      note: b.npHpBonus > 0 ? `includes +${b.npHpBonus}% from missing HP` : undefined,
    });

  t.push({
    label: "Card term",
    value: mult(b.cardTerm),
    note: b.cardMod !== 0 ? `includes ${pct(b.cardMod)} from card buffs` : undefined,
  });

  t.push({ label: "Class ATK rate", value: mult(b.classAtkBonus) });
  if (b.triangleModifier !== 1 || b.triangleModifierBase !== b.triangleModifier) {
    t.push({
      label: "Class advantage",
      value: mult(b.triangleModifier),
      note:
        b.triangleModifierBase !== b.triangleModifier
          ? `overridden — the class chart gives ${mult(b.triangleModifierBase)}`
          : undefined,
    });
  }
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
    t.push({
      label: "Super effective",
      value: mult(b.superEffectiveModifier / 100),
      // R27: sem a nota, o multiplicador do Charlemagne sobe de 1.00 a 2.20 e a
      // tela não diz que foram os stacks que fizeram isso.
      note: b.superEffectiveStacks > 0 ? `${b.superEffectiveStacks} stacks counted` : undefined,
    });
  }
  if (b.flatDamage !== 0) t.push({ label: "Flat damage", value: `+${num(b.flatDamage)}`, note: "added outside the product" });
  if (b.busterChainBonus !== 0) {
    t.push({ label: "Buster chain", value: `+${num(b.busterChainBonus)}`, note: "added outside the product" });
  }

  return t;
}

/** Por que um buff resolvido não somou nesta ação. */
const idleReason = (slot: string) =>
  slot === "npDamageMod" ? "only applies to NP damage" : "only applies to critical hits";

export function DamageReport({ result, constants }: { result: DamageResult; constants: Constants }) {
  const a = result.assumptions;

  // "Aplicado" passa a significar "somou". Um buff que resolveu num slot que
  // esta ação não usa é, para quem lê o número, a mesma coisa que um buff
  // recusado: está no servo e não está no total. As duas listas viram uma.
  const counted = a.appliedBuffs.filter((b) => b.counted);
  const notCounted = [
    ...a.appliedBuffs
      .filter((b) => !b.counted)
      .map((b) => ({ buffType: b.buffType, source: b.source, reason: idleReason(b.slot) })),
    ...a.skippedBuffs,
  ];
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

      <h4>Buffs counted ({counted.length})</h4>
      {counted.length === 0 ? (
        <p className="footnote">None — this is the bare damage, with no buffs at all.</p>
      ) : (
        <ul className="bufflist">
          {counted.map((b, i) => (
            <li key={i}>
              <span className="slot">{b.slot}</span>
              <span className="ftype">{b.buffType}</span>
              <span className="val">
                {b.slot === "dmgPlusAdd" || b.slot === "selfDmgCutAdd" ? `+${num(b.value)}` : pct(b.value / 100)}
              </span>
              <span className="src">{b.source}</span>
              {b.chance < 100 && <span className="warn">{b.chance}% chance</span>}
              {b.boostedFrom !== undefined && (
                <span className="reason">
                  boosted from {pct(b.boostedFrom / 100)} by {b.boostedBy}
                </span>
              )}
              {/*
                Mostrado mesmo quando os dois são iguais: com HP cheio o buff
                está no seu mínimo, e isso é justamente o que vale saber (R25).
              */}
              {b.atFullHp !== undefined && (
                <span className="reason">
                  scales with HP — {pct(b.atFullHp / 100)} at full HP
                </span>
              )}
              {/* R30: o outro jeito de o HP mexer no buff — liga e desliga. */}
              {b.hpGate !== undefined && <span className="reason">only at {b.hpGate}</span>}
            </li>
          ))}
        </ul>
      )}

      {/*
        Fechado por padrão, mas com a contagem no rótulo: quem quer saber o
        número não precisa passar os olhos por dez recusas, e quem desconfia de
        uma ausência vê que há o que abrir. Esconder sem contar seria a versão
        ruim disto — foi lendo uma dessas recusas que o bug do card apareceu.
      */}
      {notCounted.length > 0 && (
        <details className="sub">
          <summary>
            Not counted ({notCounted.length}) — present, but adding nothing to this attack
          </summary>
          <ul className="bufflist skipped">
            {notCounted.map((b, i) => (
              <li key={i}>
                <span className="ftype">{b.buffType}</span>
                <span className="src">{b.source}</span>
                <span className="reason">{b.reason}</span>
              </li>
            ))}
          </ul>
        </details>
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
