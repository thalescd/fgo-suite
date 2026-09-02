/**
 * Carregamento dos artefatos de build.
 *
 * O índice, as constantes e o catálogo de traits são carregados uma vez e
 * ficam em memória (855 KB no total). Detalhe de servo e de CE vem sob demanda.
 */

import type { Constants, CraftEssence, IndexEntry, Meta, MysticCode, Servant } from "../core/model.js";

const BASE = "/data";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface TraitEntry {
  id: number;
  name: string;
  uses: number;
}

export interface Bootstrap {
  index: IndexEntry[];
  meta: Meta;
  traits: TraitEntry[];
  constants: Constants;
  /** 28 no total, 12 KB. Cabe no bootstrap; CE continua sob demanda. */
  mysticCodes: MysticCode[];
}

let bootstrapPromise: Promise<Bootstrap> | null = null;

export function loadBootstrap(): Promise<Bootstrap> {
  bootstrapPromise ??= (async () => {
    const [index, meta, traits, constants, mysticCodes] = await Promise.all([
      getJson<IndexEntry[]>("index.json"),
      getJson<Meta>("meta.json"),
      getJson<TraitEntry[]>("traits.json"),
      getJson<Constants>("constants.json"),
      getJson<MysticCode[]>("mysticCodes.json"),
    ]);
    return { index, meta, traits, constants, mysticCodes };
  })();
  return bootstrapPromise;
}

const detailCache = new Map<string, Promise<unknown>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = detailCache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load();
    detailCache.set(key, p);
  }
  return p;
}

export const loadServant = (id: number): Promise<Servant> =>
  cached(`s${id}`, () => getJson<Servant>(`servant/${id}.json`));

export const loadEquip = (id: number): Promise<CraftEssence> =>
  cached(`e${id}`, () => getJson<CraftEssence>(`equip/${id}.json`));
