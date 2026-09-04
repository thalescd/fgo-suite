/**
 * Alvos salvos, guardados no navegador de quem usa (5e).
 *
 * Gêmeo de `templates.ts`, e de propósito: mesma chave versionada, mesma regra
 * de "carrega inteiro ou não carrega", mesmo motivo para não viajar no link.
 * O que difere é o **que** se guarda, e a diferença não é escolha:
 *
 *   um template de buff é por REFERÊNCIA — "Castoria, skills 1 e 3" —, e é isso
 *   que o faz sobreviver a rebalanceamento (D13);
 *
 *   um alvo é por VALOR, porque não existe documento de inimigo para apontar.
 *
 * ## Duas listas, não um "cenário"
 *
 * A mesma double Castoria vai contra três bosses diferentes. Guardar o par
 * junto forçaria uma combinação para cada cruzamento; separados, eles compõem
 * na tela e cada lado cresce sozinho.
 *
 * ## Sem sementes, e isso é decisão
 *
 * `templates.ts` traz double Castoria porque é uma composição **nomeada** pela
 * comunidade. Não existe equivalente para alvo: "Saber human" não é um preset,
 * são dois cliques. O que preenche esse papel é puxar um servo como alvo, que
 * traz classe, atributo e os traits de uma vez — e aí o usuário salva o que
 * interessa a ele.
 */

import { parseEnemyPreset, serializeEnemyPreset, type EnemyPreset } from "../core/scenario.js";

export interface SavedTarget {
  name: string;
  enemy: EnemyPreset;
}

const KEY = "fgo.targets.v1";

type Store = Pick<Storage, "getItem" | "setItem">;

function storage(explicit?: Store): Store | null {
  if (explicit) return explicit;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

interface StoredTarget {
  name: string;
  /** O mesmo pedaço de link que iria na query: `ec=lancer&ea=sky&et=2000`. */
  enemy: string;
}

/** Igual ao template de buff: ou entra inteiro, ou não entra. */
function revive(raw: unknown): SavedTarget | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { name, enemy } = raw as Partial<StoredTarget>;
  if (typeof name !== "string" || name.trim() === "") return null;
  if (typeof enemy !== "string") return null;
  const parsed = parseEnemyPreset(enemy);
  return parsed === null ? null : { name: name.trim(), enemy: parsed };
}

export function loadTargets(store?: Store): SavedTarget[] {
  const s = storage(store);
  if (!s) return [];
  let raw: string | null;
  try {
    raw = s.getItem(KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(revive).filter((t): t is SavedTarget => t !== null);
  } catch {
    return [];
  }
}

export type SaveResult = { ok: true; targets: SavedTarget[] } | { ok: false; reason: string };

function persist(list: SavedTarget[], store?: Store): SaveResult {
  const s = storage(store);
  if (!s) return { ok: false, reason: "this browser is not letting the page store anything — nothing was saved" };
  const payload: StoredTarget[] = list.map((t) => ({ name: t.name, enemy: serializeEnemyPreset(t.enemy) }));
  try {
    s.setItem(KEY, JSON.stringify(payload));
  } catch (e) {
    return { ok: false, reason: `could not save: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ok: true, targets: list };
}

export function saveTarget(name: string, enemy: EnemyPreset, store?: Store): SaveResult {
  const clean = name.trim();
  if (clean === "") return { ok: false, reason: "give the target a name first" };
  const current = loadTargets(store);
  const at = current.findIndex((t) => t.name.toLowerCase() === clean.toLowerCase());
  const next = { name: clean, enemy };
  return persist(at >= 0 ? current.map((t, i) => (i === at ? next : t)) : [...current, next], store);
}

export function removeTarget(name: string, store?: Store): SaveResult {
  return persist(loadTargets(store).filter((t) => t.name !== name), store);
}

/**
 * Um nome sugerido a partir do conteúdo: `"lancer · sky · dragon +2"`.
 *
 * Mesmo papel do sugerido em `templates.ts` — quem recebe um link pronto não
 * montou o alvo e não tem um nome na cabeça.
 */
export function suggestTargetName(
  e: EnemyPreset,
  traitName: (id: number) => string,
  /**
   * Quantos efeitos do jogo procuram este trait. Serve para escolher **qual**
   * dos traits vai no nome: o menos usado é o que mais distingue este alvo dos
   * outros. Um servo puxado entra com 20 traits, e o primeiro da lista costuma
   * ser `genderFemale` — que todo mundo tem, e por isso não diz nada.
   *
   * Omitido = mantém a ordem de entrada.
   */
  traitUses: (id: number) => number = () => 0,
): string {
  const partes: string[] = [];
  if (e.className !== "neutral") partes.push(e.className);
  if (e.attribute !== "neutral") partes.push(e.attribute);
  const ordenados = [...e.traits].sort((a, b) => traitUses(a) - traitUses(b));
  const [primeiro] = ordenados;
  if (primeiro !== undefined) {
    const resto = e.traits.length - 1;
    partes.push(resto > 0 ? `${traitName(primeiro)} +${resto}` : traitName(primeiro));
  }
  if (e.defMod !== 0) partes.push(`def ${e.defMod > 0 ? "+" : ""}${e.defMod}%`);
  if (e.specialDefMod !== 0) partes.push(`sdef ${e.specialDefMod}%`);
  return partes.join(" · ");
}
