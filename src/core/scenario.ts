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

import { NEUTRAL } from "./damage.js";
import type { BuffSource, DamageInput, RollMode } from "./damage.js";
import type { CardType, Servant, Trait } from "./model.js";

/** Um NP ou um card. `extra` é o card extra, que tem multiplicador próprio. */
export type ActionKind = "np" | "buster" | "arts" | "quick" | "extra";

/**
 * Uma fonte de buff externa, **por referência**.
 *
 * Guarda quem e quais skills, nunca os valores resolvidos (D13). Um template
 * com `atkMod: 50` apodrece calado quando o jogo rebalanceia a Castoria; um que
 * diz "Castoria, skills 1 e 2" se atualiza no próximo `data:sync`. E é a
 * referência que preserva as duas coisas que um número solto perde: a condição
 * de card do buff (31% têm uma) e os traits dele, que é como o `buffRate` do
 * Oberon acha o que multiplicar.
 */
export interface ExternalBuff {
  servantId: number;
  /** `num` das skills usadas. Vazio é válido: pode ser só o NP, ou só a CE. */
  skills: number[];
  skillLevel: number;
  /**
   * O buff de **alvo único** apontou para quem ataca? Buff de party não
   * pergunta. Padrão `true`: quem acrescenta um suporte o faz para buffar o
   * atacante, e o contrário faria 78 servos entregarem menos sem dizer por quê.
   */
  targetsAttacker: boolean;
  /** O NP do suporte, se foi usado. Nível e overcharge são dele, não do atacante. */
  np: { level: number; overcharge: number } | null;
  /** CE do suporte — efeitos só; a ATK dela é do suporte. Sem nível, por isso. */
  ce: { id: number; mlb: boolean } | null;
}

/**
 * Um alvo salvo: a parte do cenário que descreve o inimigo (5e).
 *
 * **Por valor, e isso é forçado.** O template de buff é por *referência*
 * (`504500:1,3`), e é o que o faz sobreviver a rebalanceamento (D13). O alvo não
 * tem para onde apontar — não existe documento de inimigo —, então guarda os
 * valores. A exceção está anotada no próprio D13.
 *
 * `stacksTarget` fica **de fora**: quantos 〔roman〕 o inimigo acumulou depende de
 * quantas vezes o *atacante* usou o NP (R27). É do combate, não do alvo.
 */
export interface EnemyPreset {
  className: string;
  attribute: string;
  /** Ids, nunca nomes: o nome muda entre dumps, o id não (R10). */
  traits: number[];
  defMod: number;
  specialDefMod: number;
}

export const enemyOf = (s: CalcState): EnemyPreset => ({
  className: s.enemyClass,
  attribute: s.enemyAttribute,
  traits: s.enemyTraits,
  defMod: s.enemyDefMod,
  specialDefMod: s.enemySpecialDefMod,
});

