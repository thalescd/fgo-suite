/**
 * Censo do roster: as contagens que crescem a cada patch do jogo.
 *
 * `data:validate` tem dois tipos de conferência, e misturá-los era o que fazia
 * todo sync quebrar:
 *
 *   - **Fatos do jogo** (Excalibur NP1 = 400%, Artoria tem 120 entradas de ATK).
 *     Não mudam quando sai servo novo; exigem valor exato, sempre.
 *   - **Tamanho do roster** (quantos servos, quantos NPs escalam com OC...).
 *     Crescem a cada patch, e isso é normal. Mas uma contagem que *diminui* é o
 *     sintoma clássico de o Atlas ter mudado de formato: um campo renomeado zera
 *     o que dependia dele. É isso que o censo vigia.
 *
 * As contagens ficam em `data/census.json`, versionado, junto com o hash do
 * gamedata em que foram medidas. As regras:
 *
 *   - gamedata novo, contagem igual ou maior  -> novidade do patch; passa e o
 *     censo é regravado (o diff do arquivo no commit mostra o que mudou).
 *   - gamedata novo, contagem menor           -> regressão; falha.
 *   - mesmo gamedata, qualquer diferença      -> regressão; falha. O dado não
 *     mudou, então quem mudou foi o build.
 *
 * Mudança legítima que a regra recusa (o código passou a contar diferente de
 * propósito, ou o Atlas de fato removeu algo) se aceita com
 * `npm run data:validate -- --accept`.
 */

export type CensusValue = number | string[];

export interface CensusFile {
  _: string;
  gameDataHash: string;
  measuredAt: string;
  counts: Record<string, CensusValue>;
}

export interface CensusEntry {
  key: string;
  label: string;
  value: CensusValue;
  /** Dito quando a contagem cresce: o que conferir na novidade. */
  onGrowth?: string;
}

export interface CensusDiff {
  /** Cresceu num gamedata novo — esperado. */
  growth: string[];
  /** Diminuiu, ou mudou sem o gamedata mudar. */
  regressions: string[];
  /** Algo para olhar com calma, mesmo sem falhar. */
  notes: string[];
}

const fmt = (v: CensusValue): string => (Array.isArray(v) ? `[${v.join(", ")}]` : String(v));

/** Multiconjunto: `a` menos `b`, respeitando repetições. */
function minus(a: string[], b: string[]): string[] {
  const left = [...b];
  return a.filter((x) => {
    const i = left.indexOf(x);
    if (i === -1) return true;
    left.splice(i, 1);
    return false;
  });
}

export function compareCensus(prev: CensusFile | null, entries: CensusEntry[], gameDataHash: string): CensusDiff {
  const diff: CensusDiff = { growth: [], regressions: [], notes: [] };
  if (!prev) {
    diff.notes.push("primeiro censo — nada para comparar");
    return diff;
  }
  const sameData = prev.gameDataHash === gameDataHash;

  for (const e of entries) {
    const before = prev.counts[e.key];
    if (before === undefined) {
      diff.notes.push(`${e.label}: entrou no censo (${fmt(e.value)})`);
      continue;
    }
    if (JSON.stringify(before) === JSON.stringify(e.value)) continue;

    if (Array.isArray(before) !== Array.isArray(e.value)) {
      diff.regressions.push(`${e.label}: mudou de tipo (${fmt(before)} -> ${fmt(e.value)})`);
      continue;
    }

    if (sameData) {
      diff.regressions.push(
        `${e.label}: ${fmt(before)} -> ${fmt(e.value)} com o MESMO gamedata (${gameDataHash}) — o build mudou, não o dado`,
      );
      continue;
    }

    let line: string;
    let shrank: boolean;
    if (Array.isArray(before) && Array.isArray(e.value)) {
      const added = minus(e.value, before);
      const removed = minus(before, e.value);
      shrank = removed.length > 0;
      line = `${e.label}: ${[...added.map((x) => `+ ${x}`), ...removed.map((x) => `- ${x}`)].join(", ")}`;
    } else {
      const a = before as number;
      const b = e.value as number;
      shrank = b < a;
      line = `${e.label}: ${a} -> ${b} (${b > a ? "+" : ""}${b - a})`;
    }
    if (shrank) diff.regressions.push(line);
    else diff.growth.push(e.onGrowth ? `${line}\n      ⚠ ${e.onGrowth}` : line);
  }

  for (const key of Object.keys(prev.counts)) {
    if (!entries.some((e) => e.key === key)) diff.notes.push(`${key}: saiu do censo`);
  }
  return diff;
}

export function toCensusFile(entries: CensusEntry[], gameDataHash: string, measuredAt: string): CensusFile {
  return {
    _: "Gerado por `npm run data:validate`. Não edite à mão. Ver docs/DATA.md §2.",
    gameDataHash,
    measuredAt,
    counts: Object.fromEntries(entries.map((e) => [e.key, e.value])),
  };
}
