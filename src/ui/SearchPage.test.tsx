/**
 * Smoke test de renderização da tela de busca.
 *
 * Renderiza via `react-dom/server` com o índice REAL e uma query string real,
 * provando a cadeia inteira: URL -> parseFilters -> search -> facetas -> DOM.
 *
 * Não precisa de browser nem de jsdom: usa só react-dom e react-router, que já
 * são dependências do projeto.
 *
 * Requer `npm run data:build`.
 */

import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { Constants, IndexEntry, Meta } from "../core/model.js";
import { SearchPage } from "./SearchPage.js";
import type { Bootstrap, TraitEntry } from "./data.js";

const json = <T,>(p: string): T => JSON.parse(readFileSync(`public/data/${p}`, "utf8")) as T;

const boot: Bootstrap = {
  index: json<IndexEntry[]>("index.json"),
  meta: json<Meta>("meta.json"),
  traits: json<TraitEntry[]>("traits.json"),
  constants: json<Constants>("constants.json"),
};

/**
 * O SSR do React insere `<!-- -->` entre expressões adjacentes, o que quebraria
 * asserções sobre texto contíguo. Removemos os marcadores antes de comparar.
 */
const renderAt = (url: string): string =>
  renderToString(
    <StaticRouter location={url}>
      <SearchPage boot={boot} />
    </StaticRouter>,
  ).replace(/<!--[\s\S]*?-->/g, "");

describe("SearchPage", () => {
  it("renderiza a listagem de servos sem filtro", () => {
    const html = renderAt("/");
    expect(html).toContain("466</strong> servants");
    expect(html).toContain("Mash Kyrielight");
  });

  it("aplica filtro vindo da query string", () => {
    const html = renderAt("/?class=archer&rarity=5");
    const expected = boot.index.filter(
      (e) => e.kind === "servant" && e.className === "archer" && e.rarity === 5,
    ).length;
    expect(html).toContain(`${expected}</strong> servants`);
    expect(expected).toBeGreaterThan(0);
  });

  it("filtro de alvo de NP chega ao resultado", () => {
    const html = renderAt("/?np=aoe");
    expect(html).toContain("240</strong> servants");
  });

  it("busca por apelido funciona na tela", () => {
    const html = renderAt("/?q=auo");
    expect(html).toContain("Gilgamesh");
    expect(html).toContain("1</strong> servants");
  });

  it("troca para a aba de craft essences", () => {
    const html = renderAt("/?kind=equip");
    expect(html).toContain("2149</strong> craft essences");
  });

  it("filtra CE por categoria", () => {
    const html = renderAt("/?kind=equip&cat=combat");
    expect(html).toContain("1309</strong> craft essences");
  });

  it("mostra as facetas com contagem", () => {
    const html = renderAt("/");
    // Ancorado no <summary>: "Class" sozinho casaria com qualquer class="..."
    expect(html).toContain("<summary>Class</summary>");
    expect(html).toContain("<summary>NP target</summary>");
    expect(html).toContain("saber");
  });

  it("as facetas de CE substituem as de servo", () => {
    const html = renderAt("/?kind=equip");
    expect(html).toContain("Category");
    expect(html).not.toContain("<summary>NP target</summary>");
  });

  it("pagina em 120 e oferece mostrar mais", () => {
    const html = renderAt("/");
    expect(html).toContain("showing 120");
    expect(html).toContain("show 120 more");
  });

  it("estado vazio quando nada casa", () => {
    const html = renderAt("/?q=zzzznaoexiste");
    expect(html).toContain("No results");
  });

  it("ordenação por ATK muda o primeiro resultado", () => {
    const asc = renderAt("/?sort=atk&dir=asc");
    const desc = renderAt("/?sort=atk&dir=desc");
    expect(asc).not.toBe(desc);
  });

  it("links de detalhe apontam para a rota certa", () => {
    expect(renderAt("/?q=merlin")).toContain('href="/servant/500800"');
  });
});
