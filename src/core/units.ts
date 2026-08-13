/**
 * Conversão de unidades do Atlas para o canônico.
 *
 * O Atlas usa divisores diferentes para o MESMO campo (`svals[].Value`) conforme
 * o `funcType`, e não marca isso em lugar nenhum do dado. Errar aqui produz um
 * número plausível e errado — o pior tipo de bug neste projeto.
 *
 * Cada entrada abaixo foi conferida contra um valor conhecido do jogo; a
 * referência está no comentário. funcType fora da tabela devolve `unknown`
 * e os valores ficam CRUS: preferimos expor a ignorância a converter errado.
 *
 * Ver docs/SCHEMA.md §2.
 */

import type { ValueUnit } from "./model.js";

interface ValueRule {
  divisor: number;
  unit: ValueUnit;
}

const PERCENT_10: ValueRule = { divisor: 10, unit: "percent" };
const PERCENT_100: ValueRule = { divisor: 100, unit: "percent" };
const FLAT: ValueRule = { divisor: 1, unit: "flat" };
const UNKNOWN: ValueRule = { divisor: 1, unit: "unknown" };

/**
 * Regra por funcType. Só entram funcTypes cuja unidade foi verificada.
 *
 * Conferências:
 *   damageNp        Excalibur NP1 = 300%  -> Value 3000  (/10)
 *   gainNp          Kaleidoscope  =  80%  -> Value 8000  (/100)
 *   gainNp          Kaleidoscope MLB 100% -> Value 10000 (/100)
 *   gainStar        Koyanskaya sk2 = 20 estrelas -> Value 20 (flat)
 *   gainHp          Tamamo NP = 2000 HP          -> Value 2000 (flat)
 *   hastenNpturn    "avança 1 turno"             -> Value 1 (flat)
 */
const FUNC_VALUE_RULE: Record<string, ValueRule> = {
  // dano — multiplicador do NP em %
  damageNp: PERCENT_10,
  damageNpPierce: PERCENT_10,
  damageNpIndividual: PERCENT_10,
  damageNpIndividualSum: PERCENT_10,
  damageNpStateIndividualFix: PERCENT_10,
  damageNpRare: PERCENT_10,
  damageNpAndCheckIndividuality: PERCENT_10,
  damageNpHpratioLow: PERCENT_10,
  damageNpHpratioHigh: PERCENT_10,
  damageNpCounter: PERCENT_10,
  // R28 — faltavam, e a falta não era visível: `valueRuleFor` devolve `unknown`
  // para funcType fora da tabela, o que deixa o valor CRU. Para quase todo campo
  // isso é a proteção certa (o número sai obviamente não convertido); para um
  // multiplicador de NP é o contrário, porque ele vai direto para a fórmula sem
  // ninguém olhar `valueUnit`. Dava dano 10x.
  //   damageNpBattlePointPhase        Ereshkigal 450/600/675/712,5/750%
  //   damageNpAndOrCheckIndividuality Heroine XX (Alter) 600/800/900/950/1000%
  // As duas progressões são a curva padrão de nível de NP; 4500% não é
  // multiplicador de NP nenhum.
  damageNpBattlePointPhase: PERCENT_10,
  damageNpAndOrCheckIndividuality: PERCENT_10,
  damageValue: FLAT,
  damageValueSafe: FLAT,

  // carga de NP — % de barra
  gainNp: PERCENT_100,
  gainNpBuffIndividualSum: PERCENT_100,
  gainNpFromTargets: PERCENT_100,
  lossNp: PERCENT_100,
  absorbNpturn: PERCENT_100,

  // valores planos
  gainStar: FLAT,
  gainHp: FLAT,
  gainHpFromTargets: FLAT,
  lossHp: FLAT,
  lossHpSafe: FLAT,
  hastenNpturn: FLAT,
  delayNpturn: FLAT,
  shortenSkill: FLAT,
  extendSkill: FLAT,
  transformServant: FLAT,
  moveToLastSubmember: FLAT,

  // percentuais de HP
  gainHpPer: PERCENT_10,
  lossHpPer: PERCENT_10,
  lossHpPerSafe: PERCENT_10,
  instantDeath: PERCENT_10,
  forceInstantDeath: PERCENT_10,
};

/**
 * Funções que aplicam buff (`addState`, `addStateShort`, …) usam o valor do BUFF,
 * não da função — e buffs são quase sempre percentuais /10.
 *   Charisma B lv1 = 9% ATK -> Value 90
 *   Koyanskaya sk3 = 50% Buster -> Value 500
 */
const BUFF_FUNCS = new Set(["addState", "addStateShort", "addFieldChangeToField"]);

/**
 * Exceção à regra acima: estes buffs guardam um **id**, não um percentual.
 *
 * A família `*Function` (`attackAfterFunction`, `selfturnendFunction`, …) aponta
 * para outra função por id; `addIndividuality` e `fieldIndividuality` apontam
 * para um trait. Dividir por 10 produzia coisas como "97092.8%" — número
 * plausível à distância e completamente sem sentido.
 *
 * Vão como `unknown` com o valor cru: o dado fica visível e obviamente não
 * convertido, em vez de parecer um percentual válido.
 */
const ID_CARRYING_BUFFS = /Function$|Function(MainOnly)?$|^addIndividuality$|^fieldIndividuality$/;

