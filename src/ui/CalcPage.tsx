/**
 * Tela da calculadora.
 *
 * Casca fina: toda a regra está em `core/damage.ts`. Aqui só se monta o cenário,
 * e o cenário inteiro vive na query string (ver `core/scenario.ts`).
 *
 * A tela mostra de propósito o que costuma ficar escondido — o multiplicador de
 * classe embutido na escolha do inimigo, quais buffs de uma skill afetam dano,
 * quais traits o inimigo realmente carrega. São exatamente os pontos onde um
 * número errado passa por certo.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { specFor } from "../core/buffs.js";
import {
  calculateDamage,
  countFieldLabel,
  enemyTraitNames,
  selectableNps,
  NEUTRAL,
  type DamageData,
  type RollMode,
} from "../core/damage.js";
import type { CraftEssence, IndexEntryServant, MysticCode, Servant, Skill } from "../core/model.js";
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
  type ExternalBuff,
} from "../core/scenario.js";
import { loadEquip, loadServant, type Bootstrap } from "./data.js";
import {
  loadTemplates,
  removeTemplate,
  saveTemplate,
  suggestName,
  SEED_TEMPLATES,
  type BuffTemplate,
} from "./templates.js";
import { useAsync } from "./useAsync.js";

const num = (n: number) => n.toLocaleString("en-US");

/** "Mystic Code: Chaldea Combat Uniform" -> "Chaldea Combat Uniform". */
const mcName = (m: MysticCode) => m.name.replace(/^Mystic Code:\s*/, "");
/**
 * O ícone do equipamento. O dado traz a arte por gênero do Master; para um
 * seletor tanto faz, então vale a que existir.
 */
const mcIcon = (m: MysticCode) => m.assets.male ?? m.assets.female;

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

