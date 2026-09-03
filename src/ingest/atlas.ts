/**
 * Tipos do formato bruto do Atlas Academy.
 *
 * Propositalmente frouxos e incompletos: descrevem só o que a ingestão lê.
 * Este é o ÚNICO arquivo, junto com transform.ts, que conhece o formato do Atlas.
 */

export interface AtlasTrait {
  id: number;
  name?: string;
}

export interface AtlasBuff {
  id?: number;
  type?: string;
  ckSelfIndv?: AtlasTrait[];
  ckOpIndv?: AtlasTrait[];
  /** Traits do próprio buff: `buffNpDamageUp`, `buffPositiveEffect`... */
  vals?: AtlasTrait[];
  script?: {
    /** Só em `buffRate`: quais traits de buff este efeito multiplica. */
    UpBuffRateBuffIndiv?: AtlasTrait[];
    /** Só em `overwriteClassRelation`: matriz de classe sobrescrita. */
    relationId?: {
      /** `[classe do atacante][classe do alvo]` — muda o dano causado. */
      atkSide?: Record<string, Record<string, { damageRate?: number; type?: string }>>;
      /** Muda o dano recebido; não é lido, nada aqui calcula dano recebido. */
      defSide?: Record<string, Record<string, { damageRate?: number; type?: string }>>;
    };
    /** Limiar de HP do portador, por mil: o buff só vale acima dele (R30). */
    HP_HIGHER?: number;
    /** Idem, só vale abaixo. */
    HP_LOWER?: number;
  };
}

export interface AtlasSval {
  Rate?: number;
  Turn?: number;
  Count?: number;
  Value?: number;
  /** Super-efetivo: trait único que ativa o bônus (ex. 2008 = weakToEnumaElish). */
  /**
   * ATENÇÃO: dois sentidos, decididos pelo `funcType`.
   *
   * Em `damageNpHpratio*` é o **bônus de dano por HP faltante**, um percentual
   * /10 (`12000` = 1200%) — não um id. Em todo o resto é o trait do
   * super-efetivo. Ler o sentido errado dá um trait id 12000 inexistente.
   *
   * Quem separa os dois é `toSuperEffective`, que exige `Correction`: as
   * funções de HP não têm esse campo.
   */
  Target?: number;
  /** Super-efetivo: lista de traits, usada por `damageNpIndividualSum`. */
  TargetList?: number[];
  /** Super-efetivo: multiplicador. `1500` = 1.5×. Varia com overcharge em 52% dos casos. */
  Correction?: number;

  /**
   * Em `damageNpIndividualSum`, o multiplicador super-efetivo — o papel que
   * `Correction` tem nas outras famílias de dano (R27). Ali `Correction` passa
   * a ser o acréscimo **por unidade contada**.
   *
   * Ler o campo errado dava multiplicador 0% em quatro NPs, e multiplicador
   * zero zera o produto inteiro: 1 de dano.
   */
  Value2?: number;
  /** Teto da contagem em `damageNpIndividualSum`. `0` = não conta nada. */
  ParamAddMaxCount?: number;

  /**
   * Escala por HP (R25). Quanto o valor cresce conforme o HP do portador CAI:
   * o Cú Chulainn tem `Value: 200, RatioHPLow: 300`, ou seja 20% de ATK com HP
   * cheio e 50% com HP zero.
   *
   * Sem estes campos, o que sobra é o valor de HP cheio — e em dois casos
   * (Leonidas, Passionlip) o `Value` é `0`, então o buff inteiro sumia.
   */
  RatioHPLow?: number;
  /** O valor na ponta ALTA da faixa. Ausente = 0. */
  RatioHPHigh?: number;
  /**
   * Faixa de HP em que a interpolação acontece, por mil (`500` = 50%).
   * Fora dela vale só `Value`. Ausentes = a faixa inteira, 0 a 100%.
   *
   * Só a Passionlip usa: "HP50%以下で発動" — ativa em 50% de HP ou menos.
   */
  RatioHPRangeLow?: number;
  RatioHPRangeHigh?: number;
}

