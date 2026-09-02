/**
 * O cenário de dano: query string <-> estado <-> `DamageInput`.
 *
 * Mesma razão dos filtros de busca (`useFilters.ts`): o cenário vira um link
 * compartilhável, o botão voltar desfaz um passo, e — o que decide — estes
 * parâmetros são a assinatura da tool de dano no MCP da fase 4. Se o estado
 * vivesse no React, a tela e o servidor descreveriam o mesmo cenário de duas
 * formas diferentes.
 *
 *   /calc?s=100100&act=np&sk=1,2,3&ec=lancer&ea=sky
 *
 * Puro e sem React, e por isso mora em `core/`: a tela usa para montar o
 * cenário, o MCP da fase 4 vai usar para receber a mesma coisa como argumento de
 * tool, e a validação (`docs/VALIDATION.md`) usa para que cada caso conferido
 * seja literalmente um link que abre na tela.
 */

import type { BuffSource, DamageInput, RollMode } from "./damage.js";
import type { CardType, Servant, Trait } from "./model.js";

/** Um NP ou um card. `extra` é o card extra, que tem multiplicador próprio. */
export type ActionKind = "np" | "buster" | "arts" | "quick" | "extra";

export interface CalcState {
  servantId: number | null;
  /** `null` = usar o padrão do servo (nível natural máximo). */
  level: number | null;
  fou: number;
  /** `null` = padrão por raridade: NP5 para 1–3★ e welfare, NP1 para 4–5★. */
  npLevel: number | null;
  overcharge: number;
  /**
   * Qual NP, quando o servo tem mais de um (R24). `null` = o padrão.
   *
   * Cinco servos trocam o card do NP, e o multiplicador troca junto — a
   * Mélusine vai de 300% no Buster a 900% no Arts.
   */
  npId: number | null;

  /** `num` das skills próprias marcadas. Um nível só para todas — é como se pensa. */
  skills: number[];
  skillLevel: number;
  /** Append passives. Fora por padrão, e só entram se marcadas aqui. */
  appends: number[];
  appendLevel: number;

  /**
   * Craft Essence equipada. `null` = nenhuma, que é o padrão — uma CE é escolha
   * do jogador, não parte do preset.
   *
   * `ceLevel` `null` = o máximo daquela CE, resolvido no núcleo contra o
   * documento, porque o teto varia com a raridade (50 a 100).
   *
   * `ceMlb` é caixa do usuário (**D17**): `effectsBase` e `effectsMlb` são
   * conjuntos **diferentes**, não graus do mesmo, e o dado não diz qual você tem.
   * O padrão é `false` — o conjunto mais fraco, pela mesma razão de `hpPercent`
   * ser 100 e os stacks serem 0: na dúvida, não inventar bônus.
   */
  ceId: number | null;
  ceLevel: number | null;
  ceMlb: boolean;

  /**
   * Mystic Code do Master, e quais das skills dele dispararam.
   *
   * Um só para a party inteira, ao contrário da CE. `mcSkills` é 1-based, como
   * o jogador vê na tela; o núcleo recebe índice.
   */
  mcId: number | null;
  mcSkills: number[];
  mcLevel: number;

  /**
   * HP do atacante em % do máximo. 100 = ileso, e é o padrão.
   *
   * Sete servos mudam de dano com isto (R25). É razão, não valor absoluto —
   * é só disso que as duas escalas precisam, e é o que dispensa modelar `hpMax`.
   */
  hpPercent: number;

  /**
   * Quantas unidades do trait que o NP conta existem de cada lado (R27).
   *
   * Dois campos porque são contagens de entidades diferentes — 〔Heroic King〕
   * no Charlemagne, 〔roman〕 no alvo do Romulus. Só um dos dois vale por NP, e
   * **quem decide qual é o dado** (`superEffective.countsOn`), nunca a tela.
   */
  stacksSelf: number;
  stacksTarget: number;

  action: ActionKind;
  position: number;
  isCrit: boolean;
  busterChain: boolean;
  braveChain: boolean;

