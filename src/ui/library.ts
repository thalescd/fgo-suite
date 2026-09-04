/**
 * Exportar e importar a biblioteca inteira, num arquivo só (5f).
 *
 * ## Não é sobre compartilhar
 *
 * O link já carrega o cenário inteiro — buffs externos expandidos e inimigo
 * incluso —, e quem recebe salva como template dele. Isto resolve outra coisa:
 * **backup e volume**. Hoje, limpou o cache, perdeu; trocou de máquina, perdeu.
 * Foi um buraco que a 5b abriu e a 5e dobrou.
 *
 * ## Um arquivo, as duas listas, `version` desde o primeiro dia
 *
 * No instante em que alguém exporta, o formato virou promessa. As duas listas
 * viajam juntas porque é assim que se usa a biblioteca, e porque definir o
 * formato antes de a 5e existir custaria uma versão nova logo em seguida.
 *
 * O conteúdo é **exatamente o que está no `localStorage`**, mais um cabeçalho:
 * fonte de buff continua sendo a string do link (`504500:1,3`), alvo continua
 * sendo o pedaço de query (`ec=lancer`). Um formato só para o mesmo dado.
 *
 * ## As sementes ficam de fora
 *
 * Exportadas, virariam cópias congeladas que param de melhorar quando o projeto
 * as melhora. Elas nunca estiveram no armazenamento do usuário, e não entram no
 * arquivo dele.
 */

import {
  persist as persistTargets,
  revive as reviveTarget,
  loadTargets,
  type SavedTarget,
} from "./targets.js";
import {
  persist as persistTemplates,
  revive as reviveTemplate,
  loadTemplates,
  type BuffTemplate,
} from "./templates.js";
import { serializeEnemyPreset, serializeExternalBuff } from "../core/scenario.js";

type Store = Pick<Storage, "getItem" | "setItem">;

/** Os dois armazenamentos, para os testes poderem passar falsos. */
export interface Stores {
  templates?: Store;
  targets?: Store;
}

/** Marca o arquivo como nosso: um JSON qualquer é recusado dizendo o que é. */
const KIND = "fgo-tools/library";
const VERSION = 1;

interface LibraryFile {
  kind: string;
  version: number;
  exportedAt: string;
  buffTemplates: { name: string; sources: string[] }[];
  targets: { name: string; enemy: string }[];
}

export function exportLibrary(stores: Stores = {}): string {
  const file: LibraryFile = {
    kind: KIND,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    buffTemplates: loadTemplates(stores.templates).map((t) => ({
      name: t.name,
      sources: t.sources.map(serializeExternalBuff),
    })),
    targets: loadTargets(stores.targets).map((t) => ({
      name: t.name,
      enemy: serializeEnemyPreset(t.enemy),
    })),
  };
  return JSON.stringify(file, null, 2) + "\n";
}

/** Nome de arquivo com a data, para dois backups não se sobrescreverem. */
export const exportFileName = (now = new Date()): string =>
  `fgo-library-${now.toISOString().slice(0, 10)}.json`;

// ------------------------------------------------------------------- importar

export interface ImportCount {
  added: number;
  /** Já existia com o mesmo nome, e o que estava aqui foi mantido. */
  kept: number;
  /** Não deu para ler, e por isso não entrou. */
  dropped: number;
}

export type ImportReport =
  | { ok: false; reason: string }
  | { ok: true; templates: ImportCount; targets: ImportCount };

export type ImportMode = "merge" | "replace";

/**
 * Junta ou substitui, e **diz o que fez**.
 *
 * `merge` nunca destrói: nome repetido mantém o que já estava aqui e conta como
 * `kept`. Substituir em silêncio a lista de alguém seria o pior desfecho
 * possível para um botão de importar.
 *
 * `replace` existe para o caso oposto — restaurar um backup numa máquina que já
 * tem coisa — e a tela pede confirmação antes.
 *
 * **A entrada não é confiável.** Vale a regra do `revive`: cada entrada entra
 * inteira ou não entra. A diferença para a leitura do `localStorage` é que aqui
 * o descarte é **contado e mostrado** — o usuário está agindo e espera resposta,
 * em vez de uma lista que voltou menor sem explicação.
 */
export function importLibrary(text: string, mode: ImportMode, stores: Stores = {}): ImportReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "that file is not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, reason: "that file is not JSON" };

  const file = parsed as Partial<LibraryFile>;
  if (file.kind !== KIND) {
    return { ok: false, reason: "that JSON is not an FGO Tools library export" };
  }
  if (typeof file.version !== "number" || file.version > VERSION) {
    return { ok: false, reason: `that file was written by a newer version (${String(file.version)}) — update first` };
  }

  const merged = <T extends { name: string }>(
    raw: unknown,
    revive: (x: unknown) => T | null,
    existing: T[],
  ): { list: T[]; count: ImportCount } => {
    const entries = Array.isArray(raw) ? raw : [];
    const list = mode === "replace" ? [] : [...existing];
    const count: ImportCount = { added: 0, kept: 0, dropped: 0 };
    for (const e of entries) {
      const t = revive(e);
      if (t === null) {
        count.dropped += 1;
        continue;
      }
      if (list.some((x) => x.name.toLowerCase() === t.name.toLowerCase())) {
        count.kept += 1;
        continue;
      }
      list.push(t);
      count.added += 1;
    }
    return { list, count };
  };

  const t = merged<BuffTemplate>(file.buffTemplates, reviveTemplate, loadTemplates(stores.templates));
  const g = merged<SavedTarget>(file.targets, reviveTarget, loadTargets(stores.targets));

  // Grava as duas só depois de as duas terem sido lidas: metade importada por
  // causa de um erro na segunda lista seria pior que nada importado.
  const w1 = persistTemplates(t.list, stores.templates);
  if (!w1.ok) return { ok: false, reason: w1.reason };
  const w2 = persistTargets(g.list, stores.targets);
  if (!w2.ok) return { ok: false, reason: w2.reason };

  return { ok: true, templates: t.count, targets: g.count };
}

/** O relatório em uma frase, para a tela e o teste dizerem a mesma coisa. */
export function describeImport(r: ImportReport): string {
  if (!r.ok) return r.reason;
  const soma = (k: keyof ImportCount) => r.templates[k] + r.targets[k];
  const partes = [`${soma("added")} imported`];
  if (soma("kept") > 0) partes.push(`${soma("kept")} already existed and were kept`);
  if (soma("dropped") > 0) partes.push(`${soma("dropped")} could not be read and were skipped`);
  return partes.join(" · ");
}