export interface AtlasFunction {
  funcType: string;
  funcTargetType: string;
  funcTargetTeam?: string;
  functvals?: AtlasTrait[];
  buffs?: AtlasBuff[];
  /** Em NPs: valores por nível de NP **no overcharge 1**. Em skills: por nível de skill. */
  svals?: AtlasSval[];
  /** Só em NPs: os mesmos valores nos overcharges 2 a 5. Presentes em 100% das funções de NP. */
  svals2?: AtlasSval[];
  svals3?: AtlasSval[];
  svals4?: AtlasSval[];
  svals5?: AtlasSval[];
}

export interface AtlasSkill {
  id: number;
  num?: number;
  name?: string;
  detail?: string;
  coolDown?: number[];
  functions?: AtlasFunction[];
  priority?: number;
  condQuestId?: number;
  /** Só em CE: 0 = base, 4 = max limit break. */
  condLimitCount?: number;
}

export interface AtlasNoblePhantasm {
  id: number;
  name?: string;
  rank?: string;
  type?: string;
  card?: string;
  effectFlags?: string[];
  npDistribution?: number[];
  functions?: AtlasFunction[];
  priority?: number;
  condQuestId?: number;
}

export interface AtlasServant {
  id: number;
  collectionNo: number;
  name: string;
  originalName?: string;
  type: string;
  flag?: string;
  className: string;
  attribute: string;
  rarity: number;
  cost?: number;
  lvMax?: number;
  traits?: AtlasTrait[];
  atkGrowth?: number[];
  hpGrowth?: number[];
  starGen?: number;
  instantDeathChance?: number;
  cards?: string[];
  hitsDistribution?: Record<string, number[]>;
  skills?: AtlasSkill[];
  classPassive?: AtlasSkill[];
  appendPassive?: { num?: number; priority?: number; skill: AtlasSkill }[];
  noblePhantasms?: AtlasNoblePhantasm[];
  extraAssets?: AtlasExtraAssets;
  /**
   * Medidores de Battle Point (R33). Só a Ereshkigal cn417 tem um, e é o NP
   * dela que o consome — por `id`, e não por posição, que é por que o grupo
   * vira um dicionário global na ingestão.
   */
  battlePoints?: AtlasBattlePointGroup[];
}

export interface AtlasBattlePointGroup {
  id: number;
  phases?: { phase: number; value: number; name?: string }[];
}

export interface AtlasExtraAssets {
  faces?: Record<string, Record<string, string>>;
  charaGraph?: Record<string, Record<string, string>>;
  /**
   * Mystic Code usa outro conjunto: não tem `charaGraph`, tem `item` (o ícone
   * do equipamento), `masterFace` e `masterFigure`. Cada um com `male`/`female`,
   * porque a arte muda com o gênero do Master.
   */
  item?: Record<string, string>;
  masterFace?: Record<string, string>;
  masterFigure?: Record<string, string>;
}

export interface AtlasEquip {
  id: number;
  collectionNo: number;
  name: string;
  originalName?: string;
  type: string;
  flag?: string;
  rarity: number;
  cost?: number;
  lvMax?: number;
  atkGrowth?: number[];
  hpGrowth?: number[];
  skills?: AtlasSkill[];
  extraAssets?: AtlasExtraAssets;
}

export interface AtlasMysticCode {
  id: number;
  name: string;
  shortName?: string;
  detail?: string;
  maxLv?: number;
  skills?: AtlasSkill[];
  extraAssets?: AtlasExtraAssets;
}

export type AtlasConstant = Record<string, number>;
export type AtlasClassAttackRate = Record<string, number>;
export type AtlasClassRelation = Record<string, Record<string, number>>;
export type AtlasAttributeRelation = Record<string, Record<string, number>>;
export type AtlasCard = Record<string, Record<string, { adjustAtk: number; addAtk: number }>>;