/** Os campos que um alvo aplica sobre o cenário. O resto não se toca. */
export const enemyPatch = (e: EnemyPreset): Partial<CalcState> => ({
  enemyClass: e.className,
  enemyAttribute: e.attribute,
  enemyTraits: e.traits,
  enemyDefMod: e.defMod,
  enemySpecialDefMod: e.specialDefMod,
});

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
   * Buffs externos: outros servos contribuindo para este ataque.
   *
   * Lista, não party — sem posição, sem limite de três, e repetição permitida.
   * Order Change deixa mais de dois buffarem o mesmo ataque num turno, e duas
   * cópias do mesmo suporte somam.
   */
  externals: ExternalBuff[];

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
  /**
   * A primeira carta da chain foi Buster (R32).
   *
   * É do turno, não desta carta: quando a chain abre em Buster, as três ganham
   * `firstCardBonus`. Fica separado da posição porque uma Arts em 2ª posição
   * numa chain aberta em Buster ganha o bônus, e nada na carta diz isso.
   */
  busterFirst: boolean;
  /**
   * Mighty Chain: as três cartas de tipos diferentes, em qualquer ordem (R34).
   *
   * Vale o bônus de abertura dos três tipos em todas as cartas, então o
   * `firstCardBonus` do Buster entra mesmo numa chain que começou em Quick.
   */
  mightyChain: boolean;
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
  externals: [],
  hpPercent: 100,
  stacksSelf: 0,
  stacksTarget: 0,
  action: "np",
  position: 1,
  isCrit: false,
  busterFirst: false,
  mightyChain: false,
  busterChain: false,
  braveChain: false,
  // Alvo sem classe e sem atributo, não o primeiro da lista.
  //
  // `saber`/`human` era padrão só por ser o começo da lista, e torcia o número
  // de graça: contra Saber, um Archer ganha 1,5x e um Lancer perde metade, sem
  // ninguém ter pedido. Quem não mexe no bloco Enemy não está pedindo vantagem
  // — está dizendo que o cenário não fixou o alvo.
  //
  // `NEUTRAL` diz exatamente isso, e por isso não é `shielder`: chamar o
  // inimigo de Shielder é uma afirmação sobre ele, e traz o trait
  // `classShielder` junto, que 4 efeitos do roster procuram.
  enemyClass: NEUTRAL,
  enemyAttribute: NEUTRAL,
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
  externals: "sup",
  hpPercent: "hp",
  stacksSelf: "ss",
  stacksTarget: "st",
  action: "act",
  position: "pos",
  isCrit: "crit",
  busterFirst: "bfirst",
  mightyChain: "mchain",
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

/**
 * Uma fonte externa numa string. `servoId:skills` é posicional porque sempre
 * existe; o resto é `chave=valor` separado por `;`.
 *
 *   504500:1,2,3
 *   504500:1,3;np=5;oc=3
 *   504500:1;lv=6;ce=9400480;mlb;t0
 *
 * Chave **repetida** em vez de índice (`sup1`, `sup2`): a lista é editada, e com
 * índice remover o do meio exige renumerar — inclusive as sub-chaves. Uma
 * sub-chave órfã grudaria a CE de um suporte removido em outro, calada. Aqui os
 * campos de uma fonte viajam dentro do mesmo valor e não têm como se separar.
 *
 * Exportado porque os templates salvos no navegador guardam exatamente esta
 * string. Um template é um pedaço de link, e passa pelo mesmo parser — não há
 * um segundo formato para o mesmo dado envelhecer sozinho.
 */
export function parseExternalBuff(raw: string): ExternalBuff | null {
  const [head, ...flags] = raw.split(";");
  const [idPart, skillPart = ""] = (head ?? "").split(":");
  const servantId = Number(idPart);
  if (!Number.isFinite(servantId) || servantId <= 0) return null;

  const field = (name: string): string | undefined =>
    flags.find((f) => f.startsWith(`${name}=`))?.slice(name.length + 1);
  const has = (name: string) => flags.includes(name);

  const npLevel = Number(field("np"));
  const ceId = Number(field("ce"));
  const skillLevel = Number(field("lv"));
  const oc = Number(field("oc"));

  return {
    servantId,
    skills: skillPart.split(",").filter(Boolean).map(Number).filter(Number.isFinite),
    skillLevel: Number.isFinite(skillLevel) ? clamp(skillLevel, 1, 10) : 10,
    // `t0` desliga; ausência significa ligado. Ver o comentário do campo.
    targetsAttacker: !has("t0"),
    np: Number.isFinite(npLevel)
      ? { level: clamp(npLevel, 1, 5), overcharge: Number.isFinite(oc) ? clamp(oc, 1, 5) : 1 }
      : null,
    ce: Number.isFinite(ceId) && ceId > 0 ? { id: ceId, mlb: has("mlb") } : null,
  };
}

