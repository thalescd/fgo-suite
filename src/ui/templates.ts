/**
 * Templates de buffs externos, guardados no navegador de quem usa.
 *
 * A composição de suporte é a parte mais cara de montar e a que menos muda:
 * quem tem double Castoria monta double Castoria em toda conta. Mas ela é
 * **do usuário**, não do cenário — por isso não viaja no link.
 *
 * ## O que fica de fora do link, e por quê
 *
 * A URL carrega sempre a lista `sup=` expandida, nunca um `tpl=`. Um link com
 * `tpl=minha-comp` só significaria alguma coisa no navegador de quem o criou:
 * quem recebesse veria o cenário errado, ou nenhum, sem jeito de perceber.
 * Expandido, o link é auto-suficiente — e quem recebe pode abrir o editor e
 * salvar aquela composição como um template **dele**, que é justamente o
 * caminho que motivou os templates existirem.
 *
 * O nome também não viaja: ele é uma etiqueta pessoal, não um fato do cenário.
 *
 * ## O formato guardado
 *
 * Cada fonte é a mesma string que iria na query (`504500:1,3;np=5`), lida pelo
 * mesmo `parseExternalBuff`. Um template é um pedaço de link. Isso evita o
 * defeito mais comum deste projeto — dois formatos para o mesmo dado, um deles
 * envelhecendo calado — e mantém a promessa do D13: guarda-se **referência**
 * (quem, quais skills), nunca o valor resolvido, que apodrece no rebalanceamento
 * seguinte.
 */

import { parseExternalBuff, serializeExternalBuff, type ExternalBuff } from "../core/scenario.js";

export interface BuffTemplate {
  name: string;
  sources: ExternalBuff[];
}

/** A versão está na chave: formato novo não tenta ler o antigo, ignora-o. */
const KEY = "fgo.buffTemplates.v1";

const seed = (name: string, ...sources: string[]): BuffTemplate => ({
  name,
  sources: sources.map(parseExternalBuff).filter((x): x is ExternalBuff => x !== null),
});

/**
 * Exemplos que vêm prontos, para a lista não começar vazia.
 *
 * São **de leitura**: não ocupam o armazenamento do usuário e melhoram quando
 * o projeto os melhora. Quem quiser mudar um aplica, edita e salva com o nome
 * que quiser — vira um template dele, e o exemplo continua onde estava.
 *
 * As skills escolhidas são só as que mexem em dano. A skill 2 da Castoria
 * carrega NP e não muda número nenhum aqui; deixá-la marcada faria a própria
 * tela rotulá-la "no damage buff" dentro de um template do projeto.
 */
export const SEED_TEMPLATES: BuffTemplate[] = [
  seed("Double Castoria", "504500:1,3", "504500:1,3"),
  seed("Double Koyanskaya (Light) + Oberon", "604200:2,3", "604200:2,3", "2800100:1,3"),
];

// ------------------------------------------------------------- armazenamento

type Store = Pick<Storage, "getItem" | "setItem">;

/**
 * O acesso em si pode lançar — aba anônima, cookies de site bloqueados, SSR.
 * Aqui a ausência vira `null` e cada operação decide o que dizer sobre isso;
 * nenhuma delas finge que salvou.
 */
function storage(explicit?: Store): Store | null {
  if (explicit) return explicit;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

interface StoredTemplate {
  name: string;
  sources: string[];
}

/**
 * Um template só entra inteiro.
 *
 * Se uma das fontes não faz sentido, o template todo é descartado em vez de
 * carregar as outras: "Double Castoria" com uma Castoria só é pior que ausente
 * — o nome continuaria prometendo o dobro do buff que ele aplicaria.
 */
export function revive(raw: unknown): BuffTemplate | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { name, sources } = raw as Partial<StoredTemplate>;
  if (typeof name !== "string" || name.trim() === "") return null;
  if (!Array.isArray(sources) || sources.length === 0) return null;

  const parsed: ExternalBuff[] = [];
  for (const s of sources) {
    if (typeof s !== "string") return null;
    const one = parseExternalBuff(s);
    if (one === null) return null;
    parsed.push(one);
  }
  return { name: name.trim(), sources: parsed };
}

/** Só os do usuário. As sementes não moram aqui — ver `SEED_TEMPLATES`. */
export function loadTemplates(store?: Store): BuffTemplate[] {
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
    return parsed.map(revive).filter((t): t is BuffTemplate => t !== null);
  } catch {
    // Blob corrompido: melhor lista vazia que meia lista. Não se apaga a chave —
    // se foi engano nosso, o conteúdo original ainda está lá para recuperar.
    return [];
  }
}

export type SaveResult = { ok: true; templates: BuffTemplate[] } | { ok: false; reason: string };

export function persist(list: BuffTemplate[], store?: Store): SaveResult {
  const s = storage(store);
  if (!s) return { ok: false, reason: "this browser is not letting the page store anything — nothing was saved" };
  const payload: StoredTemplate[] = list.map((t) => ({ name: t.name, sources: t.sources.map(serializeExternalBuff) }));
  try {
    s.setItem(KEY, JSON.stringify(payload));
  } catch (e) {
    return { ok: false, reason: `could not save: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ok: true, templates: list };
}

/**
 * Salva, substituindo o de mesmo nome.
 *
 * Substituir é o que se espera de um nome repetido, mas a tela avisa antes: o
 * botão diz "overwrite" quando o nome já existe, para a troca nunca ser
 * descoberta depois.
 */
export function saveTemplate(name: string, sources: ExternalBuff[], store?: Store): SaveResult {
  const clean = name.trim();
  if (clean === "") return { ok: false, reason: "give the template a name first" };
  if (sources.length === 0) return { ok: false, reason: "there are no external buffs to save" };

  const current = loadTemplates(store);
  const at = current.findIndex((t) => t.name.toLowerCase() === clean.toLowerCase());
  const next = { name: clean, sources };
  return persist(at >= 0 ? current.map((t, i) => (i === at ? next : t)) : [...current, next], store);
}

export function removeTemplate(name: string, store?: Store): SaveResult {
  return persist(loadTemplates(store).filter((t) => t.name !== name), store);
}

// -------------------------------------------------------------------- o nome

/**
 * Um nome sugerido a partir do conteúdo — "Double Castoria", "Koyanskaya of
 * Light x2 + Oberon".
 *
 * Sugestão, não imposição: o campo vem preenchido e o usuário escreve por cima.
 * Existe porque o caso que motivou os templates é receber um link pronto, onde
 * quem salva não montou a composição e não tem um nome na cabeça.
 */
export function suggestName(sources: ExternalBuff[], nameOf: (id: number) => string): string {
  if (sources.length === 0) return "";

  // Agrupa preservando a ordem de entrada: a primeira aparição decide a posição.
  const counts: { id: number; n: number }[] = [];
  for (const s of sources) {
    const found = counts.find((c) => c.id === s.servantId);
    if (found) found.n += 1;
    else counts.push({ id: s.servantId, n: 1 });
  }

  // "Double X" é como a comunidade chama a composição de duas cópias; vale só
  // quando é exatamente isso, senão o sufixo genérico diz a mesma coisa sem
  // precisar de caso especial.
  if (counts.length === 1 && counts[0]!.n === 2) return `Double ${nameOf(counts[0]!.id)}`;

  return counts.map((c) => (c.n > 1 ? `${nameOf(c.id)} x${c.n}` : nameOf(c.id))).join(" + ");
}
