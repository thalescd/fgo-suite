/**
 * A camada que a tela acrescenta ao núcleo: query string -> cenário -> relatório.
 *
 * O cálculo em si já é coberto por `core/damage.test.ts`. O que se testa aqui é
 * a tradução — defaults por raridade, regras de ação válida, e o relatório
 * mostrando de fato o que entrou e o que não entrou.
 */

import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { calculateDamage, type DamageData } from "../core/damage.js";
import type { Constants, IndexEntry, IndexEntryServant, Meta, Servant } from "../core/model.js";
import { CalcPage } from "./CalcPage.js";
import { DamageReport } from "./DamageReport.js";
import { DEFAULT_CALC, defaultNpLevel, parseCalc, serializeCalc, toDamageInput } from "./calcState.js";
import type { Bootstrap, TraitEntry } from "./data.js";

const index = JSON.parse(readFileSync("public/data/index.json", "utf8")) as IndexEntry[];
const constants = JSON.parse(readFileSync("public/data/constants.json", "utf8")) as Constants;
const traits = JSON.parse(readFileSync("public/data/traits.json", "utf8")) as { id: number; name: string }[];
const servants = index.filter((e): e is IndexEntryServant => e.kind === "servant");

const load = (cn: number): Servant => {
  const id = servants.find((s) => s.collectionNo === cn)!.id;
  return JSON.parse(readFileSync(`public/data/servant/${id}.json`, "utf8")) as Servant;
};

const traitName = (id: number) => traits.find((t) => t.id === id)?.name ?? `trait ${id}`;
const traitId = (name: string) => traits.find((t) => t.name === name)!.id;

const artoria = load(2);
const gilgamesh = load(12);

const dataFor = (s: Servant): DamageData => ({
  servants: new Map([[s.id, s]]),
  equips: new Map(),
  mysticCodes: new Map(),
  constants,
});

/** O caminho inteiro da tela: URL -> entrada -> resultado. */
const run = (s: Servant, query: string) =>
  calculateDamage(toDamageInput(parseCalc(new URLSearchParams(query)), s, traitName), dataFor(s));

const strip = (html: string) => html.replace(/<!--[^]*?-->/g, "");
const text = (html: string) => strip(html).replace(/<[^>]+>/g, "|");

describe("a página monta", () => {
  const boot: Bootstrap = {
    index,
    meta: JSON.parse(readFileSync("public/data/meta.json", "utf8")) as Meta,
    traits: traits as TraitEntry[],
    constants,
  };
  // O SSR não roda efeitos, então o servo nunca chega a carregar aqui. O que
  // este teste cobre é a montagem da árvore — import quebrado, hook fora de
  // ordem, acesso a campo de um servo que ainda é null.
  const renderAt = (url: string) =>
    strip(renderToString(<StaticRouter location={url}><CalcPage boot={boot} /></StaticRouter>));

  it("sem servo escolhido, pede um", () => {
    expect(renderAt("/calc")).toContain("who is attacking?");
  });

  it("com servo na URL, entra em carregamento em vez de quebrar", () => {
    expect(renderAt(`/calc?s=${artoria.id}`)).toContain("loading");
  });
});

describe("estado na query string", () => {
  it("URL vazia é o cenário padrão", () => {
    expect(parseCalc(new URLSearchParams())).toEqual(DEFAULT_CALC);
  });

  it("o padrão não polui a URL — só o que foi mudado aparece", () => {
    expect(serializeCalc(DEFAULT_CALC).toString()).toBe("");
  });

  it("sobrevive a ida e volta", () => {
    const q = "s=100100&lv=120&fou=2000&np=5&oc=3&sk=1,3&sklv=6&act=buster&pos=2&crit=1&ec=lancer&ea=sky&roll=min";
    const state = parseCalc(new URLSearchParams(q));
    expect(parseCalc(serializeCalc(state))).toEqual(state);
  });

  it("valor fora de faixa é limitado, não aceito", () => {
    const s = parseCalc(new URLSearchParams("oc=99&sklv=0&pos=7&fou=999999"));
    expect([s.overcharge, s.skillLevel, s.position, s.fou]).toEqual([5, 1, 3, 2000]);
  });
});