export function serializeExternalBuff(e: ExternalBuff): string {
  const out = [`${e.servantId}:${e.skills.join(",")}`];
  if (e.skillLevel !== 10) out.push(`lv=${e.skillLevel}`);
  if (e.np) {
    out.push(`np=${e.np.level}`);
    if (e.np.overcharge !== 1) out.push(`oc=${e.np.overcharge}`);
  }
  if (e.ce) {
    out.push(`ce=${e.ce.id}`);
    if (e.ce.mlb) out.push("mlb");
  }
  if (!e.targetsAttacker) out.push("t0");
  return out.join(";");
}

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
    // `getAll`: chave repetida é a forma nativa de lista aqui.
    externals: p.getAll(KEYS.externals).map(parseExternalBuff).filter((x): x is ExternalBuff => x !== null),
    hpPercent: clamp(int(p, KEYS.hpPercent, DEFAULT_CALC.hpPercent), 0, 100),
    // O teto real é o do NP escolhido e vive no dado; aqui só se impede
    // negativo. `damage.ts` prende ao `maxCount` — a regra mora com a fórmula.
    stacksSelf: Math.max(0, int(p, KEYS.stacksSelf, 0)),
    stacksTarget: Math.max(0, int(p, KEYS.stacksTarget, 0)),
    action,
    position: clamp(int(p, KEYS.position, 1), 1, 3),
    isCrit: p.get(KEYS.isCrit) === "1",
    busterFirst: p.get(KEYS.busterFirst) === "1",
    mightyChain: p.get(KEYS.mightyChain) === "1",
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
  for (const e of s.externals) p.append(KEYS.externals, serializeExternalBuff(e));
  putNum(KEYS.hpPercent, s.hpPercent, DEFAULT_CALC.hpPercent);
  putNum(KEYS.stacksSelf, s.stacksSelf, 0);
  putNum(KEYS.stacksTarget, s.stacksTarget, 0);
  if (s.action !== DEFAULT_CALC.action) p.set(KEYS.action, s.action);
  putNum(KEYS.position, s.position, 1);
  if (s.isCrit) p.set(KEYS.isCrit, "1");
  if (s.busterFirst) p.set(KEYS.busterFirst, "1");
  if (s.mightyChain) p.set(KEYS.mightyChain, "1");
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

/**
 * Um alvo salvo é um **pedaço de link**, pela mesma razão do template de buff
 * (§5.2): um formato só para o mesmo dado, e o clamp vem de graça do parser.
 *
 *   ec=lancer&ea=sky&et=2000,2002&edef=20
 */
export function serializeEnemyPreset(e: EnemyPreset): string {
  const p = serializeCalc({ ...DEFAULT_CALC, ...enemyPatch(e) });
  const out = new URLSearchParams();
  for (const k of ENEMY_KEYS) {
    const v = p.get(k);
    if (v !== null) out.set(k, v);
  }
  return out.toString();
}

const ENEMY_KEYS = [
  KEYS.enemyClass,
  KEYS.enemyAttribute,
  KEYS.enemyTraits,
  KEYS.enemyDefMod,
  KEYS.enemySpecialDefMod,
] as const;

/**
 * `null` quando a string não traz **nenhuma** chave de inimigo.
 *
 * Sem essa checagem, lixo viraria "alvo neutro" em silêncio — a direção segura
 * do erro, mas ainda um erro calado. Um alvo salvo que perdeu o conteúdo é
 * melhor descartado, como o template de buff que não parseia inteiro.
 */
export function parseEnemyPreset(raw: string): EnemyPreset | null {
  const p = new URLSearchParams(raw);
  if (!ENEMY_KEYS.some((k) => p.has(k))) return null;
  return enemyOf(parseCalc(p));
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
  // Uma entrada por fonte externa, na ordem em que aparecem. Repetição é
  // legítima: duas cópias do mesmo suporte somam.
  for (const e of state.externals) {
    buffStack.push({
      kind: "support",
      servantId: e.servantId,
      skills: e.skills,
      skillLevel: clamp(e.skillLevel, 1, 10),
      targetsAttacker: e.targetsAttacker,
      ...(e.np ? { np: { level: clamp(e.np.level, 1, 5), overcharge: clamp(e.np.overcharge, 1, 5) } } : {}),
      ...(e.ce ? { ce: e.ce } : {}),
    });
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
      // Num NP a pergunta não existe: NP não ganha `firstCardBonus`.
      busterFirst: isNP ? false : state.busterFirst,
      mightyChain: isNP ? false : state.mightyChain,
      busterChain: state.busterChain,
      braveChain: state.braveChain,
    },
    options: { rollMode: state.rollMode },
  };
}
