/**
 * Modelo canônico. Este é o contrato entre `ingest/` e todo o resto.
 *
 * Nenhuma camada acima de `ingest/` deve conhecer o formato do Atlas Academy.
 * Especificação completa e justificativas: docs/SCHEMA.md
 */

// ---------------------------------------------------------------- primitivos

export type CardType = "arts" | "buster" | "quick" | "extra";

export type Attribute = "human" | "sky" | "earth" | "star" | "beast";

/** Não é um enum fechado: NiceClassRelation traz 75 chaves, incluindo as variantes Beast. */
export type ClassName = string;

export interface Trait {
  id: number;
  /** Pode ser "unknown" — o Atlas não traduz todos os ids. Nunca usar como chave (R10). */
  name: string;
}

/**
 * Unidade de `Effect.values`. O Atlas usa divisores diferentes conforme o funcType
 * e não marca isso no dado; ver docs/SCHEMA.md §2.
 *
 * `unknown` significa que o funcType não está na tabela de conversão: os valores
 * ficam **crus**. Preferimos expor a ignorância a converter errado em silêncio.
 */
export type ValueUnit = "percent" | "flat" | "unknown";

// ------------------------------------------------------------------- efeitos

/**
 * Registro central de efeito. Compartilhado por servo, Craft Essence e Mystic Code;
 * é a estrutura que a calculadora lê e da qual as capabilities são derivadas.
 */
export interface Effect {
  funcType: string;
  target: string;
  /** null quando a função não usa buff (gainNp, damageNp, gainStar...). */
  buffType: string | null;

  /**
   * Um valor por nível: 10 (skill), 5 (NP level), 1 (CE).
   * Em NPs isto é a linha de **overcharge 1** — o caso normal de uso.
   * Já convertido conforme `valueUnit`.
   */
  values: number[];
  /**
   * Só em NPs, e só quando o efeito realmente escala: 5 linhas (OC1..OC5),
   * cada uma com um valor por nível de NP. A linha `[0]` é idêntica a `values`.
   *
   * `null` quando o valor não muda com overcharge (75,7% das funções de NP).
   *
   * **Não é opcional para a calculadora.** 24,3% das funções de NP variam com
   * overcharge, e as que mais variam são justamente slots da fórmula de dano
   * (`upCommandall`, `upNpdamage`, `downDefence`, `upAtk`). Ignorar isto dá
   * número errado em qualquer cenário com OC acima de 1 — sem sintoma.
   */
  valuesByOvercharge: number[][] | null;
  valueUnit: ValueUnit;

  /** Duração em turnos. -1 = permanente. null = não aplicável. */
  turns: number | null;
  /** Número de usos. -1 = ilimitado. null = não aplicável. */
  count: number | null;
  /** Chance de ativação em %. >= 100 sempre ativa. Informativo, nunca filtro (SCHEMA §4.5). */
  chance: number;

  // Condições. Obrigatórias: sem elas o cálculo erra em silêncio (R11).
  /** ckSelfIndv — restrição do lado do atacante, ex. [cardBuster]. */
  condSelf: Trait[];
  /** ckOpIndv — restrição do lado do alvo, ex. [human]. */
  condTarget: Trait[];
  /** functvals — condições adicionais da função. */
  condFunc: Trait[];

  /**
   * Bônus super-efetivo ("special attack"): dano extra contra alvos que têm
   * certos traits. Só existe em funções `damageNp*`. `null` quando não há.
   *
   * Exemplo: Enuma Elish do Gilgamesh causa 150% de dano contra
   * `weakToEnumaElish` no overcharge 1, subindo até 200% no overcharge 5.
   *
   * Na fórmula entra como `superEffectiveModifier`, e o valor aqui é
   * percentual — 150 significa multiplicador 1,5×.
   */
  superEffective: SuperEffective | null;

  /**
   * Traits do **próprio buff** (`buff.vals`), não do portador.
   *
   * Marcam o buff como alvo de outros efeitos: todo `upNpdamage` carrega
   * `buffNpDamageUp`, todo buff positivo carrega `buffPositiveEffect`. É o que
   * permite a um efeito dizer "multiplique os buffs de dano de NP" sem citar
   * `upNpdamage` pelo nome.
   */
  buffTraits: Trait[];

