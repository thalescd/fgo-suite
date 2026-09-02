/**
 * Carregamento dos artefatos no lado do Node.
 *
 * `core/` é livre de I/O de propósito (D8), então quem lê disco é a casca. A
 * tela faz o mesmo trabalho com `fetch` em `ui/data.ts`; aqui é `readFileSync`
 * sobre os mesmos arquivos de `public/data/`.
 *
 * O índice, as constantes, os traits e os Mystic Codes ficam em memória — 855 KB
 * no total, e o servidor é um processo local de vida longa. Documento de servo e
 * de CE vem sob demanda, com cache: uma conversa sobre dano toca poucos servos.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  Constants,
  CraftEssence,
  IndexEntry,
  IndexEntryServant,
  Meta,
  MysticCode,
  Servant,
} from "../core/model.js";
import { EMPTY_FILTERS, search } from "../core/search.js";

/**
 * A raiz do projeto a partir deste arquivo, não do diretório de trabalho.
 *
 * Um cliente MCP inicia o servidor de onde bem entender; depender de `cwd`
 * faria o servidor funcionar no terminal e falhar dentro do editor.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = join(ROOT, "public", "data");

/**
 * `public/data/` é gitignored e reconstruível, então clone novo não tem nenhum
 * artefato. Sem esta mensagem, o erro é um `ENOENT` cru estourando dentro do
 * cliente MCP, onde ninguém vê stack — a tela já toma o mesmo cuidado.
 */
function json<T>(...path: string[]): T {
  const file = join(DATA, ...path);
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (e) {
    const why = (e as NodeJS.ErrnoException).code === "ENOENT" ? "not found" : "could not be read";
    throw new Error(`${file} ${why}. Run \`npm run data:build\` to generate public/data/ (it is gitignored).`);
  }
}

export interface TraitEntry {
  id: number;
  name: string;
  uses: number;
}

export class Store {
  readonly index: IndexEntry[];
  readonly servantIndex: IndexEntryServant[];
  readonly meta: Meta;
  readonly constants: Constants;
  readonly traits: TraitEntry[];
  readonly mysticCodes: MysticCode[];

  private readonly servantCache = new Map<number, Servant>();
  private readonly equipCache = new Map<number, CraftEssence>();

  constructor() {
    this.index = json<IndexEntry[]>("index.json");
    this.servantIndex = this.index.filter((e): e is IndexEntryServant => e.kind === "servant");
    this.meta = json<Meta>("meta.json");
    this.constants = json<Constants>("constants.json");
    this.traits = json<TraitEntry[]>("traits.json");
    this.mysticCodes = json<MysticCode[]>("mysticCodes.json");
  }

  servant(id: number): Servant {
    let s = this.servantCache.get(id);
    if (!s) {
      s = json<Servant>("servant", `${id}.json`);
      this.servantCache.set(id, s);
    }
    return s;
  }

  equip(id: number): CraftEssence {
    let e = this.equipCache.get(id);
    if (!e) {
      e = json<CraftEssence>("equip", `${id}.json`);
      this.equipCache.set(id, e);
    }
    return e;
  }

  traitName(id: number): string {
    return this.traits.find((t) => t.id === id)?.name ?? `trait ${id}`;
  }

  /**
   * Acha um servo por id, `collectionNo` ou nome.
   *
   * O caminho do nome passa pelo motor de busca em vez de comparar strings: sai
   * de graça a insensibilidade a acento e a tabela de apelidos, então "auo" acha
   * o Gilgamesh aqui como acha na tela.
   */
  findServant(ref: string | number): IndexEntryServant | null {
    const n = typeof ref === "number" ? ref : Number(ref);
    if (Number.isFinite(n)) {
      const byId = this.servantIndex.find((s) => s.id === n);
      if (byId) return byId;
      const byNo = this.servantIndex.find((s) => s.collectionNo === n);
      if (byNo) return byNo;
    }
    if (typeof ref === "string" && ref.trim()) {
      const hits = search(this.index, { ...EMPTY_FILTERS, kind: "servant", text: ref.trim() });
      if (hits.length > 0) return hits[0] as IndexEntryServant;
    }
    return null;
  }

  /** Idem para Craft Essence: id, `collectionNo` ou nome, pelo mesmo motor. */
  findEquip(ref: string | number): IndexEntry | null {
    const equips = this.index.filter((e) => e.kind === "equip");
    const n = typeof ref === "number" ? ref : Number(ref);
    if (Number.isFinite(n)) {
      const hit = equips.find((e) => e.id === n) ?? equips.find((e) => e.collectionNo === n);
      if (hit) return hit;
    }
    if (typeof ref === "string" && ref.trim()) {
      const hits = search(this.index, { ...EMPTY_FILTERS, kind: "equip", text: ref.trim() });
      if (hits.length > 0) return hits[0]!;
    }
    return null;
  }

  /**
   * Mystic Code por id ou nome.
   *
   * São 28 e ficam em memória, então busca direta basta — e é por `name`, o
   * inglês: `shortName` é japonês e tem quebra de linha dentro.
   */
  findMysticCode(ref: string | number): MysticCode | null {
    const n = typeof ref === "number" ? ref : Number(ref);
    if (Number.isFinite(n)) {
      const byId = this.mysticCodes.find((m) => m.id === n);
      if (byId) return byId;
    }
    const q = String(ref).trim().toLowerCase();
    if (!q) return null;
    return (
      this.mysticCodes.find((m) => m.name.toLowerCase() === q) ??
      this.mysticCodes.find((m) => m.name.toLowerCase().includes(q)) ??
      null
    );
  }
}
