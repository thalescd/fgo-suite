/**
 * Tela da calculadora.
 *
 * Casca fina: toda a regra está em `core/damage.ts`. Aqui só se monta o cenário,
 * e o cenário inteiro vive na query string (ver `calcState.ts`).
 *
 * A tela mostra de propósito o que costuma ficar escondido — o multiplicador de
 * classe embutido na escolha do inimigo, quais buffs de uma skill afetam dano,
 * quais traits o inimigo realmente carrega. São exatamente os pontos onde um
 * número errado passa por certo.
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { specFor } from "../core/buffs.js";
import { calculateDamage, enemyTraitNames, selectableNps, type DamageData, type RollMode } from "../core/damage.js";
import type { IndexEntryServant, Servant, Skill } from "../core/model.js";
import { EMPTY_FILTERS, search } from "../core/search.js";
import { Block, Stars } from "./components.js";
import { DamageReport } from "./DamageReport.js";
import {
  defaultLevel,
  defaultNpLevel,
  parseCalc,
  serializeCalc,
  toDamageInput,
  type ActionKind,
  type CalcState,
} from "../core/scenario.js";
import { loadServant, type Bootstrap } from "./data.js";
import { useAsync } from "./useAsync.js";

const num = (n: number) => n.toLocaleString("en-US");

// ------------------------------------------------------------------ controles

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="flabel">{label}{hint && <em>{hint}</em>}</span>
      {children}
    </div>
  );
}

function Seg<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.value)} type="button" title={o.title} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const numbers = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ value: from + i, label: String(from + i) }));

// ------------------------------------------------------------- escolha do servo

function ServantPicker({ boot, onPick }: { boot: Bootstrap; onPick: (id: number) => void }) {
  const [query, setQuery] = useState("");

  // Reusa o motor de busca: apelido curado e insensibilidade a acento vêm de
  // graça, e "auo" acha o Gilgamesh aqui como acha na listagem.
  const matches = useMemo(() => {
    const text = query.trim();
    if (!text) return [];
    return search(boot.index, { ...EMPTY_FILTERS, kind: "servant", text }).slice(0, 8) as IndexEntryServant[];
  }, [boot.index, query]);

  return (
    <div className="picker">
      <input
        className="search-input"
        placeholder="who is attacking? name, alias or number…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      {matches.length > 0 && (
        <div className="matches">
          {matches.map((m) => (
            <button key={m.id} type="button" onClick={() => { onPick(m.id); setQuery(""); }}>
              {m.face && <img src={m.face} alt="" width={32} height={32} loading="lazy" />}
              <span className="name">{m.name}</span>
              <Stars n={m.rarity} />
              <span className="chip">{m.className}</span>
              {m.npCard && <span className={`chip ${m.npCard}`}>{m.npCard}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------- skills

/**
 * O que desta skill chega na fórmula de dano.
 *
 * Sem isto a checkbox é uma aposta: marcar uma skill de cura ou de geração de
 * estrela não muda número nenhum, e nada na tela diria por quê.
 */
function damageHint(skill: Skill, level: number): string | null {
  const parts = skill.effects
    .filter((e) => e.buffType !== null && specFor(e.buffType)?.slot)
    .map((e) => {
      const v = e.values[Math.min(level - 1, e.values.length - 1)] ?? 0;
      return `${e.buffType} ${v}${e.valueUnit === "percent" ? "%" : ""}`;
    });
  return parts.length > 0 ? parts.join(" · ") : null;
}