  /**
   * Só em `buffRate`: os traits de buff cujo **valor** este efeito multiplica
   * (`buff.script.UpBuffRateBuffIndiv`). `null` quando o efeito não é um boost.
   *
   * A skill 3 do Oberon é o único caso no jogo hoje: `buffNpDamageUp` a 100%,
   * ou seja, um `upNpdamage` de 20% conta como 40%. Não está em
   * `damage_formula.txt` porque o post é anterior ao Oberon (R21).
   */
  boostsBuffTraits: Trait[] | null;

  /** false => a calculadora reporta em `assumptions.unmodeled` em vez de ignorar (R12). */
  supported: boolean;
}

/**
 * Dano extra contra alvos com determinados traits.
 *
 * Mesma forma de `values`/`valuesByOvercharge` do efeito: percentual por nível
 * de NP, com a matriz de overcharge quando escala — o que acontece em 52% dos
 * casos, bem mais que nos efeitos comuns.
 */
export interface SuperEffective {
  /** Traits do alvo que ativam o bônus. */
  traits: Trait[];
  /** Multiplicador em %, por nível de NP. 150 = 1,5×. Linha de overcharge 1. */
  values: number[];
  /** 5 linhas OC1..OC5. `null` quando não varia com overcharge. */
  valuesByOvercharge: number[][] | null;
}

export interface Skill {
  id: number;
  /** 1 | 2 | 3 nos servos; 0 nos Mystic Codes (a ordem é a posição no array). */
  num: number;
  name: string;
  detail: string;
  /** 10 entradas (skill lv 1..10). Vazio quando o Atlas não informa. */
  cooldown: number[];
  effects: Effect[];
  priority: number;
  /** 0 = disponível desde sempre; > 0 = desbloqueada por quest. */
  condQuestId: number;
  /** Rank ups substituídos por esta versão (§5.2). */
  previousVersions?: Skill[];
}

export interface NoblePhantasm {
  id: number;
  name: string;
  rank: string;
  type: string;
  card: CardType;
  target: "st" | "aoe" | "support";
  /** npDistribution: distribuição percentual do dano por hit. */
  hits: number[];
  /** 5 entradas (NP1..NP5) em %. null quando o NP não causa dano. */
  damageMultiplier: number[] | null;
  /**
   * **Em ordem de execução.** Não é detalhe: o que vem antes da função de dano
   * é aplicado ao próprio dano deste NP; o que vem depois, não.
   *
   * Gilgamesh ganha `upNpdamage` no índice 0 e causa dano no índice 1 — o buff
   * está embutido no NP dele. Artoria causa dano no índice 0 e só depois ganha
   * NP, que portanto não entra no cálculo daquele golpe.
   *
   * 238 dos 413 NPs de dano (58%) têm ao menos um efeito antes do dano.
   */
  effects: Effect[];
  /**
   * Índice da função de dano dentro de `effects`, ou `null` se o NP não causa
   * dano. Existe para o consumidor separar "antes" de "depois" sem reimplementar
   * a regra de reconhecer `damageNp*`.
   */
  damageEffectIndex: number | null;
  priority: number;
  condQuestId: number;
}

// ------------------------------------------------------------------ entidades

export interface Servant {
  id: number;
  /** Exibição e URL. Pode ser 0 e não é único — nunca usar como chave (R9). */
  collectionNo: number;
  name: string;
  originalName: string;
  /** Desambiguado: "Altria Pendragon (saber, 5★)". Ver §5.3. */
  displayName: string;
  aliases: string[];

  className: ClassName;
  attribute: Attribute;
  rarity: number;
  cost: number;
  traits: Trait[];
  /** flag === "ignoreCombineLimitSpecial" (§5.6). */
  isWelfare: boolean;

  /** Nível natural máximo: 0★=65 1★=60 2★=65 3★=70 4★=80 5★=90. */
  lvMax: number;
  /**
   * ATK em lv N = atkGrowth[N-1]. 120 entradas (cobre grail até lv120).
   * `atkMax` do Atlas é deliberadamente descartado: é o ATK em lvMax, não o real (R7).
   */
  atkGrowth: number[];
  hpGrowth: number[];
  starGen: number;
  instantDeathChance: number;

  cards: CardType[];
  hitsDistribution: Partial<Record<CardType, number[]>>;

  skills: Skill[];
  classPassive: Skill[];
  appendPassive: Skill[];
  np: NoblePhantasm | null;
  npAlternatives: NoblePhantasm[];

