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
  };
}

export interface AtlasSval {
  Rate?: number;
  Turn?: number;
  Count?: number;
  Value?: number;
  /** Super-efetivo: trait único que ativa o bônus (ex. 2008 = weakToEnumaElish). */
  Target?: number;
  /** Super-efetivo: lista de traits, usada por `damageNpIndividualSum`. */
  TargetList?: number[];
  /** Super-efetivo: multiplicador. `1500` = 1.5×. Varia com overcharge em 52% dos casos. */
  Correction?: number;
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
}

export interface AtlasExtraAssets {
  faces?: Record<string, Record<string, string>>;
  charaGraph?: Record<string, Record<string, string>>;
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
