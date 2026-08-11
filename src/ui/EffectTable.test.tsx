/**
 * Renderização da tabela de progressão, com dados reais.
 *
 * Cobre os dois eixos: nível de skill (1–10) e overcharge (OC1–OC5). O caso do
 * overcharge é o que mais importa — os valores de `svals2..svals5` foram
 * descartados do modelo até agora, e este teste é o que garante que voltaram e
 * chegam à tela.
 */

import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { IndexEntry, IndexEntryServant, Servant } from "../core/model.js";
import { EffectTable } from "./components.js";

const index = JSON.parse(readFileSync("public/data/index.json", "utf8")) as IndexEntry[];
const servants = index.filter((e): e is IndexEntryServant => e.kind === "servant");
const load = (cn: number): Servant => {
  const id = servants.find((s) => s.collectionNo === cn)!.id;
  return JSON.parse(readFileSync(`public/data/servant/${id}.json`, "utf8")) as Servant;
};

const strip = (html: string) => html.replace(/<!--[^]*?-->/g, "");
const text = (html: string) => strip(html).replace(/<[^>]+>/g, "|");

describe("EffectTable — overcharge", () => {
  const nero = load(5); // Nero Claudius (saber): downDefence escala 20% -> 40%

  const render = (npLevel: number) =>
    renderToString(
      <EffectTable
        effects={nero.np!.effects}
        columns={["OC1", "OC2", "OC3", "OC4", "OC5"]}
        valueAt={(e, oc) => (e.valuesByOvercharge ? e.valuesByOvercharge[oc] : e.values)?.[npLevel - 1]}
        highlight={0}
      />,
    );

  it("mostra as cinco colunas de overcharge", () => {
    const html = strip(render(1));
    for (const c of ["OC1", "OC2", "OC3", "OC4", "OC5"]) expect(html).toContain(`>${c}<`);
  });

  it("mostra a progressão 20% -> 40% da redução de defesa", () => {
    const t = text(render(1));
    for (const v of ["20%", "25%", "30%", "35%", "40%"]) expect(t).toContain(`|${v}|`);
  });

  it("colapsa numa célula só o efeito que não varia com overcharge", () => {
    const html = strip(render(1));
    // O dano do NP da Nero é constante ao longo do overcharge.
    expect(html).toContain("constant");
    expect(html).toContain(`colSpan="5"`); // React 19 preserva o camelCase
  });

  it("trocar o nível de NP muda os valores exibidos", () => {
    expect(text(render(1))).not.toBe(text(render(5)));
  });

  it("destaca a coluna OC1, que é o caso normal de uso", () => {
    expect(strip(render(1))).toContain('class="hl"');
  });
});

describe("EffectTable — super-efetivo", () => {
  const gil = load(12); // Gilgamesh: Enuma Elish, 150% -> 200% vs weakToEnumaElish

  const html = strip(
    renderToString(
      <EffectTable
        effects={gil.np!.effects}
        columns={["OC1", "OC2", "OC3", "OC4", "OC5"]}
        valueAt={(e, oc) => (e.valuesByOvercharge ? e.valuesByOvercharge[oc] : e.values)?.[0]}
        superEffectiveAt={(e, oc) => {
          const se = e.superEffective;
          if (!se) return undefined;
          return (se.valuesByOvercharge ? se.valuesByOvercharge[oc] : se.values)?.[0];
        }}
        highlight={0}
      />,
    ),
  );

  it("nomeia o trait alvo em vez de mostrar o id cru", () => {
    expect(html).toContain("weakToEnumaElish");
    expect(html).not.toContain("trait 2008");
  });

  it("mostra o multiplicador escalando de 150% a 200% pelo overcharge", () => {
    const t = text(html);
    for (const v of ["150%", "162.5%", "175%", "187.5%", "200%"]) expect(t).toContain(`|${v}|`);
  });

  it("dá linha própria ao super-efetivo, separada do dano base", () => {
    expect(html).toContain("se-row");
    expect(html).toContain("super-effective");
  });
});

describe("EffectTable — níveis de skill", () => {
  const artoria = load(2);
  // Buscada por `num`, não por nome: 4,4% dos nomes de skill ainda estão em
  // japonês no _lang_en, e o da skill 1 da Artoria é um deles.
  const charisma = artoria.skills.find((s) => s.num === 1)!;

  const html = strip(
    renderToString(
      <EffectTable
        effects={charisma.effects}
        columns={Array.from({ length: 10 }, (_, i) => `Lv${i + 1}`)}
        valueAt={(e, i) => e.values[i]}
        highlight={9}
      />,
    ),
  );

  it("mostra as dez colunas de nível", () => {
    expect(html).toContain(">Lv1<");
    expect(html).toContain(">Lv10<");
  });

  it("mostra a progressão do buff de ataque, não só o nível máximo", () => {
    // Skill 1 (理想郷の騎士 EX): upAtk vai de 20% no Lv1 a 30% no Lv10.
    const t = text(html);
    expect(t).toContain("|20%|");
    expect(t).toContain("|30%|");
  });

  it("mantém visível a condição e o alvo de cada efeito", () => {
    expect(html).toContain("ptAll");
  });
});