function ServantPicker({
  boot,
  onPick,
  placeholder = "who is attacking? name, alias or number…",
}: {
  boot: Bootstrap;
  onPick: (id: number) => void;
  /** O mesmo seletor serve para escolher o atacante e para acrescentar suporte. */
  placeholder?: string;
}) {
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
        placeholder={placeholder}
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

/**
 * Escolha de Craft Essence. Mesmo motor do `ServantPicker` — 2.149 CEs não
 * cabem num `<select>`, e a busca por nome já existe.
 */
function EquipPicker({ boot, onPick }: { boot: Bootstrap; onPick: (id: number) => void }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const text = query.trim();
    if (!text) return [];
    return search(boot.index, { ...EMPTY_FILTERS, kind: "equip", text }).slice(0, 6);
  }, [boot.index, query]);

  return (
    <div className="picker">
      <input
        className="search-input"
        placeholder="craft essence by name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length > 0 && (
        <div className="matches">
          {matches.map((m) => (
            <button key={m.id} type="button" onClick={() => { onPick(m.id); setQuery(""); }}>
              {m.face && <img src={m.face} alt="" width={32} height={32} loading="lazy" />}
              <span className="name">{m.name}</span>
              <Stars n={m.rarity} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------- buffs externos

/**
 * Um cartão de fonte externa.
 *
 * Os controles aparecem conforme o **dado** de quem foi escolhido, não conforme
 * o servo: o toggle de alvo único só existe se aquele servo tiver algum buff
 * `ptOne`, e a caixa de NP só se o NP dele buffar a party. É a mesma regra do
 * contador de stacks e dos campos da CE.
 */
function ExternalCard({
  source,
  servant,
  ce,
  boot,
  onChange,
  onRemove,
}: {
  source: ExternalBuff;
  servant: Servant | null;
  ce: CraftEssence | null;
  boot: Bootstrap;
  onChange: (next: ExternalBuff) => void;
  onRemove: () => void;
}) {
  if (!servant) return <div className="ext-card"><p className="empty">loading…</p></div>;

  const buffs = servant.skills.flatMap((sk) => sk.effects);
  /** 78 dos 462 servos têm algum buff de alvo único; nos outros o toggle não faz nada. */
  const temAlvoUnico = buffs.some((e) => /^pt(One|Other|OneOther|SelfAnotherFirst)/.test(e.target));
  const npBuffs = (servant.np?.effects ?? []).filter(
    (e) => e.buffType && specFor(e.buffType)?.slot && /^pt/.test(e.target),
  );

  return (
    <div className="ext-card">
      <div className="attacker-head">
        {servant.assets.face && <img src={servant.assets.face} alt="" width={40} height={40} />}
        <div>
          <Link to={`/servant/${servant.id}`}>{servant.name}</Link>
          <div className="orig">{servant.className} · <Stars n={servant.rarity} /></div>
        </div>
        <button className="linkish" type="button" onClick={onRemove}>remove</button>
      </div>

      <div className="opts">
        {servant.skills.map((sk) => (
          <SkillToggle
            key={sk.id}
            skill={sk}
            level={source.skillLevel}
            checked={source.skills.includes(sk.num)}
            onToggle={() =>
              onChange({
                ...source,
                skills: source.skills.includes(sk.num)
                  ? source.skills.filter((n) => n !== sk.num)
                  : [...source.skills, sk.num],
              })
            }
          />
        ))}
      </div>

      <div className="fields">
        <Field label="Skill level" hint="this support's, not yours">
          <Seg value={source.skillLevel} options={numbers(1, 10)} onChange={(v) => onChange({ ...source, skillLevel: v })} />
        </Field>
        {npBuffs.length > 0 && (
          <Field label="NP used" hint={npBuffs.map((e) => e.buffType).join(", ")}>
            <label className="opt">
              <input
                type="checkbox"
                checked={source.np !== null}
                onChange={() => onChange({ ...source, np: source.np ? null : { level: 5, overcharge: 1 } })}
              />
              <span className="name">yes</span>
            </label>
          </Field>
        )}
        {source.np && (
          <>
            <Field label="NP level">
              <Seg value={source.np.level} options={numbers(1, 5)} onChange={(v) => onChange({ ...source, np: { ...source.np!, level: v } })} />
            </Field>
            <Field label="NP overcharge" hint="this support's own">
              <Seg value={source.np.overcharge} options={numbers(1, 5)} onChange={(v) => onChange({ ...source, np: { ...source.np!, overcharge: v } })} />
            </Field>
          </>
        )}
        {temAlvoUnico && (
          <Field label="Single-target buffs" hint="this servant has some — did they point at your attacker?">
            <label className="opt">
              <input
                type="checkbox"
                checked={source.targetsAttacker}
                onChange={() => onChange({ ...source, targetsAttacker: !source.targetsAttacker })}
              />
              <span className="name">pointed at the attacker</span>
            </label>
          </Field>
        )}
      </div>

      {/* A CE do suporte entra só com os efeitos que alcançam a party. */}
      {ce ? (
        <div className="attacker-head">
          {ce.assets.face && <img src={ce.assets.face} alt="" width={32} height={32} />}
          <div>
            <Link to={`/equip/${ce.id}`}>{ce.name}</Link>
            <div className="orig">effects only — this CE's ATK belongs to the support{source.ce?.mlb ? " · MLB" : ""}</div>
          </div>
          <button className="linkish" type="button" onClick={() => onChange({ ...source, ce: null })}>remove CE</button>
        </div>
      ) : (
        <EquipPicker boot={boot} onPick={(id) => onChange({ ...source, ce: { id, mlb: false } })} />
      )}
      {source.ce && (
        <label className="opt">
          <input type="checkbox" checked={source.ce.mlb} onChange={() => onChange({ ...source, ce: { ...source.ce!, mlb: !source.ce!.mlb } })} />
          <span className="name">MLB</span>
        </label>
      )}
    </div>
  );
}

/** Documentos das fontes externas, na mesma ordem da lista. */
interface ExternalDocs {
  servants: (Servant | null)[];
  ces: (CraftEssence | null)[];
}

/**
 * Uma linha do resumo, no bloco.
 *
 * O cartão inteiro é alto — skills, nível, NP, seletor de CE — e três deles
 * empurrariam o resultado para fora da tela. Aqui fica só o suficiente para
 * conferir que a composição é a que se pensou; editar é no editor.
 */
function ExternalSummaryRow({
  source,
  servant,
  ce,
}: {
  source: ExternalBuff;
  servant: Servant | null;
  ce: CraftEssence | null;
}) {
  const bits: string[] = [];
  if (source.skills.length > 0) bits.push(`skill ${[...source.skills].sort().join(", ")}`);
  if (source.np) bits.push(`NP${source.np.level}${source.np.overcharge > 1 ? ` OC${source.np.overcharge}` : ""}`);
  if (source.ce) bits.push(ce ? `${ce.name}${source.ce.mlb ? " (MLB)" : ""}` : "CE");
  if (!source.targetsAttacker) bits.push("single-target buffs elsewhere");

  return (
    <div className="ext-row">
      {servant?.assets.face && <img src={servant.assets.face} alt="" width={28} height={28} />}
      <span className="name">{servant?.name ?? "loading…"}</span>
      <span className="orig">{bits.length > 0 ? bits.join(" · ") : "nothing switched on"}</span>
    </div>
  );
}

// -------------------------------------------------------------------- a janela

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  // Esc fecha. O `useEffect` não roda no servidor, então `document` nunca é
  // tocado durante o render — a página continua montando em SSR.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="linkish" type="button" onClick={onClose}>close</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/**
 * Editor de buffs externos, com os templates.
 *
 * Aplicar um template **substitui** a lista. Não há mescla: duas composições
 * somadas dariam um total que ninguém pediu, e o botão voltar do navegador
 * desfaz a troca, porque a lista vive na URL.
 */
export function ExternalBuffsEditor({
  sources,
  docs,
  boot,
  templates,
  servantName,
  onChange,
  onTemplates,
  onClose,
}: {
  sources: ExternalBuff[];
  docs: ExternalDocs | null;
  boot: Bootstrap;
  templates: BuffTemplate[];
  servantName: (id: number) => string;
  onChange: (next: ExternalBuff[]) => void;
  onTemplates: (next: BuffTemplate[]) => void;
  onClose: () => void;
}) {
  const suggested = suggestName(sources, servantName);
  // `null` = ainda não digitou. Enquanto não digita, o nome acompanha o
  // conteúdo; no instante em que digita, para de mudar sozinho.
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const name = draft ?? suggested;
  const overwrites = templates.some((t) => t.name.toLowerCase() === name.trim().toLowerCase());

  const apply = (result: ReturnType<typeof saveTemplate>) => {
    if (result.ok) {
      onTemplates(result.templates);
      setProblem(null);
    } else {
      setProblem(result.reason);
    }
  };

  return (
    <Modal title="External buffs" onClose={onClose}>
      {sources.length === 0 && (
        <p className="footnote">
          Other servants buffing this attack. Add the same one twice if two copies buffed — they stack.
          Nothing here is a party: there is no position and no limit, because Order Change lets more than
          two buff the same attack in one turn.
        </p>
      )}

      {/*
        O seletor vem ANTES dos cartões: depois deles, ele desceria a cada
        suporte acrescentado, e acrescentar vários é justamente o caso comum.
        Aqui ele fica parado no mesmo lugar, e o que cresce cresce abaixo.
      */}
      <ServantPicker
        boot={boot}
        placeholder="add a support — name, alias or number…"
        onPick={(id) =>
          onChange([...sources, { servantId: id, skills: [], skillLevel: 10, targetsAttacker: true, np: null, ce: null }])
        }
      />

      {sources.map((e, i) => (
        <ExternalCard
          key={`${i}-${e.servantId}`}
          source={e}
          servant={docs?.servants[i] ?? null}
          ce={docs?.ces[i] ?? null}
          boot={boot}
          onChange={(next) => onChange(sources.map((x, j) => (j === i ? next : x)))}
          onRemove={() => onChange(sources.filter((_, j) => j !== i))}
        />
      ))}

      <hr className="modal-sep" />

      <h4 className="modal-sub">Templates</h4>
      <p className="footnote">
        Saved in this browser only, and never in the link — a link always carries the buffs themselves, so
        whoever opens it sees the same scenario and can save it here as their own.
      </p>

      <div className="tpl-save">
        <input
          className="search-input"
          placeholder="name this composition…"
          value={name}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          className="linkish"
          type="button"
          disabled={sources.length === 0 || name.trim() === ""}
          onClick={() => apply(saveTemplate(name, sources))}
        >
          {overwrites ? "overwrite" : "save"}
        </button>
      </div>
      {sources.length === 0 && <p className="footnote">Nothing to save yet — add a servant above.</p>}
      {problem && <p className="footnote warn">{problem}</p>}

      <div className="tpl-list">
        {[
          ...templates.map((t) => ({ t, saved: true })),
          ...SEED_TEMPLATES.map((t) => ({ t, saved: false })),
        ].map(({ t, saved }) => (
          <div className="tpl-row" key={`${saved ? "u" : "s"}-${t.name}`}>
            <span className="name">{t.name}</span>
            {/* Mesmo condensador do nome sugerido: "Castoria, Castoria" vira
                "Double Altria Caster", que é o que se quer ler numa lista. */}
            <span className="orig">
              {suggestName(t.sources, servantName)}
              {saved ? "" : " · example"}
            </span>
            <button className="linkish" type="button" onClick={() => onChange(t.sources)}>apply</button>
            {saved && (
              <button className="linkish" type="button" onClick={() => apply(removeTemplate(t.name))}>delete</button>
            )}
          </div>
        ))}
      </div>
    </Modal>
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

  // A CE vem sob demanda, como o servo: são 2.149 documentos e o índice já traz
  // o que a busca precisa. Falha ao carregar não derruba a tela — o cálculo
  // segue sem a CE, e é o `useAsync` do servo que reporta erro.
  const { data: ce } = useAsync<CraftEssence | null>(
    () => (state.ceId === null ? Promise.resolve(null) : loadEquip(state.ceId).catch(() => null)),
    [state.ceId],
  );

  /**
   * Documentos das fontes externas. Uma promessa só para a lista inteira: são
   * poucos e o cache de `data.ts` já dedupe duas cópias do mesmo suporte.
   */
  const { data: extDocs } = useAsync<{ servants: (Servant | null)[]; ces: (CraftEssence | null)[] }>(
    async () => ({
      servants: await Promise.all(state.externals.map((e) => loadServant(e.servantId).catch(() => null))),
      ces: await Promise.all(state.externals.map((e) => (e.ce ? loadEquip(e.ce.id).catch(() => null) : Promise.resolve(null)))),
    }),
    [state.externals.map((e) => `${e.servantId}/${e.ce?.id ?? ""}`).join("|")],
  );

  const mysticCode = useMemo(
    () => boot.mysticCodes.find((m) => m.id === state.mcId) ?? null,
    [boot.mysticCodes, state.mcId],
  );

  const traitName = useCallback(
    (id: number) => boot.traits.find((t) => t.id === id)?.name ?? `trait ${id}`,
    [boot.traits],
  );

  /** Nome do suporte sem carregar o documento dele: o índice já tem. */
  const servantName = useCallback(
    (id: number) => boot.index.find((e) => e.kind === "servant" && e.id === id)?.name ?? `servant ${id}`,
    [boot.index],
  );

  const [editingExternals, setEditingExternals] = useState(false);
  // Só os do usuário; as sementes entram do lado na hora de listar. O
  // inicializador preguiçoso lê o `localStorage` uma vez — em SSR ele não
  // existe e a função devolve lista vazia, sem tocar em `window`.
  const [templates, setTemplates] = useState<BuffTemplate[]>(() => loadTemplates());

  const computed = useMemo(() => {
    if (!servant) return null;
    const data: DamageData = {
      servants: new Map(
        [servant, ...(extDocs?.servants ?? [])].filter((x): x is Servant => x !== null).map((x) => [x.id, x]),
      ),
      equips: new Map(
        [ce, ...(extDocs?.ces ?? [])].filter((c): c is CraftEssence => c !== null).map((c) => [c.id, c]),
      ),
      mysticCodes: new Map(boot.mysticCodes.map((m) => [m.id, m])),
      constants: boot.constants,
    };
    try {
      return { result: calculateDamage(toDamageInput(state, servant, traitName), data), failure: null };
    } catch (e) {
      return { result: null, failure: e instanceof Error ? e.message : String(e) };
    }
  }, [servant, ce, extDocs, state, boot.constants, boot.mysticCodes, traitName]);

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
  /**
   * R32: quando esta carta já É a Buster de abertura, ou é uma Buster Chain, a
   * chain abriu em Buster por construção — não há o que perguntar.
   */
  const busterFirstImplied =
    !isNP && ((state.action === "buster" && state.position === 1) || state.busterChain);
  const busterFirstAsked = !isNP && !busterFirstImplied;
  const busterFirstOn = !isNP && (busterFirstImplied || state.busterFirst);
  /** 50 servos têm NP de suporte. Calcular "dano" ali daria um número sem sentido. */
  const npDealsNoDamage = isNP && (np == null || np.damageEffectIndex === null);
  /**
   * R27: 17 NPs somam bônus por unidade de um trait. O campo aparece só quando
   * o NP escolhido conta, e **tudo nele vem do dado** — nome do trait, teto e de
   * que lado se conta. A tela não sabe quem é o Charlemagne.
   */
  const seCount = isNP && np?.damageEffectIndex != null ? np.effects[np.damageEffectIndex]?.superEffective : null;
  const stackSpec = seCount && seCount.maxCount > 0 ? seCount : null;
  // O rótulo sai do núcleo para a tela e a auditoria não divergirem (R33).
  const stackLabel = stackSpec ? countFieldLabel(stackSpec) : "";

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

            {/*
              A CE fica junto do servo porque é equipamento DELE — o Mystic Code,
              que é do Master e vale para a party, mora no bloco de buffs.
            */}
            {ce ? (
              <div className="attacker-head">
                {ce.assets.face && <img src={ce.assets.face} alt="" width={40} height={40} />}
                <div>
                  <Link to={`/equip/${ce.id}`}>{ce.name}</Link>
                  <div className="orig">
                    <Stars n={ce.rarity} /> · lv {state.ceLevel ?? ce.lvMax}
                    {state.ceMlb ? " · MLB" : ""}
                  </div>
                </div>
                <button className="linkish" type="button" onClick={() => patch({ ceId: null, ceLevel: null, ceMlb: false })}>
                  remove
                </button>
              </div>
            ) : (
              <EquipPicker boot={boot} onPick={(id) => patch({ ceId: id })} />
            )}

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
              {/*
                Só sete servos mudam de dano com HP (R25), mas o campo é geral:
                esconder atrás de uma condição por servo faria a tela guardar
                uma regra que já vive nos dados.
              */}
              <Field label="Current HP" hint="% of max — some skills and NPs scale with it">
                <input type="number" min={0} max={100} step={5} value={state.hpPercent}
                  onChange={(e) => patch({ hpPercent: Number(e.target.value) })} />
              </Field>
              {/*
                Ao contrário do HP, este campo é condicional: fora dos 17 NPs
                que contam, um contador de stacks não teria o que contar. E o
                rótulo sai do dado, então servo novo aparece sem editar a tela.
              */}
              {ce && (
                <>
                  <Field label="CE level" hint={`max ${ce.lvMax} · +${num(ce.atkGrowth[ce.lvMax - 1] ?? 0)} ATK there`}>
                    <input type="number" min={1} max={ce.lvMax} value={state.ceLevel ?? ce.lvMax}
                      onChange={(e) => patch({ ceLevel: Number(e.target.value) })} />
                  </Field>
                  {/*
                    MLB não é "mais forte": é o OUTRO conjunto de efeitos (D17).
                    Por isso é caixa, e não um nível 5 do limit break — o dado
                    tem dois conjuntos e não sabe qual você tem.
                  */}
                  <Field label="Max limit break" hint="picks a different effect set, not a stronger one">
                    <label className="opt">
                      <input type="checkbox" checked={state.ceMlb} onChange={() => patch({ ceMlb: !state.ceMlb })} />
                      <span className="name">MLB</span>
                    </label>
                  </Field>
                </>
              )}
              {stackSpec?.countsOn === "self" && (
                <Field label={stackLabel} hint={`on self — up to ${stackSpec.maxCount}, +${stackSpec.perCount}% each${stackSpec.countLabel ? ` · ${stackSpec.countLabel}` : ""}`}>
                  <input type="number" min={0} max={stackSpec.maxCount} value={state.stacksSelf}
                    onChange={(e) => patch({ stacksSelf: Number(e.target.value) })} />
                </Field>
              )}
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
                {/*
                  R32: propriedade da CHAIN, não desta carta — se a primeira foi
                  Buster, as três ganham +0.5. Quando esta carta já é a Buster
                  de abertura, ou é uma Buster Chain, a resposta é sim por
                  construção, e a caixa se mostra marcada e travada em vez de
                  convidar a desmarcar algo que não é escolha.
                */}
                <label className={`opt${busterFirstAsked ? "" : " inert"}`}>
                  <input type="checkbox" disabled={!busterFirstAsked} checked={busterFirstOn}
                    onChange={() => patch({ busterFirst: !state.busterFirst })} />
                  <span>
                    chain opened with a Buster card
                    {isNP
                      ? " — an NP gets no first-card bonus"
                      : busterFirstImplied
                        ? " — this card already is it"
                        : " — +0.5 to every card in the chain"}
                  </span>
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

            {/*
              O Mystic Code é do Master, um só para a party — por isso fica aqui
              e não junto do servo. As skills dele entram como as do servo: só
              as marcadas, e o rótulo diz o que cada uma faz ao dano.
            */}
            <details className="sub" open={state.mcId !== null}>
              <summary>Mystic Code — {mysticCode ? mcName(mysticCode) : "none"}</summary>
              {/*
                Mesma forma do seletor de CE, e não um `<select>`: com 28 itens
                o ícone cabe e é ele que identifica o Mystic Code — quase todo
                nome começa com "Chaldea".
              */}
              {mysticCode ? (
                <div className="attacker-head">
                  {mcIcon(mysticCode) && <img src={mcIcon(mysticCode)!} alt="" width={40} height={40} />}
                  <div>
                    <strong>{mcName(mysticCode)}</strong>
                    <div className="orig">lv {state.mcLevel} · {state.mcSkills.length} of {mysticCode.skills.length} skills on</div>
                  </div>
                  <button className="linkish" type="button" onClick={() => patch({ mcId: null, mcSkills: [] })}>
                    remove
                  </button>
                </div>
              ) : (
                <div className="matches scroll">
                  {boot.mysticCodes.map((m) => (
                    <button key={m.id} type="button" onClick={() => patch({ mcId: m.id, mcSkills: [] })}>
                      {mcIcon(m) && <img src={mcIcon(m)!} alt="" width={32} height={32} loading="lazy" />}
                      <span className="name">{mcName(m)}</span>
                    </button>
                  ))}
                </div>
              )}
              {mysticCode && (
                <div className="fields">
                  <Field label="MC level">
                    <Seg value={state.mcLevel} options={numbers(1, 10)} onChange={(v) => patch({ mcLevel: v })} />
                  </Field>
                </div>
              )}
              {mysticCode && (
                <div className="opts">
                  {mysticCode.skills.map((sk, i) => (
                    <SkillToggle
                      key={`${mysticCode.id}-${i}`}
                      skill={sk}
                      level={state.mcLevel}
                      checked={state.mcSkills.includes(i + 1)}
                      onToggle={() =>
                        patch({
                          mcSkills: state.mcSkills.includes(i + 1)
                            ? state.mcSkills.filter((n) => n !== i + 1)
                            : [...state.mcSkills, i + 1],
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </details>

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

          {/*
            "External buffs", não "Party": não há posição, não há limite de
            três, e repetir o mesmo servo é legítimo. Order Change deixa mais de
            dois buffarem o mesmo ataque num turno.
          */}
          <Block title="External buffs">
            {/*
              O menu não guarda qual template está aplicado, e volta sempre para
              o rótulo neutro. Não é descuido: a URL não tem `tpl=`, então
              "aplicado" não existe como estado — assim que se edita um buff, um
              nome fixado ali estaria mentindo. É uma lista de ações.
            */}
            <div className="row-actions">
              <select
                aria-label="Apply a template"
                value=""
                onChange={(e) => {
                  const [kind, i] = [e.target.value.slice(0, 1), Number(e.target.value.slice(1))];
                  const t = kind === "u" ? templates[i] : SEED_TEMPLATES[i];
                  if (t) patch({ externals: t.sources });
                }}
              >
                <option value="">Apply a template…</option>
                {templates.length > 0 && (
                  <optgroup label="Saved">
                    {templates.map((t, i) => <option key={t.name} value={`u${i}`}>{t.name}</option>)}
                  </optgroup>
                )}
                <optgroup label="Examples">
                  {SEED_TEMPLATES.map((t, i) => <option key={t.name} value={`s${i}`}>{t.name}</option>)}
                </optgroup>
              </select>
              <button className="linkish" type="button" onClick={() => setEditingExternals(true)}>
                Edit external buffs…
              </button>
            </div>

            {state.externals.length === 0 ? (
              <p className="footnote">
                None. Other servants buffing this attack go here — a template above is the quick way in.
              </p>
            ) : (
              <div className="ext-summary">
                {state.externals.map((e, i) => (
                  <ExternalSummaryRow
                    key={`${i}-${e.servantId}`}
                    source={e}
                    servant={extDocs?.servants[i] ?? null}
                    ce={extDocs?.ces[i] ?? null}
                  />
                ))}
              </div>
            )}
          </Block>

          <Block title="Enemy">
            <div className="fields">
              <Field label="Class" hint="multiplier shown is against this attacker">
                <select value={state.enemyClass} onChange={(e) => patch({ enemyClass: e.target.value })}>
                  {/*
                    Fora dos optgroups e no topo: não é uma classe do jogo, é a
                    ausência de uma. Listá-la junto das outras sugeriria que
                    existe um inimigo "Neutral" para enfrentar.
                  */}
                  <option value={NEUTRAL}>neutral — no class advantage</option>
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
                  <option value={NEUTRAL}>neutral — no attribute affinity</option>
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
              {/*
                O contador do lado do alvo mora aqui, e não junto do atacante,
                porque descreve o inimigo. É a mesma regra que R22 impôs aos
                slots: o valor fica com a entidade de quem ele fala.

                E é distinto do TraitPicker abaixo: lá se diz *se* o alvo é
                〔roman〕; aqui, **quantos** 〔roman〕 ele acumulou — o NP do
                Romulus aplica um por uso, até 10.
              */}
              {stackSpec?.countsOn === "target" && (
                <Field label={stackLabel} hint={`on the target — up to ${stackSpec.maxCount}, +${stackSpec.perCount}% each`}>
                  <input type="number" min={0} max={stackSpec.maxCount} value={state.stacksTarget}
                    onChange={(e) => patch({ stacksTarget: Number(e.target.value) })} />
                </Field>
              )}
            </div>

            <TraitPicker
              boot={boot}
              selected={state.enemyTraits}
              onChange={(ids) => patch({ enemyTraits: ids })}
            />
            <p className="footnote">
              {derivedTraits.length > 0
                ? `Always on, derived from class and attribute: ${derivedTraits.join(", ")}.`
                : "A neutral target derives no traits — nothing anti-class or anti-attribute can fire."}
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

      {editingExternals && (
        <ExternalBuffsEditor
          sources={state.externals}
          docs={extDocs}
          boot={boot}
          templates={templates}
          servantName={servantName}
          onChange={(externals) => patch({ externals })}
          onTemplates={setTemplates}
          onClose={() => setEditingExternals(false)}
        />
      )}
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
