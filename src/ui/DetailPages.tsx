import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { CraftEssence, Servant, Skill } from "../core/model.js";
import { Block, EffectRow, Stars } from "./components.js";
import { loadEquip, loadServant } from "./data.js";

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

const Back = () => <Link className="back" to="/">← voltar à busca</Link>;

/** Skills mostram o nível 10 (o default do preset); NPs mostram NP1..NP5. */
function SkillCard({ skill, levelIndex }: { skill: Skill; levelIndex?: number }) {
  return (
    <div className="skill">
      <div className="title">
        {skill.num > 0 && <span className="num">#{skill.num}</span>}
        <span>{skill.name}</span>
        {skill.cooldown.length > 0 && (
          <span className="num">CD {skill.cooldown[0]}→{skill.cooldown[skill.cooldown.length - 1]}</span>
        )}
        {skill.previousVersions && (
          <span className="num" title="rank ups substituídos">
            +{skill.previousVersions.length} versão(ões) anterior(es)
          </span>
        )}
      </div>
      {skill.detail && <div className="detail-text">{skill.detail}</div>}
      <div className="effects">
        {skill.effects.map((e, i) => <EffectRow key={i} effect={e} level={levelIndex} />)}
      </div>
    </div>
  );
}

export function ServantPage() {
  const { id } = useParams();
  const { data: s, error } = useAsync<Servant>(() => loadServant(Number(id)), [id]);

  if (error) return <div className="detail"><Back /><p className="empty">{error}</p></div>;
  if (!s) return <div className="detail"><Back /><p className="empty">carregando…</p></div>;

  const atk = (lv: number) => s.atkGrowth[lv - 1] ?? null;
  const hp = (lv: number) => s.hpGrowth[lv - 1] ?? null;
  const npLevelDefault = s.rarity <= 3 || s.isWelfare ? 5 : 1;

  return (
    <div className="detail">
      <Back />

      <div className="detail-head">
        {s.assets.charaGraph[0] && <img src={s.assets.charaGraph[0]} alt="" />}
        <div>
          <h2>{s.name}</h2>
          <div className="orig">{s.originalName} · nº {s.collectionNo} · id {s.id}</div>
          <dl className="kv">
            <dt>classe</dt><dd>{s.className}</dd>
            <dt>raridade</dt><dd><Stars n={s.rarity} /></dd>
            <dt>atributo</dt><dd>{s.attribute}</dd>
            <dt>custo</dt><dd>{s.cost}</dd>
            <dt>obtenção</dt><dd>{s.isWelfare ? "welfare (evento)" : "normal"}</dd>
            <dt>deck</dt><dd>{s.cards.map((c) => c[0]!.toUpperCase()).join("")}</dd>
            <dt>gera estrelas</dt><dd>{s.starGen}%</dd>
            {s.aliases.length > 0 && <><dt>apelidos</dt><dd>{s.aliases.join(", ")}</dd></>}
          </dl>
        </div>
      </div>

      <Block title="Status por nível">
        <table className="growth">
          <thead>
            <tr><th>nível</th><th>ATK</th><th>HP</th></tr>
          </thead>
          <tbody>
            {[1, s.lvMax, 100, 120].filter((lv, i, a) => a.indexOf(lv) === i && atk(lv) !== null).map((lv) => (
              <tr key={lv}>
                <td>{lv}{lv === s.lvMax && " (máx natural)"}{lv > s.lvMax && " (grail)"}</td>
                <td>{atk(lv)?.toLocaleString("pt-BR")}</td>
                <td>{hp(lv)?.toLocaleString("pt-BR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
          Preset padrão: lv{s.lvMax} + 1000 fou = <strong>{((atk(s.lvMax) ?? 0) + 1000).toLocaleString("pt-BR")}</strong> ATK ·
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
            {s.np.damageMultiplier && (
              <div className="detail-text">
                Multiplicador NP1–NP5: {s.np.damageMultiplier.map((v) => `${v}%`).join(" · ")}
                {s.np.hits.length > 1 && <> · {s.np.hits.length} hits ({s.np.hits.join("/")})</>}
              </div>
            )}
            <div className="effects">
              {s.np.effects.map((e, i) => <EffectRow key={i} effect={e} level={npLevelDefault - 1} />)}
            </div>
          </div>
          {s.npAlternatives.length > 0 && (
            <details className="skill" style={{ opacity: 0.85 }}>
              <summary style={{ cursor: "pointer" }}>
                {s.npAlternatives.length} NP alternativo(s) — versões anteriores ou por card
              </summary>
              <div style={{ marginTop: 10 }}>
                {s.npAlternatives.map((np) => (
                  <div key={np.id} className="detail-text">
                    {np.name} · {np.card} · {np.target} ·{" "}
                    {np.damageMultiplier ? `${np.damageMultiplier[0]}%` : "sem dano"}{" "}
                    {np.condQuestId > 0 && <>· quest {np.condQuestId}</>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </Block>
      )}

      <Block title="Skills (valores em nível 10)">
        {s.skills.map((sk) => <SkillCard key={sk.id} skill={sk} levelIndex={9} />)}
      </Block>

      {s.classPassive.length > 0 && (
        <Block title="Passivas de classe">
          {s.classPassive.map((sk) => <SkillCard key={sk.id} skill={sk} levelIndex={0} />)}
        </Block>
      )}

      {s.appendPassive.length > 0 && (
        <Block title="Append passives (desligadas por padrão no cálculo)">
          {s.appendPassive.map((sk) => <SkillCard key={sk.id} skill={sk} levelIndex={9} />)}
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
  if (!e) return <div className="detail"><Back /><p className="empty">carregando…</p></div>;

  const maxAtk = e.atkGrowth[e.atkGrowth.length - 1];
  const maxHp = e.hpGrowth[e.hpGrowth.length - 1];

  return (
    <div className="detail">
      <Back />
      <div className="detail-head">
        {e.assets.charaGraph && <img src={e.assets.charaGraph} alt="" />}
        <div>
          <h2>{e.name}</h2>
          <div className="orig">{e.originalName} · nº {e.collectionNo} · id {e.id}</div>
          <dl className="kv">
            <dt>raridade</dt><dd><Stars n={e.rarity} /></dd>
            <dt>custo</dt><dd>{e.cost}</dd>
            <dt>categoria</dt><dd>{e.category === "combat" ? "combate" : "farm"}</dd>
            <dt>origem</dt><dd>{e.origin}</dd>
            <dt>nível máx</dt><dd>{e.lvMax}</dd>
            <dt>ATK / HP máx</dt><dd>{maxAtk} / {maxHp}</dd>
          </dl>
        </div>
      </div>

      <Block title="Efeito — sem limit break">
        <div className="skill">
          <div className="effects">
            {e.effectsBase.map((ef, i) => <EffectRow key={i} effect={ef} level={0} />)}
          </div>
        </div>
      </Block>

      <Block title="Efeito — max limit break (MLB)">
        <div className="skill">
          <div className="effects">
            {e.effectsMlb.map((ef, i) => <EffectRow key={i} effect={ef} level={0} />)}
          </div>
          {JSON.stringify(e.effectsBase) === JSON.stringify(e.effectsMlb) && (
            <div className="detail-text" style={{ marginTop: 8 }}>
              Esta CE não tem variante MLB — o efeito é o mesmo nos dois casos.
            </div>
          )}
        </div>
      </Block>
    </div>
  );
}
