/**
 * Imprime a tabela de conferência da calculadora (R4).
 *
 * Para cada caso de `data/validation.json`, mostra o cenário, o link que o
 * reproduz na tela e o número que **nós** calculamos. Quem confere pega o mesmo
 * cenário na fonte externa e compara.
 *
 *   npm run damage:cases
 *
 * O nosso número aparece de propósito: sem ele não dá para saber se a diferença
 * é de 3% ou de 3×, e 3% costuma ser arredondamento enquanto 3× é bug. O que
 * **não** se faz é copiar o nosso número para `expected` — ver docs/VALIDATION.md.
 */

import { readFileSync } from "node:fs";

import { calculateDamage, type DamageData } from "../core/damage.js";
import type { Constants, IndexEntry, IndexEntryServant, Servant } from "../core/model.js";
import { parseCalc, toDamageInput } from "../core/scenario.js";

export interface ValidationCase {
  id: string;
  why: string;
  scenario: string;
  /** Query string de `/calc` — o caso é literalmente um link. */
  calc: string;
  source: "calc" | "game";
  /** De onde veio o número, quando já conferido. */
  sourceName?: string;
  mode: "avg" | "roll";
  expected: number | null;
}

export interface ValidationFile {
  preset: string;
  cases: ValidationCase[];
}

const OUT = "public/data";

export function loadCases(): ValidationFile {
  return JSON.parse(readFileSync("data/validation.json", "utf8")) as ValidationFile;
}

/** Tudo o que um caso precisa para virar número. */
export function harness() {
  const index = JSON.parse(readFileSync(`${OUT}/index.json`, "utf8")) as IndexEntry[];
  const constants = JSON.parse(readFileSync(`${OUT}/constants.json`, "utf8")) as Constants;
  const traits = JSON.parse(readFileSync(`${OUT}/traits.json`, "utf8")) as { id: number; name: string }[];
  const servants = index.filter((e): e is IndexEntryServant => e.kind === "servant");

  const traitName = (id: number) => traits.find((t) => t.id === id)?.name ?? `trait ${id}`;

  const run = (c: ValidationCase) => {
    const state = parseCalc(new URLSearchParams(c.calc));
    if (state.servantId === null) throw new Error(`${c.id}: sem servo no link`);
    const entry = servants.find((s) => s.id === state.servantId);
    if (!entry) throw new Error(`${c.id}: servo ${state.servantId} não existe no índice`);

    const servant = JSON.parse(readFileSync(`${OUT}/servant/${entry.id}.json`, "utf8")) as Servant;
    const data: DamageData = {
      servants: new Map([[servant.id, servant]]),
      equips: new Map(),
      mysticCodes: new Map(),
      constants,
    };
    return { servant, result: calculateDamage(toDamageInput(state, servant, traitName), data) };
  };

  return { run, traitName };
}

function main(): void {
  const { preset, cases } = loadCases();
  const { run } = harness();

  console.log(`\n${preset}\n`);
  console.log("Cada caso muda UM termo em relação ao anterior. Ver docs/VALIDATION.md.\n");

  let filled = 0;
  for (const c of cases) {
    const { servant, result } = run(c);
    const b = result.breakdown;
    const mark = c.expected === null ? " " : "✓";
    if (c.expected !== null) filled++;

    console.log(`${mark} ${c.id}`);
    console.log(`    ${c.scenario}`);
    console.log(`    prende:   ${c.why}`);
    console.log(`    /calc?${c.calc}`);
    console.log(
      `    nosso:    ${result.avg.toLocaleString("en-US")}` +
        `  (min ${result.min.toLocaleString("en-US")} · max ${result.max.toLocaleString("en-US")})`,
    );
    console.log(
      `    termos:   atk ${b.servantAtk} · npMult x${b.npDamageMultiplier} · card x${b.cardTerm.toFixed(2)}` +
        ` · classe x${b.classAtkBonus} · triangulo x${b.triangleModifier} · attr x${b.attributeModifier}` +
        (b.criticalModifier !== 1 ? ` · crit x${b.criticalModifier}` : "") +
        (b.extraCardModifier !== 1 ? ` · extra x${b.extraCardModifier}` : "") +
        (b.superEffectiveModifier !== 100 ? ` · SE ${b.superEffectiveModifier}%` : "") +
        (b.flatDamage !== 0 ? ` · plano +${b.flatDamage}` : "") +
        (b.busterChainBonus !== 0 ? ` · chain +${Math.round(b.busterChainBonus)}` : ""),
    );
    const counted = result.assumptions.appliedBuffs.filter((x) => x.counted);
    if (counted.length > 0) {
      console.log(`    buffs:    ${counted.map((x) => `${x.buffType} ${x.value}`).join(" · ")}`);
    }
    console.log(
      `    fonte:    ${c.source === "calc" ? "calculadora da comunidade" : "número visto no jogo"}` +
        `  ·  esperado: ${c.expected === null ? "— a preencher" : `${c.expected.toLocaleString("en-US")} (${c.sourceName ?? "?"})`}`,
    );
    // O servo é impresso para conferir que o link aponta para quem se pensa.
    console.log(`    servo:    ${servant.name} (${servant.className}, ${servant.attribute}, lv${servant.lvMax})\n`);
  }

  console.log(`R4: ${filled} de ${cases.length} casos conferidos.`);
  if (filled < cases.length) {
    console.log("Preencha `expected` em data/validation.json e rode `npm test` — cada caso vira teste permanente.");
  }
}

// Só executa quando chamado direto; o teste importa `harness`/`loadCases`.
if (process.argv[1]?.endsWith("cases.ts")) main();