function SkillToggle({
  skill,
  level,
  checked,
  onToggle,
}: {
  skill: Skill;
  level: number;
  checked: boolean;
  onToggle: () => void;
}) {
  const hint = damageHint(skill, level);
  return (
    <label className={`opt skill-opt${hint ? "" : " inert"}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="name">{skill.name}</span>
      <span className="hint">{hint ?? "no damage buff"}</span>
    </label>
  );
}

// ------------------------------------------------------------------- inimigo

const PLAYABLE_CLASSES = [
  "saber", "archer", "lancer", "rider", "caster", "assassin", "berserker",
  "shielder", "ruler", "avenger", "alterEgo", "moonCancer", "foreigner", "pretender",
];

/** Chaves de `classAttackRate` que não são classe de inimigo. */
const PSEUDO_CLASSES = new Set(["ALL", "OTHER", "EXTRA", "MIX", "EXTRA1", "EXTRA2", "unknown"]);

const ATTRIBUTES = ["human", "sky", "earth", "star", "beast"];

// -------------------------------------------------------------------- a página

export function CalcPage({ boot }: { boot: Bootstrap }) {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseCalc(params), [params]);

  const patch = useCallback(
    (p: Partial<CalcState>) => setParams(serializeCalc({ ...parseCalc(params), ...p }), { replace: true }),
    [params, setParams],
  );

  const { data: servant, error } = useAsync<Servant | null>(
    () => (state.servantId === null ? Promise.resolve(null) : loadServant(state.servantId)),
    [state.servantId],
  );

  const traitName = useCallback(
    (id: number) => boot.traits.find((t) => t.id === id)?.name ?? `trait ${id}`,
    [boot.traits],
  );

  const computed = useMemo(() => {
    if (!servant) return null;
    const data: DamageData = {
      servants: new Map([[servant.id, servant]]),
      equips: new Map(),
      mysticCodes: new Map(),
      constants: boot.constants,
    };
    try {
      return { result: calculateDamage(toDamageInput(state, servant, traitName), data), failure: null };
    } catch (e) {
      return { result: null, failure: e instanceof Error ? e.message : String(e) };
    }
  }, [servant, state, boot.constants, traitName]);

  if (error) return <div className="detail"><p className="empty">{error}</p></div>;

  if (!servant) {
    return (
      <div className="detail">
        <h2>Damage calculator</h2>
        <p className="detail-text">Pick the attacking servant to start.</p>
        <ServantPicker boot={boot} onPick={(id) => patch({ servantId: id, skills: [], appends: [], npId: null })} />
        {state.servantId !== null && <p className="empty">loading…</p>}
      </div>
    );
  }

  const level = state.level ?? defaultLevel(servant);
  const npLevel = state.npLevel ?? defaultNpLevel(servant);
  const atk = (servant.atkGrowth[level - 1] ?? 0) + state.fou;
  const deck = [...new Set(servant.cards)];
  const isNP = state.action === "np";
  // O NP escolhido, não o "ativo": cinco servos trocam o card do NP, e o
  // multiplicador troca junto (R24).
  const npOptions = selectableNps(servant);
  const np = npOptions.find((n) => n.id === state.npId) ?? npOptions[0] ?? servant.np;
  const activeCard = isNP ? np?.card : state.action;
  const preDamageEffects = np?.damageEffectIndex ?? 0;
  /** Chain é feita de command cards; NP e extra ficam de fora mesmo sendo Buster. */
  const canBusterChain = state.action === "buster";
  /** 50 servos têm NP de suporte. Calcular "dano" ali daria um número sem sentido. */
  const npDealsNoDamage = isNP && (np == null || np.damageEffectIndex === null);

  const classRow = boot.constants.classRelation[servant.className] ?? {};
  const attrRow = boot.constants.attributeRelation[servant.attribute] ?? {};
  const classLabel = (c: string) => {
    const m = classRow[c] ?? 1;
    return m === 1 ? c : `${c} — x${m}`;
  };
  const classKeys = Object.keys(boot.constants.classAttackRate).filter(
    (c) => !/^\d+$/.test(c) && !PSEUDO_CLASSES.has(c),
  );
  const beastKeys = classKeys.filter((c) => /beast/i.test(c) && !PLAYABLE_CLASSES.includes(c)).sort();
  const otherKeys = classKeys
    .filter((c) => !PLAYABLE_CLASSES.includes(c) && !beastKeys.includes(c))
    .sort();

  const derivedTraits = [...enemyTraitNames({
    className: state.enemyClass,
    attribute: state.enemyAttribute,
    traits: [],
    defMod: 0,
    specialDefMod: 0,
  })];

  return (
    <div className="calc">
      <div className="calc-cols">
        <div className="calc-setup">
          <Block title="Attacker">
            <div className="attacker-head">
              {servant.assets.face && <img src={servant.assets.face} alt="" width={56} height={56} />}
              <div>
                <Link to={`/servant/${servant.id}`}>{servant.name}</Link>
                <div className="orig">
                  {servant.className} · <Stars n={servant.rarity} /> · {servant.attribute} ·{" "}
                  <strong>{num(atk)}</strong> ATK
                </div>
              </div>
              <button className="linkish" type="button" onClick={() => patch({ servantId: null, skills: [], appends: [], npId: null })}>
                change
              </button>
            </div>

            <div className="fields">
              <Field label="Level" hint={`natural max ${servant.lvMax}`}>
                <input
                  type="number"
                  min={1}
                  max={servant.atkGrowth.length}
                  value={level}
                  onChange={(e) => patch({ level: Number(e.target.value) })}
                />
              </Field>
              <Field label="Fou" hint="ATK fou, default 1000">
                <input type="number" min={0} max={2000} step={10} value={state.fou}
                  onChange={(e) => patch({ fou: Number(e.target.value) })} />
              </Field>
              <Field label="NP level" hint={`default NP${defaultNpLevel(servant)}`}>
                <Seg value={npLevel} options={numbers(1, 5)} onChange={(v) => patch({ npLevel: v })} />
              </Field>
              <Field label="Overcharge">
                <Seg value={state.overcharge} options={numbers(1, 5)} onChange={(v) => patch({ overcharge: v })} />
              </Field>
            </div>
          </Block>

          <Block title="Action">
            <div className="fields">
              <Field label="Attack">
                <Seg
                  value={state.action}
                  options={[
                    ...(np ? [{ value: "np" as ActionKind, label: `NP (${np.card})` }] : []),
                    ...deck.map((c) => ({ value: c as ActionKind, label: c })),
                    { value: "extra" as ActionKind, label: "extra" },
                  ]}
                  onChange={(v) => patch({ action: v })}
                />
              </Field>

              {/*
                Só aparece para os cinco servos que têm mais de um NP. O
                multiplicador vai no rótulo porque é ele que muda junto com o
                card — sem isso a escolha pareceria só cosmética.
              */}
              {npOptions.length > 1 && (
                <Field label="Which NP" hint="the multiplier changes with it">
                  <select
                    value={np?.id ?? ""}
                    onChange={(e) => patch({ npId: Number(e.target.value) })}
                  >
                    {npOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.card} {o.target} — {o.damageMultiplier ? `${o.damageMultiplier[0]}%` : "no damage"} · {o.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {state.action !== "np" && state.action !== "extra" && (
                <Field label="Position in the chain" hint="1st, 2nd or 3rd card">
                  <Seg value={state.position} options={numbers(1, 3)} onChange={(v) => patch({ position: v })} />
                </Field>
              )}

              <Field label="Roll" hint="the 0.9–1.1 random factor">
                <Seg
                  value={state.rollMode as RollMode}
                  options={[
                    { value: "min" as RollMode, label: "min (0.9)", title: "guaranteed damage" },
                    { value: "avg" as RollMode, label: "average" },
                    { value: "max" as RollMode, label: "max (1.1)" },
                  ]}
                  onChange={(v) => patch({ rollMode: v })}
                />
              </Field>

              <div className="checks">
                <label className={`opt${isNP ? " inert" : ""}`}>
                  <input type="checkbox" disabled={isNP} checked={state.isCrit}
                    onChange={() => patch({ isCrit: !state.isCrit })} />
                  <span>critical hit{isNP && " — NPs cannot crit"}</span>
                </label>
                <label className={`opt${canBusterChain ? "" : " inert"}`}>
                  <input type="checkbox" disabled={!canBusterChain} checked={state.busterChain}
                    onChange={() => patch({ busterChain: !state.busterChain })} />
                  <span>buster chain bonus{isNP && " — an NP is not part of a chain"}</span>
                </label>
                <label className={`opt${state.action === "extra" ? "" : " inert"}`}>
                  <input type="checkbox" disabled={state.action !== "extra"} checked={state.braveChain}
                    onChange={() => patch({ braveChain: !state.braveChain })} />
                  <span>brave chain (extra x3.5)</span>
                </label>
              </div>
            </div>
          </Block>

          <Block title="Buffs">
            <div className="fields">
              <Field label="Skill level" hint="applies to all three">
                <Seg value={state.skillLevel} options={numbers(1, 10)} onChange={(v) => patch({ skillLevel: v })} />
              </Field>
            </div>

            <div className="opts">
              {servant.skills.map((sk) => (
                <SkillToggle
                  key={sk.id}
                  skill={sk}
                  level={state.skillLevel}
                  checked={state.skills.includes(sk.num)}
                  onToggle={() =>
                    patch({
                      skills: state.skills.includes(sk.num)
                        ? state.skills.filter((n) => n !== sk.num)
                        : [...state.skills, sk.num],
                    })
                  }
                />
              ))}
            </div>
            <div className="row-actions">
              <button className="linkish" type="button" onClick={() => patch({ skills: servant.skills.map((s) => s.num) })}>
                all skills
              </button>
              <button className="linkish" type="button" onClick={() => patch({ skills: [] })}>none</button>
            </div>

            {servant.classPassive.length > 0 && (
              <p className="footnote">
                Always on, no switch: {servant.classPassive.map((sk) => sk.name).join(", ")}. Class passives are
                inherent — unlike append passives, the player never chooses them.
              </p>
            )}

            {isNP && preDamageEffects > 0 && (
              <p className="footnote">
                This NP applies {preDamageEffects} effect(s) <strong>before</strong> the damage, so they are always
                included — the game gives no choice there.
              </p>
            )}

            <details className="sub">
              <summary>Append passives — off by default ({state.appends.length} on)</summary>
              <div className="fields">
                <Field label="Append level">
                  <Seg value={state.appendLevel} options={numbers(1, 10)} onChange={(v) => patch({ appendLevel: v })} />
                </Field>
              </div>
              <div className="opts">
                {servant.appendPassive.map((sk, i) => (
                  <SkillToggle
                    key={sk.id}
                    skill={sk}
                    level={state.appendLevel}
                    checked={state.appends.includes(i + 1)}
                    onToggle={() =>
                      patch({
                        appends: state.appends.includes(i + 1)
                          ? state.appends.filter((n) => n !== i + 1)
                          : [...state.appends, i + 1],
                      })
                    }
                  />
                ))}
              </div>
            </details>
          </Block>

          <Block title="Enemy">
            <div className="fields">
              <Field label="Class" hint="multiplier shown is against this attacker">
                <select value={state.enemyClass} onChange={(e) => patch({ enemyClass: e.target.value })}>
                  <optgroup label="Playable classes">
                    {PLAYABLE_CLASSES.map((c) => <option key={c} value={c}>{classLabel(c)}</option>)}
                  </optgroup>
                  <optgroup label="Beasts">
                    {beastKeys.map((c) => <option key={c} value={c}>{classLabel(c)}</option>)}
                  </optgroup>
                  <optgroup label="Other">
                    {otherKeys.map((c) => <option key={c} value={c}>{classLabel(c)}</option>)}
                  </optgroup>
                </select>
              </Field>

              <Field label="Attribute">
                <select value={state.enemyAttribute} onChange={(e) => patch({ enemyAttribute: e.target.value })}>
                  {ATTRIBUTES.map((a) => {
                    const m = attrRow[a as keyof typeof attrRow] ?? 1;
                    return <option key={a} value={a}>{m === 1 ? a : `${a} — x${m}`}</option>;
                  })}
                </select>
              </Field>

              <Field label="Defence buff" hint="% already up on the enemy">
                <input type="number" step={10} value={state.enemyDefMod}
                  onChange={(e) => patch({ enemyDefMod: Number(e.target.value) })} />
              </Field>
              <Field label="Special defence" hint="% — pierce does NOT ignore this">
                <input type="number" step={10} value={state.enemySpecialDefMod}
                  onChange={(e) => patch({ enemySpecialDefMod: Number(e.target.value) })} />
              </Field>
            </div>

            <TraitPicker
              boot={boot}
              selected={state.enemyTraits}
              onChange={(ids) => patch({ enemyTraits: ids })}
            />
            <p className="footnote">
              Always on, derived from class and attribute: {derivedTraits.join(", ")}.
            </p>
          </Block>
        </div>

        <div className="calc-result">
          {computed?.failure && <p className="empty">{computed.failure}</p>}
          {npDealsNoDamage ? (
            <p className="empty">
              {servant.np?.name ?? "This NP"} deals no damage — it is a support Noble Phantasm.
              Pick a card above to see card damage.
            </p>
          ) : (
            computed?.result && <DamageReport result={computed.result} constants={boot.constants} />
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- traits do alvo

/**
 * Traits declarados à mão.
 *
 * São o que liga super-efetivo e bônus condicional — "weakToEnumaElish" muda o
 * Gilgamesh em 50%. Não dá para derivar de classe e atributo, então é escolha
 * explícita.
 */
function TraitPicker({
  boot,
  selected,
  onChange,
}: {
  boot: Bootstrap;
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [query, setQuery] = useState("");

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return boot.traits
      .filter((t) => t.name.toLowerCase().includes(q) && !selected.includes(t.id))
      .slice(0, 8);
  }, [boot.traits, query, selected]);

  const nameOf = (id: number) => boot.traits.find((t) => t.id === id)?.name ?? `trait ${id}`;

  return (
    <div className="trait-picker">
      <span className="flabel">Traits</span>
      {selected.length > 0 && (
        <div className="trait-list">
          {selected.map((id) => (
            <button key={id} type="button" className="chip removable" onClick={() => onChange(selected.filter((x) => x !== id))}>
              {nameOf(id)} <span aria-hidden>x</span>
            </button>
          ))}
        </div>
      )}
      <input
        className="search-input"
        placeholder="add a trait — undead, weakToEnumaElish, divine…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {suggestions.length > 0 && (
        <div className="matches">
          {suggestions.map((t) => (
            <button key={t.id} type="button" onClick={() => { onChange([...selected, t.id]); setQuery(""); }}>
              <span className="name">{t.name}</span>
              <span className="count">{t.uses}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