  enemyClass: string;
  enemyAttribute: string;
  enemyTraits: number[];
  enemyDefMod: number;
  enemySpecialDefMod: number;

  rollMode: RollMode;
}

export const DEFAULT_CALC: CalcState = {
  servantId: null,
  level: null,
  fou: 1000,
  npLevel: null,
  overcharge: 1,
  npId: null,
  skills: [],
  skillLevel: 10,
  appends: [],
  appendLevel: 10,
  ceId: null,
  ceLevel: null,
  ceMlb: false,
  mcId: null,
  mcSkills: [],
  mcLevel: 10,
  hpPercent: 100,
  stacksSelf: 0,
  stacksTarget: 0,
  action: "np",
  position: 1,
  isCrit: false,
  busterChain: false,
  braveChain: false,
  enemyClass: "saber",
  enemyAttribute: "human",
  enemyTraits: [],
  enemyDefMod: 0,
  enemySpecialDefMod: 0,
  rollMode: "avg",
};

/** Nível natural máximo do servo (D9). Grail é escolha explícita do usuário. */
export const defaultLevel = (s: Servant): number => s.lvMax;

/** NP5 para 1–3★ e welfare, NP1 para 4–5★ (D9): o que se tem de fato na conta. */
export const defaultNpLevel = (s: Servant): number => (s.rarity <= 3 || s.isWelfare ? 5 : 1);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ------------------------------------------------------- query string <-> estado

/** Chaves curtas: o link é para ser lido e colado. */
const KEYS = {
  servantId: "s",
  level: "lv",
  fou: "fou",
  npLevel: "np",
  overcharge: "oc",
  npId: "npid",
  skills: "sk",
  skillLevel: "sklv",
  appends: "ap",
  appendLevel: "aplv",
  ceId: "ce",
  ceLevel: "cel",
  ceMlb: "mlb",
  mcId: "mc",
  mcSkills: "mcs",
  mcLevel: "mclv",
  hpPercent: "hp",
  stacksSelf: "ss",
  stacksTarget: "st",
  action: "act",
  position: "pos",
  isCrit: "crit",
  busterChain: "bchain",
  braveChain: "brave",
  enemyClass: "ec",
  enemyAttribute: "ea",
  enemyTraits: "et",
  enemyDefMod: "edef",
  enemySpecialDefMod: "esdef",
  rollMode: "roll",
} as const satisfies Record<keyof CalcState, string>;

const ACTIONS: ActionKind[] = ["np", "buster", "arts", "quick", "extra"];
const ROLLS: RollMode[] = ["min", "avg", "max"];

/** O `filter(Boolean)` não é enfeite: sem ele `"".split(",")` vira `[""]` e `Number("")` vira 0. */
const nums = (p: URLSearchParams, k: string): number[] =>
  (p.get(k) ?? "").split(",").filter(Boolean).map(Number).filter(Number.isFinite);

