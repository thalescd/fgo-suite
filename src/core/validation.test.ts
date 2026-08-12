/**
 * Conferência contra fonte externa (R4).
 *
 * O resto de `damage.test.ts` prova que a implementação corresponde a
 * `damage_formula.txt`. **Isto** é o único lugar que confere contra um número
 * que não saiu daqui.
 *
 * Casos em `data/validation.json`. Enquanto `expected` for `null`, o caso é
 * contado como pendente e não afirma nada — o que importa é que essa pendência
 * apareça, em vez de a suíte ficar verde dando a impressão de cobertura.
 *
 * Ver docs/VALIDATION.md.
 */

import { describe, expect, it } from "vitest";

import { harness, loadCases } from "../ingest/cases.js";

const { cases } = loadCases();
const { run } = harness();

describe("casos de conferência (R4)", () => {
  it("todo caso do arquivo é calculável", () => {
    // Pega link com id de servo errado, `npid` que não existe, query mal
    // formada. Um caso que nem roda nunca vai ser conferido.
    for (const c of cases) {
      expect(() => run(c), c.id).not.toThrow();
      expect(run(c).result.avg, c.id).toBeGreaterThan(0);
    }
  });

  it("nenhum caso está sem propósito declarado", () => {
    // `why` é o que diz qual termo o caso prende. Sem isso a lista vira um
    // amontoado de cenários e ninguém sabe o que ainda falta cobrir.
    for (const c of cases) {
      expect(c.why.length, c.id).toBeGreaterThan(20);
      expect(c.scenario.length, c.id).toBeGreaterThan(10);
    }
  });

  const filled = cases.filter((c) => c.expected !== null);

  it.runIf(filled.length > 0)("os casos já conferidos continuam batendo", () => {
    const off: string[] = [];
    for (const c of filled) {
      const { result } = run(c);
      const exp = c.expected!;

      if (c.mode === "roll") {
        // Valor visto no jogo: só dá para exigir que caia na faixa do random
        // modifier. É uma janela de 22%, fraca — por isso `avg` é preferível.
        if (exp < result.min || exp > result.max) {
          off.push(`${c.id}: ${exp} fora de ${result.min}..${result.max}`);
        }
      } else {
        // Valor determinístico: 0,5% de folga cobre arredondamento de quem
        // publicou o número, e nada além disso.
        const drift = Math.abs(result.avg - exp) / exp;
        if (drift > 0.005) {
          off.push(`${c.id}: nosso ${result.avg} vs esperado ${exp} (${(drift * 100).toFixed(1)}% de diferença)`);
        }
      }
    }
    expect(off).toEqual([]);
  });

  it("R4 continua aberto até todos os casos serem conferidos", () => {
    // Este teste FALHA quando tudo estiver preenchido, e é de propósito: é o
    // lembrete para fechar o risco no PLANO em vez de deixá-lo aberto para
    // sempre. Quando falhar, some com ele e marque R4 como resolvido.
    expect(filled.length).toBeLessThan(cases.length);
  });
});