describe("defaults do servo (D9)", () => {
  it("nível é o natural máximo, e o fou entra nele", () => {
    const r = run(artoria, `s=${artoria.id}`);
    expect(r.assumptions.resolved).toContain(`${artoria.name} lv${artoria.lvMax}`);
    expect(r.breakdown.servantAtk).toBe(artoria.atkGrowth[artoria.lvMax - 1]! + 1000);
  });

  it("5★ começa em NP1 e welfare em NP5", () => {
    const welfare = servants.find((s) => s.isWelfare && s.npCard !== null)!;
    const w = JSON.parse(readFileSync(`public/data/servant/${welfare.id}.json`, "utf8")) as Servant;
    expect(defaultNpLevel(artoria)).toBe(1);
    expect(defaultNpLevel(w)).toBe(5);
  });

  it("nível explícito na URL vence o padrão", () => {
    const r = run(artoria, `s=${artoria.id}&lv=120`);
    expect(r.breakdown.servantAtk).toBe(artoria.atkGrowth[119]! + 1000);
  });
});

describe("o que a tela impede", () => {
  it("NP não pode ser crítico, mesmo com crit=1 na URL", () => {
    const withCrit = toDamageInput(parseCalc(new URLSearchParams("act=np&crit=1")), artoria, traitName);
    expect(withCrit.action.isCrit).toBe(false);
    // Num card o mesmo parâmetro passa, então não é a URL que está sendo ignorada.
    const card = toDamageInput(parseCalc(new URLSearchParams("act=buster&crit=1")), artoria, traitName);
    expect(card.action.isCrit).toBe(true);
  });

  it("os buffs pré-dano do NP entram sozinhos, e só no NP", () => {
    const np = toDamageInput(parseCalc(new URLSearchParams("act=np")), gilgamesh, traitName);
    const card = toDamageInput(parseCalc(new URLSearchParams("act=buster")), gilgamesh, traitName);
    expect(np.buffStack).toContainEqual({ kind: "npSelfBuff" });
    expect(card.buffStack).not.toContainEqual({ kind: "npSelfBuff" });
  });

  it("append passive fica de fora até ser pedido", () => {
    expect(toDamageInput(DEFAULT_CALC, artoria, traitName).buffStack).toEqual([{ kind: "npSelfBuff" }]);
    const on = toDamageInput({ ...DEFAULT_CALC, appends: [1] }, artoria, traitName);
    expect(on.buffStack).toContainEqual({ kind: "append", num: 1, level: 10 });
  });
});

describe("o cenário chega inteiro no cálculo", () => {
  it("a classe do inimigo escolhida na URL vira vantagem de classe", () => {
    const neutral = run(artoria, `s=${artoria.id}&ec=saber`);
    const weak = run(artoria, `s=${artoria.id}&ec=lancer`);
    expect(neutral.breakdown.triangleModifier).toBe(1);
    expect(weak.breakdown.triangleModifier).toBe(2);
    expect(weak.avg / neutral.avg).toBeCloseTo(2, 5);
  });

  it("marcar as skills na URL muda o número", () => {
    const bare = run(artoria, `s=${artoria.id}`);
    const buffed = run(artoria, `s=${artoria.id}&sk=1,2,3`);
    expect(buffed.avg).toBeGreaterThan(bare.avg);
    expect(bare.assumptions.appliedBuffs).toHaveLength(0);
  });

  it("o buff de Buster da skill entra no NP Buster — a regressão do card", () => {
    // Ler `action.card` (indefinido num NP) descartava este buff em silêncio.
    const r = run(artoria, `s=${artoria.id}&sk=2`);
    expect(artoria.np!.card).toBe("buster");
    expect(r.breakdown.cardMod).toBeGreaterThan(0);
    // O buff da skill 2 não pode aparecer entre os recusados: era isso que
    // acontecia. Filtrar por `source`, não pela mensagem — a passiva Riding da
    // Artoria é Quick e é recusada aqui com toda a razão.
    expect(r.assumptions.skippedBuffs.filter((b) => /skill 2/.test(b.source))).toEqual([]);
    // Mesma skill num card Arts tem de ser recusada — senão o teste acima
    // passaria igual com a restrição de card deixando de ser lida.
    const arts = run(artoria, `s=${artoria.id}&act=arts&sk=2`);
    expect(arts.assumptions.skippedBuffs.some((b) => /cardBuster/.test(b.reason))).toBe(true);
    expect(arts.breakdown.cardMod).toBe(0);
  });

  it("trait do inimigo na URL liga o super-efetivo", () => {
    const q = `s=${gilgamesh.id}&et=${traitId("weakToEnumaElish")}`;
    expect(run(gilgamesh, `s=${gilgamesh.id}`).breakdown.superEffectiveModifier).toBe(100);
    expect(run(gilgamesh, q).breakdown.superEffectiveModifier).toBe(150);
    expect(run(gilgamesh, `${q}&oc=5`).breakdown.superEffectiveModifier).toBe(200);
  });
});