  /**
   * Se preenchido, este servo é uma **forma de combate**: existe apenas depois
   * de o servo base se transformar em batalha (Hyde após o NP do Jekyll, a
   * segunda Aoko, Flora, Prelati). O valor é o `id` do servo base.
   *
   * Formas de combate não entram no índice de busca — apareceriam como uma
   * segunda entrada do mesmo personagem. O documento completo continua existindo
   * e é alcançável pela página do base, porque os status delas são reais e a
   * calculadora vai precisar deles.
   */
  combatFormOf: number | null;
  /** Ids das formas de combate deste servo (o inverso de `combatFormOf`). */
  combatForms: number[];

  /** Preenchido na fase 2. Vazio na fase 0. */
  capabilities: string[];

  assets: { face: string | null; charaGraph: string[] };
}

export interface CraftEssence {
  id: number;
  collectionNo: number;
  name: string;
  originalName: string;
  rarity: number;
  cost: number;
  /** 1★=50 2★=55 3★=60 4★=80 5★=100 (com algumas exceções de evento). */
  lvMax: number;
  atkGrowth: number[];
  hpGrowth: number[];

  /** Inertes são descartadas na ingestão (D6/§5.7). */
  category: "combat" | "farm";
  /** flag original do Atlas: "normal", "svtEquipEvent", ... */
  origin: string;

  /** condLimitCount === 0 */
  effectsBase: Effect[];
  /** condLimitCount === 4 (max limit break) — R13 */
  effectsMlb: Effect[];

  capabilities: string[];
  assets: { face: string | null; charaGraph: string | null };
}

export interface MysticCode {
  id: number;
  name: string;
  shortName: string;
  detail: string;
  maxLv: number;
  skills: Skill[];
  capabilities: string[];
  assets: { male: string | null; female: string | null };
}

// ----------------------------------------------------------------- constantes

export interface Constants {
  /** NiceConstant.ATTACK_RATE / 1000 = 0.23 */
  attackRate: number;
  criticalAttackRate: number;
  extraAttackRateSingle: number;
  extraAttackRateGrand: number;
  randomMin: number;
  randomMax: number;
  busterChainMod: number;

  /** classAttackRate[className] — já dividido por 1000. */
  classAttackRate: Record<string, number>;
  /** classRelation[atacante][defensor] — já dividido por 1000. */
  classRelation: Record<string, Record<string, number>>;
  /** attributeRelation[atacante][defensor] — já dividido por 1000. */
  attributeRelation: Record<Attribute, Record<Attribute, number>>;
  /** cardMultiplier[card][posição 1..3] = { adjustAtk, addAtk } já divididos por 1000. */
  cardMultiplier: Record<CardType, Record<number, { adjustAtk: number; addAtk: number }>>;
}

// -------------------------------------------------------------------- índice

/** Uma entrada por servo/CE no index.json. Só o que é filtrável ou ordenável (§4.3 do PLANO). */
export interface IndexEntryServant {
  kind: "servant";
  id: number;
  collectionNo: number;
  name: string;
  displayName: string;
  aliases: string[];
  face: string | null;
  className: ClassName;
  attribute: Attribute;
  rarity: number;
  isWelfare: boolean;
  npTarget: "st" | "aoe" | "support" | null;
  npCard: CardType | null;
  traitIds: number[];
  capabilities: string[];
  /** ATK no preset padrão (lvMax + 1000 fou). Escalar, para ordenação. */
  atkAtDefault: number;
  hpAtDefault: number;
}

export interface IndexEntryEquip {
  kind: "equip";
  id: number;
  collectionNo: number;
  name: string;
  face: string | null;
  rarity: number;
  cost: number;
  category: "combat" | "farm";
  origin: string;
  capabilities: string[];
  atkAtDefault: number;
  hpAtDefault: number;
}

export type IndexEntry = IndexEntryServant | IndexEntryEquip;

export interface Meta {
  schemaVersion: string;
  gameDataHash: string;
  gameDataTimestamp: number;
  region: string;
  syncedAt: string;
  builtAt: string;
  counts: {
    servants: number;
    /** Formas de combate: existem como artefato mas ficam fora do índice. */
    combatForms: number;
    craftEssences: number;
    craftEssencesDropped: number;
    mysticCodes: number;
  };
}

/** Muda quando o formato acima muda de forma incompatível. */
export const SCHEMA_VERSION = "0.1.0";