function int(p: URLSearchParams, k: string, fallback: number): number {
  const raw = p.get(k);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/** `null` significa "não informado" e é o que faz o padrão do servo valer. */
function maybeInt(p: URLSearchParams, k: string): number | null {
  const raw = p.get(k);
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function parseCalc(p: URLSearchParams): CalcState {
  const action = ACTIONS.find((a) => a === p.get(KEYS.action)) ?? DEFAULT_CALC.action;
  const roll = ROLLS.find((r) => r === p.get(KEYS.rollMode)) ?? DEFAULT_CALC.rollMode;

  return {
    servantId: maybeInt(p, KEYS.servantId),
    level: maybeInt(p, KEYS.level),
    fou: clamp(int(p, KEYS.fou, DEFAULT_CALC.fou), 0, 2000),
    npLevel: maybeInt(p, KEYS.npLevel),
    overcharge: clamp(int(p, KEYS.overcharge, 1), 1, 5),
    npId: maybeInt(p, KEYS.npId),
    skills: nums(p, KEYS.skills),
    skillLevel: clamp(int(p, KEYS.skillLevel, 10), 1, 10),
    appends: nums(p, KEYS.appends),
    appendLevel: clamp(int(p, KEYS.appendLevel, 10), 1, 10),
    ceId: maybeInt(p, KEYS.ceId),
    ceLevel: maybeInt(p, KEYS.ceLevel),
    ceMlb: p.get(KEYS.ceMlb) === "1",
    mcId: maybeInt(p, KEYS.mcId),
    mcSkills: nums(p, KEYS.mcSkills),
    mcLevel: clamp(int(p, KEYS.mcLevel, 10), 1, 10),
    hpPercent: clamp(int(p, KEYS.hpPercent, DEFAULT_CALC.hpPercent), 0, 100),
    // O teto real é o do NP escolhido e vive no dado; aqui só se impede
    // negativo. `damage.ts` prende ao `maxCount` — a regra mora com a fórmula.
    stacksSelf: Math.max(0, int(p, KEYS.stacksSelf, 0)),
    stacksTarget: Math.max(0, int(p, KEYS.stacksTarget, 0)),
    action,
    position: clamp(int(p, KEYS.position, 1), 1, 3),
    isCrit: p.get(KEYS.isCrit) === "1",
    busterChain: p.get(KEYS.busterChain) === "1",
    braveChain: p.get(KEYS.braveChain) === "1",
    enemyClass: p.get(KEYS.enemyClass) ?? DEFAULT_CALC.enemyClass,
    enemyAttribute: p.get(KEYS.enemyAttribute) ?? DEFAULT_CALC.enemyAttribute,
    enemyTraits: nums(p, KEYS.enemyTraits),
    enemyDefMod: int(p, KEYS.enemyDefMod, 0),
    enemySpecialDefMod: int(p, KEYS.enemySpecialDefMod, 0),
    rollMode: roll,
  };
}

export function serializeCalc(s: CalcState): URLSearchParams {
  const p = new URLSearchParams();
  const put = (k: string, v: string) => { if (v) p.set(k, v); };
  const putNum = (k: string, v: number, fallback: number) => { if (v !== fallback) p.set(k, String(v)); };

  if (s.servantId !== null) p.set(KEYS.servantId, String(s.servantId));
  if (s.level !== null) p.set(KEYS.level, String(s.level));
  putNum(KEYS.fou, s.fou, DEFAULT_CALC.fou);
  if (s.npLevel !== null) p.set(KEYS.npLevel, String(s.npLevel));
  putNum(KEYS.overcharge, s.overcharge, 1);
  if (s.npId !== null) p.set(KEYS.npId, String(s.npId));
  put(KEYS.skills, s.skills.join(","));
  putNum(KEYS.skillLevel, s.skillLevel, 10);
  put(KEYS.appends, s.appends.join(","));
  putNum(KEYS.appendLevel, s.appendLevel, 10);
  if (s.ceId !== null) p.set(KEYS.ceId, String(s.ceId));
  if (s.ceLevel !== null) p.set(KEYS.ceLevel, String(s.ceLevel));
  if (s.ceMlb) p.set(KEYS.ceMlb, "1");
  if (s.mcId !== null) p.set(KEYS.mcId, String(s.mcId));
  put(KEYS.mcSkills, s.mcSkills.join(","));
  putNum(KEYS.mcLevel, s.mcLevel, 10);
  putNum(KEYS.hpPercent, s.hpPercent, DEFAULT_CALC.hpPercent);
  putNum(KEYS.stacksSelf, s.stacksSelf, 0);
  putNum(KEYS.stacksTarget, s.stacksTarget, 0);
  if (s.action !== DEFAULT_CALC.action) p.set(KEYS.action, s.action);
  putNum(KEYS.position, s.position, 1);
  if (s.isCrit) p.set(KEYS.isCrit, "1");
  if (s.busterChain) p.set(KEYS.busterChain, "1");
  if (s.braveChain) p.set(KEYS.braveChain, "1");
  if (s.enemyClass !== DEFAULT_CALC.enemyClass) p.set(KEYS.enemyClass, s.enemyClass);
  if (s.enemyAttribute !== DEFAULT_CALC.enemyAttribute) p.set(KEYS.enemyAttribute, s.enemyAttribute);
  put(KEYS.enemyTraits, s.enemyTraits.join(","));
  putNum(KEYS.enemyDefMod, s.enemyDefMod, 0);
  putNum(KEYS.enemySpecialDefMod, s.enemySpecialDefMod, 0);
  if (s.rollMode !== DEFAULT_CALC.rollMode) p.set(KEYS.rollMode, s.rollMode);

  return p;
}

// ------------------------------------------------------------ estado -> entrada

/**
 * Traduz a escolha da tela para a entrada da fórmula.
 *
 * Duas regras do jogo entram aqui, e não na fórmula, porque são sobre o que é
 * uma ação válida e não sobre como o dano é calculado:
 *
 *  - **NP não é crítico.** O jogo não permite; deixar `isCrit` passar num NP
 *    dobraria o dano em silêncio.
 *  - **Os buffs do próprio NP entram sozinhos.** Só os que rodam antes da função
 *    de dano (D20), e isso não é opcional: o Gilgamesh *sempre* leva o
 *    `upNpdamage` dele no próprio golpe. Marcar isso como checkbox sugeriria uma
 *    escolha que o jogador não tem.
 */
export function toDamageInput(
  state: CalcState,
  servant: Servant,
  traitName: (id: number) => string,
): DamageInput {
  const isNP = state.action === "np";
  const level = clamp(state.level ?? defaultLevel(servant), 1, servant.atkGrowth.length);
  const npLevel = clamp(state.npLevel ?? defaultNpLevel(servant), 1, 5) as 1 | 2 | 3 | 4 | 5;

  const buffStack: BuffSource[] = [
    ...state.skills.map((num) => ({ kind: "ownSkill" as const, skillNum: num, level: state.skillLevel })),
    ...state.appends.map((num) => ({ kind: "append" as const, num, level: state.appendLevel })),
  ];
  if (isNP) buffStack.push({ kind: "npSelfBuff" });
  // Só as skills marcadas do MC entram, e só se houver MC equipado. O `- 1`
  // traduz o que o jogador vê (1, 2, 3) para o índice do array.
  if (state.mcId !== null) {
    for (const num of state.mcSkills) buffStack.push({ kind: "mysticCodeSkill", index: num - 1 });
  }

  const traits: Trait[] = state.enemyTraits.map((id) => ({ id, name: traitName(id) }));

  return {
    attacker: {
      servantId: servant.id,
      level,
      fou: state.fou,
      npLevel,
      overcharge: clamp(state.overcharge, 1, 5) as 1 | 2 | 3 | 4 | 5,
      hpPercent: clamp(state.hpPercent, 0, 100),
      stacks: state.stacksSelf,
      ...(state.npId !== null ? { npId: state.npId } : {}),
      // `level` omitido de propósito quando o usuário não escolheu: quem sabe o
      // teto daquela CE é o documento dela, e ele vive no núcleo.
      ...(state.ceId !== null
        ? { ce: { id: state.ceId, mlb: state.ceMlb, ...(state.ceLevel !== null ? { level: state.ceLevel } : {}) } }
        : {}),
    },
    ...(state.mcId !== null ? { mysticCode: { id: state.mcId, level: clamp(state.mcLevel, 1, 10) } } : {}),
    buffStack,
    enemy: {
      className: state.enemyClass,
      attribute: state.enemyAttribute,
      traits,
      defMod: state.enemyDefMod,
      specialDefMod: state.enemySpecialDefMod,
      stacks: state.stacksTarget,
    },
    action: {
      kind: isNP ? "np" : state.action === "extra" ? "extra" : "card",
      card: isNP ? undefined : (state.action as CardType),
      position: clamp(state.position, 1, 3) as 1 | 2 | 3,
      isCrit: isNP ? false : state.isCrit,
      busterChain: state.busterChain,
      braveChain: state.braveChain,
    },
    options: { rollMode: state.rollMode },
  };
}