describe("relatório", () => {
  const render = (s: Servant, query: string) =>
    strip(renderToString(<DamageReport result={run(s, query)} constants={constants} />));

  it("mostra o dano garantido junto com a média", () => {
    const r = run(artoria, `s=${artoria.id}`);
    const t = text(render(artoria, `s=${artoria.id}`));
    expect(t).toContain(r.min.toLocaleString("en-US"));
    expect(t).toContain("guaranteed");
  });

  it("min como roll escolhido troca o número em destaque", () => {
    const r = run(artoria, `s=${artoria.id}&roll=min`);
    const html = render(artoria, `s=${artoria.id}&roll=min`);
    expect(html).toContain("minimum roll");
    expect(text(html)).toContain(`|${r.min.toLocaleString("en-US")}|`);
  });

  it("lista os buffs aplicados com origem e slot", () => {
    const html = render(artoria, `s=${artoria.id}&sk=1,2,3`);
    expect(html).toContain("upAtk");
    expect(html).toContain("atkMod");
    expect(html).toContain("skill 1");
  });

  it("diz explicitamente quando não há buff nenhum", () => {
    expect(render(artoria, `s=${artoria.id}`)).toContain("no buffs at all");
  });

  it("mostra o motivo de um buff não ter entrado", () => {
    // Skill 2 da Artoria é restrita a Buster; num Arts ela precisa ser recusada
    // com o motivo à vista, que foi como o bug do card apareceu.
    const html = render(artoria, `s=${artoria.id}&act=arts&sk=2`);
    expect(html).toContain("Not applied");
    expect(html).toContain("cardBuster");
  });

  it("termo neutro não vira linha; o termo ativo vira", () => {
    expect(render(artoria, `s=${artoria.id}&ec=saber`)).not.toContain("Class advantage");
    expect(render(artoria, `s=${artoria.id}&ec=lancer`)).toContain("Class advantage");
  });

  it("crítico e chain aparecem como termo próprio", () => {
    const crit = render(artoria, `s=${artoria.id}&act=buster&crit=1&bchain=1`);
    expect(crit).toContain("Critical");
    expect(crit).toContain("Buster chain");
  });

  it("buff de dano de NP num card é listado, mas marcado como não contado", () => {
    // O buff existe no stack e o jogador precisa vê-lo; o que não pode é entrar
    // no fator, porque a fórmula multiplica npDamageMod por isNP.
    const card = render(artoria, `s=${artoria.id}&act=buster&sk=1,2,3`);
    expect(card).toContain("upNpdamage");
    expect(card).toContain("only applies to NP damage");
    expect(card).not.toContain("Damage bonuses");

    const np = render(artoria, `s=${artoria.id}&act=np&sk=1,2,3`);
    expect(np).toContain("Damage bonuses");
    expect(np).not.toContain("only applies to NP damage");
  });

  /**
   * As mensagens de `assumptions` são interface, não log: aparecem no relatório
   * e vão virar resposta do MCP. Varrer o roster inteiro é o que garante que
   * nenhum template de mensagem escapou — testar um servo só cobriria os
   * caminhos que aquele servo por acaso aciona.
   */
  it("nenhuma mensagem em português chega à tela, em nenhum servo", () => {
    const suspicious = /[áàâãéêíóôõúçÁÉÍÓÚÇ]|\b(alvo|dano|servo|restrito|exige|nenhum|antes|carregado|atacante|acao)\b/i;
    const offenders: string[] = [];

    for (const entry of servants) {
      const s = JSON.parse(readFileSync(`public/data/servant/${entry.id}.json`, "utf8")) as Servant;
      // Dois cenários: NP (aciona os buffs pré-dano) e um card Arts crítico com
      // todas as skills (aciona as recusas por restrição de card e o "critical").
      for (const q of ["act=np", "act=arts&crit=1"]) {
        const a = calculateDamage(
          toDamageInput(
            parseCalc(new URLSearchParams(`${q}&sk=1,2,3&ap=1,2,3,4,5&ec=lancer&ea=sky`)),
            s,
            traitName,
          ),
          dataFor(s),
        ).assumptions;

        for (const str of [
          ...a.resolved,
          ...a.appliedBuffs.map((b) => b.source),
          ...a.skippedBuffs.flatMap((b) => [b.source, b.reason]),
        ]) {
          // O nome do próprio servo pode ter acento (Scáthach) e não é mensagem.
          const withoutName = str.split(s.name).join("");
          if (suspicious.test(withoutName)) offenders.push(`${s.name}: ${str}`);
        }
      }
    }

    expect(offenders.slice(0, 5)).toEqual([]);
  });

  it("super-efetivo aparece nomeado no cenário", () => {
    const html = render(gilgamesh, `s=${gilgamesh.id}&et=${traitId("weakToEnumaElish")}`);
    expect(html).toContain("Super effective");
    expect(text(html)).toContain("|x1.50|");
  });
});
