import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { CraftEssence, Servant, Skill } from "../core/model.js";
import { Block, EffectRow, EffectTable, Stars } from "./components.js";
import { loadEquip, loadServant } from "./data.js";

/** Números seguem en-US para casar com o resto da interface. */
const num = (n: number) => n.toLocaleString("en-US");

function useAsync<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    load().then(
      (d) => alive && setData(d),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

const Back = () => <Link className="back" to="/">← back to search</Link>;

/**
 * Link para uma forma de combate (ou para o servo base a partir dela).
 *
 * Essas formas ficam fora do índice de busca — apareceriam como uma segunda
 * entrada do mesmo personagem —, então este link é o único caminho até elas.
 */
function ServantLink({ id }: { id: number }) {
  const { data } = useAsync<Servant>(() => loadServant(id), [id]);
  return (
    <Link to={`/servant/${id}`}>
      {data ? `${data.name} (${data.className}, ${data.rarity}★)` : `#${id}`}
    </Link>
  );
}

/**
 * Skill com a progressão completa por nível.
 *
 * Antes só mostrávamos o nível 10, o que escondia o quanto cada efeito cresce —
 * e escondia também quais efeitos não crescem nada (duração, chance), que é
 * metade da informação útil ao decidir se vale subir a skill.
 */
function SkillCard({ skill, highlight = 9 }: { skill: Skill; highlight?: number }) {
  const levels = skill.effects[0]?.values.length ?? 0;
  const columns = Array.from({ length: levels }, (_, i) => `Lv${i + 1}`);

  return (
    <div className="skill">
      <div className="title">
        {skill.num > 0 && <span className="num">#{skill.num}</span>}
        <span>{skill.name}</span>
        {skill.cooldown.length > 0 && (
          <span className="num">CD {skill.cooldown[0]}→{skill.cooldown[skill.cooldown.length - 1]}</span>
        )}
        {skill.previousVersions && (
          <span className="num" title="superseded rank ups">
            +{skill.previousVersions.length} earlier version(s)
          </span>
        )}
      </div>
      {skill.detail && <div className="detail-text">{skill.detail}</div>}
      {levels > 1 ? (
        <EffectTable
          effects={skill.effects}
          columns={columns}
          valueAt={(e, i) => e.values[i]}
          highlight={Math.min(highlight, levels - 1)}
        />
      ) : (
        <div className="effects">
          {skill.effects.map((e, i) => <EffectRow key={i} effect={e} />)}
        </div>
      )}
    </div>
  );
}

export function ServantPage() {
  const { id } = useParams();
  const { data: s, error } = useAsync<Servant>(() => loadServant(Number(id)), [id]);
  const [npLevelOverride, setNpLevel] = useState<number | null>(null);
  const [axis, setAxis] = useState<"oc" | "np">("oc");
  const [oc, setOc] = useState(1);

  if (error) return <div className="detail"><Back /><p className="empty">{error}</p></div>;
  if (!s) return <div className="detail"><Back /><p className="empty">loading…</p></div>;

  const atk = (lv: number) => s.atkGrowth[lv - 1] ?? null;
  const hp = (lv: number) => s.hpGrowth[lv - 1] ?? null;
  const npLevelDefault = s.rarity <= 3 || s.isWelfare ? 5 : 1;
  const npLevel = npLevelOverride ?? npLevelDefault;

  return (
    <div className="detail">
      <Back />

      {s.combatFormOf !== null && (
        <p className="detail-text" style={{ marginTop: -6, marginBottom: 16 }}>
          In-battle transformed form of <ServantLink id={s.combatFormOf} />. Only appears mid-combat,
          so it is kept out of the search index.
        </p>
      )}

      <div className="detail-head">
        {s.assets.charaGraph[0] && <img src={s.assets.charaGraph[0]} alt="" />}
        <div>
          <h2>{s.name}</h2>
          <div className="orig">
            {s.originalName} · {s.collectionNo > 0 ? `no. ${s.collectionNo}` : "no collection no."} · id {s.id}
          </div>
          {s.combatForms.length > 0 && (
            <div className="orig">
              transforms into{" "}
              {s.combatForms.map((fid, i) => (
                <span key={fid}>{i > 0 && ", "}<ServantLink id={fid} /></span>
              ))}{" "}
              in battle
            </div>
          )}
          <dl className="kv">
            <dt>class</dt><dd>{s.className}</dd>
            <dt>rarity</dt><dd><Stars n={s.rarity} /></dd>
            <dt>attribute</dt><dd>{s.attribute}</dd>
            <dt>cost</dt><dd>{s.cost}</dd>
            <dt>availability</dt><dd>{s.isWelfare ? "welfare (event)" : "normal"}</dd>
            <dt>deck</dt><dd>{s.cards.map((c) => c[0]!.toUpperCase()).join("")}</dd>
            <dt>star gen</dt><dd>{s.starGen}%</dd>
            {s.aliases.length > 0 && <><dt>aliases</dt><dd>{s.aliases.join(", ")}</dd></>}
          </dl>
        </div>
      </div>

      <Block title="Stats by level">
        <table className="growth">
          <thead>
            <tr><th>level</th><th>ATK</th><th>HP</th></tr>
          </thead>
          <tbody>
            {[1, s.lvMax, 100, 120].filter((lv, i, a) => a.indexOf(lv) === i && atk(lv) !== null).map((lv) => (
              <tr key={lv}>
                <td>{lv}{lv === s.lvMax && " (natural max)"}{lv > s.lvMax && " (grail)"}</td>
                <td>{atk(lv) !== null && num(atk(lv)!)}</td>
                <td>{hp(lv) !== null && num(hp(lv)!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
          Default preset: lv{s.lvMax} + 1000 fou = <strong>{num((atk(s.lvMax) ?? 0) + 1000)}</strong> ATK ·
          NP{npLevelDefault}
        </p>
      </Block>

      {s.np && (
        <Block title={`Noble Phantasm — ${s.np.target.toUpperCase()} ${s.np.card}`}>
          <div className="skill">
            <div className="title">
              <span>{s.np.name}</span>
              <span className="num">{s.np.rank} · {s.np.type}</span>
              <span className={`chip ${s.np.target}`}>{s.np.target}</span>
              <span className={`chip ${s.np.card}`}>{s.np.card}</span>
            </div>
            {s.np.hits.length > 1 && (
              <div className="detail-text">{s.np.hits.length} hits ({s.np.hits.join("/")})</div>
            )}

            {/*
              Um NP tem DUAS dimensões de cinco valores — nível de NP e
              overcharge — e misturá-las numa tabela só é o que confunde. Aqui
              o usuário escolhe qual delas são as colunas; a outra vira um
              valor fixo, dito no cabeçalho. Assim o multiplicador de dano
              (que varia por nível de NP) e os buffs (que variam por
              overcharge) cabem na mesma tabela sem mentir sobre o eixo.
            */}
            <div className="oc-picker">
              <div className="axis-toggle">
                <button aria-pressed={axis === "oc"} onClick={() => setAxis("oc")}>
                  columns = overcharge
                </button>
                <button aria-pressed={axis === "np"} onClick={() => setAxis("np")}>
                  columns = NP level
                </button>
              </div>
              {axis === "oc" ? (
                <>
                  <label htmlFor="nplv">at</label>
                  <select id="nplv" value={npLevel} onChange={(ev) => setNpLevel(Number(ev.target.value))}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>NP{n}{n === npLevelDefault ? " (default)" : ""}</option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <label htmlFor="oclv">at</label>
                  <select id="oclv" value={oc} onChange={(ev) => setOc(Number(ev.target.value))}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>OC{n}{n === 1 ? " (usual)" : ""}</option>
                    ))}
                  </select>
                </>
              )}
            </div>

            <EffectTable
              effects={s.np.effects}
              axisLabel={axis === "oc" ? `at NP${npLevel}` : `at OC${oc}`}
              columns={
                axis === "oc"
                  ? ["OC1", "OC2", "OC3", "OC4", "OC5"]
                  : ["NP1", "NP2", "NP3", "NP4", "NP5"]
              }
              // valuesByOvercharge é null quando o efeito não escala com OC —
              // nesse caso a linha de OC1 vale para todos os overcharges.
              valueAt={(e, i) => {
                const row = (ocIdx: number) =>
                  e.valuesByOvercharge ? e.valuesByOvercharge[ocIdx] : e.values;
                return axis === "oc" ? row(i)?.[npLevel - 1] : row(oc - 1)?.[i];
              }}
              superEffectiveAt={(e, i) => {
                const se = e.superEffective;
                if (!se) return undefined;
                const row = (ocIdx: number) => (se.valuesByOvercharge ? se.valuesByOvercharge[ocIdx] : se.values);
                return axis === "oc" ? row(i)?.[npLevel - 1] : row(oc - 1)?.[i];
              }}
              damageIndex={s.np.damageEffectIndex}
              highlight={axis === "oc" ? 0 : npLevelDefault - 1}
            />
          </div>
          {s.npAlternatives.length > 0 && (
            <details className="skill" style={{ opacity: 0.85 }}>
              <summary style={{ cursor: "pointer" }}>
                {s.npAlternatives.length} alternative NP(s) — earlier versions or per card type
              </summary>
              <div style={{ marginTop: 10 }}>
                {s.npAlternatives.map((np) => (
                  <div key={np.id} className="detail-text">
                    {np.name} · {np.card} · {np.target} ·{" "}
                    {np.damageMultiplier ? `${np.damageMultiplier[0]}%` : "no damage"}{" "}
                    {np.condQuestId > 0 && <>· quest {np.condQuestId}</>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </Block>
      )}

      <Block title="Skills — value at each level (Lv10 highlighted)">
        {s.skills.map((sk) => <SkillCard key={sk.id} skill={sk} />)}
      </Block>

      {s.classPassive.length > 0 && (
        <Block title="Class passives">
          {s.classPassive.map((sk) => <SkillCard key={sk.id} skill={sk} highlight={0} />)}
        </Block>
      )}

      {s.appendPassive.length > 0 && (
        <Block title="Append passives — off by default in calculations">
          {s.appendPassive.map((sk) => <SkillCard key={sk.id} skill={sk} />)}
        </Block>
      )}

      <Block title={`Traits (${s.traits.length})`}>
        <div className="trait-list">
          {s.traits.map((t) => (
            <span key={t.id} className="chip" title={`id ${t.id}`}>{t.name}</span>
          ))}
        </div>
      </Block>
    </div>
  );
}

export function EquipPage() {
  const { id } = useParams();
  const { data: e, error } = useAsync<CraftEssence>(() => loadEquip(Number(id)), [id]);

  if (error) return <div className="detail"><Back /><p className="empty">{error}</p></div>;
  if (!e) return <div className="detail"><Back /><p className="empty">loading…</p></div>;

  const maxAtk = e.atkGrowth[e.atkGrowth.length - 1];
  const maxHp = e.hpGrowth[e.hpGrowth.length - 1];

  return (
    <div className="detail">
      <Back />
      <div className="detail-head">
        {e.assets.charaGraph && <img src={e.assets.charaGraph} alt="" />}
        <div>
          <h2>{e.name}</h2>
          <div className="orig">{e.originalName} · no. {e.collectionNo} · id {e.id}</div>
          <dl className="kv">
            <dt>rarity</dt><dd><Stars n={e.rarity} /></dd>
            <dt>cost</dt><dd>{e.cost}</dd>
            <dt>category</dt><dd>{e.category}</dd>
            <dt>origin</dt><dd>{e.origin}</dd>
            <dt>max level</dt><dd>{e.lvMax}</dd>
            <dt>max ATK / HP</dt><dd>{maxAtk} / {maxHp}</dd>
          </dl>
        </div>
      </div>

      <Block title="Effect — not limit broken">
        <div className="skill">
          <div className="effects">
            {e.effectsBase.map((ef, i) => <EffectRow key={i} effect={ef} level={0} />)}
          </div>
        </div>
      </Block>

      <Block title="Effect — max limit break (MLB)">
        <div className="skill">
          <div className="effects">
            {e.effectsMlb.map((ef, i) => <EffectRow key={i} effect={ef} level={0} />)}
          </div>
          {JSON.stringify(e.effectsBase) === JSON.stringify(e.effectsMlb) && (
            <div className="detail-text" style={{ marginTop: 8 }}>
              This CE has no MLB variant — the effect is the same either way.
            </div>
          )}
        </div>
      </Block>
    </div>
  );
}