/**
 * Segunda exceção: buffs cujo valor é um **número plano**, não um percentual.
 *
 * `damage_formula.txt` é explícito nos dois que entram na fórmula:
 *
 *     dmgPlusAdd    = {X Damage Plus/Minus}  // Note the lack of %. Divinity...
 *     selfDmgCutAdd = {X Damage Up/Cut}      // Also a straight number.
 *
 * Divinity B é **+175 de dano**, não +17,5%. Como o `/10` cai sobre qualquer
 * buff, os dois slots aditivos da fórmula saíam dez vezes menores — e 17,5 é
 * plausível o bastante para ninguém desconfiar.
 *
 * Conferências (valor bruto = valor do jogo):
 *   addDamage      Divinity D/B/A = 125 / 175 / 200
 *   subSelfdamage  Fifth Force A+ da Musashi = 1000 de corte
 *   regainStar     valores ímpares (3, 9, 15) — /10 daria fração de estrela,
 *                  e estrela fracionária não existe no jogo
 *   addMaxhp       2000 a 10000 de HP máximo
 *
 * Só entram tipos observados no dump: `subDamage` é plausível pelo nome e
 * **não existe** no dado, então fica de fora até aparecer.
 */
const FLAT_BUFFS = new Set([
  "addDamage",
  "addSelfdamage",
  "subSelfdamage",
  "regainHp",
  "regainStar",
  "addMaxhp",
  "subMaxhp",
]);

export function valueRuleFor(funcType: string, hasBuff: boolean, buffType?: string | null): ValueRule {
  if (buffType && ID_CARRYING_BUFFS.test(buffType)) return UNKNOWN;
  if (buffType && FLAT_BUFFS.has(buffType)) return FLAT;
  if (hasBuff || BUFF_FUNCS.has(funcType)) return PERCENT_10;
  return FUNC_VALUE_RULE[funcType] ?? UNKNOWN;
}

export function convertValues(raw: (number | undefined)[], rule: ValueRule): number[] {
  return raw.map((v) => (v === undefined ? 0 : v / rule.divisor));
}

/** `Rate` é sempre /10 (1000 = 100%). Verificado em todo o dataset. */
export function convertRate(rate: number | undefined): number {
  return rate === undefined ? 100 : rate / 10;
}

/** Multiplicadores constantes (NiceConstant, matrizes, NiceCard) são sempre /1000. */
export function convertMultiplier(v: number): number {
  return v / 1000;
}

// ------------------------------------------------------------ buff conhecidos

/**
 * Buffs que mapeiam para um slot da fórmula de dano.
 * A fase 3 usa esta lista para montar o mapeamento buff -> slot; aqui ela só
 * alimenta o campo `Effect.supported`.
 */
export const DAMAGE_BUFF_TYPES = new Set([
  "upAtk", "downAtk",
  "upDefence", "downDefence",
  "upCommandall", "downCommandall",
  "upDamage", "downDamage",
  "upNpdamage", "downNpdamage",
  "upCriticaldamage", "downCriticaldamage",
  "upDamageIndividuality", "upDamageIndividualityActiveonly",
  "upSpecialdamage",
  "upDamagedropnp",
  "pierceDefence",
  "upGrantstate",
  "selfturnendHpReduce",
  // Os dois slots aditivos da fórmula. Estavam de fora: `addDamage` em lista
  // nenhuma e `subSelfdamage` entre os utilitários, então a Divinity aparecia
  // marcada "NOT MODELLED" na tela e no `get_servant` enquanto o cálculo a
  // somava. Um efeito não pode ser modelado e não modelado ao mesmo tempo.
  "addDamage",
  "addSelfdamage",
  "subSelfdamage",
]);

/**
 * Buffs reconhecidos que NÃO afetam dano diretamente (utilidade: NP gain,
 * estrelas, imunidades, controle). Existem aqui para distinguir
 * "conhecido e irrelevante ao dano" de "nunca visto" (R12).
 */
export const KNOWN_UTILITY_BUFF_TYPES = new Set([
  "upCriticalrate", "downCriticalrate",
  "upCriticalpoint", "downCriticalpoint",
  "upStarweight", "downStarweight",
  "upDropnp", "downDropnp",
  "regainNp", "regainHp", "regainStar",
  "avoidance", "invincible", "avoidInstantdeath", "breakAvoidance",
  "guts", "gutsRatio",
  "upTolerance", "downTolerance",
  "upToleranceSubstate", "downToleranceSubstate",
  "donotAct", "donotSkill", "donotNoble", "donotNobleCondMismatch",
  "delayFunction", "addIndividuality", "subIndividuality",
  "fieldIndividuality",
  "upFuncHpReduce", "downFuncHpReduce",
  "upNpturnval", "upGainHp", "downGainHp",
  "buffRate",
  "preventDeathByDamage",
  "counterFunction",
  "toFieldChangeField",
  "multiattack",
  "upChagetd",
]);

export function isSupportedBuff(buffType: string | null): boolean {
  if (buffType === null) return true; // função sem buff: o funcType já basta
  return DAMAGE_BUFF_TYPES.has(buffType) || KNOWN_UTILITY_BUFF_TYPES.has(buffType);
}
