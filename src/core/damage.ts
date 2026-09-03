/**
 * Calculadora de dano. Função pura: sem I/O, sem React, sem banco.
 *
 * Implementa a fórmula de `damage_formula.txt` termo a termo, mantendo os
 * nomes do arquivo original para que a conferência seja linha a linha:
 *
 *   dano = [ servantAtk
 *          * npDamageMultiplier
 *          * (firstCardBonus + cardDamageValue * (1 + cardMod))
 *          * classAtkBonus * triangleModifier * attributeModifier
 *          * randomModifier * ATTACK_RATE
 *          * (1 + atkMod - defMod)
 *          * criticalModifier * extraCardModifier
 *          * (1 - specialDefMod)
 *          * (1 + powerMod + selfDamageMod + critDamageMod*isCrit + npDamageMod*isNP)
 *          * (1 + (superEffectiveModifier - 1) * isSuperEffective) ]
 *          + dmgPlusAdd + selfDmgCutAdd + servantAtk * busterChainMod
 *
 * Nenhuma constante é literal: todas vêm de `constants.json`, gerado dos dumps.
 *
 * Ver docs/DAMAGE.md.
 */

import { PIERCE_FUNCS, SLOT_SIDE, sideOfTarget, signOf, specFor, type DamageSlot } from "./buffs.js";
import type {
  CardType,
  ClassRelationOverride,
  Constants,
  CraftEssence,
  Effect,
  HpGate,
  HpScaling,
  MysticCode,
  NoblePhantasm,
  Servant,
  SuperEffective,
  SuperEffectiveValues,
  Trait,
} from "./model.js";

/** HP em % nunca sai de 0..100, venha de query string, de tool ou de teste. */
const clampPercent = (n: number): number => Math.min(100, Math.max(0, n));

const clampInt = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(n)));

// ------------------------------------------------------------------- entrada

export type RollMode = "min" | "avg" | "max" | "range";

export interface Enemy {
  className: string;
  attribute: string;
  /** Identidade escolhida pelo usuário. Classe e atributo viram trait sozinhos. */
  traits: Trait[];
  /** % — buff de defesa já ativo no inimigo. */
  defMod: number;
  /** % — resistência especial de alguns bosses. Pierce NÃO ignora isto. */
  specialDefMod: number;
  /**
   * Quantas unidades o **alvo** carrega do trait que o NP conta (R27). Omitido
   * = 0. Só olhado quando o NP tem `countsOn: "target"` — o Romulus conta
   * 〔roman〕, o Jacques de Molay conta queimadura.
   *
   * Não sai da lista `traits`: aquela responde "é romano?", e aqui a pergunta é
   * "quantos 〔roman〕 ele carrega?", que vai até 10 porque o próprio NP aplica
   * o trait a cada uso. Conjunto não guarda multiplicidade.
   */
  stacks?: number;
}

export type BuffSource =
  | { kind: "ownSkill"; skillNum: number; level: number }
  | { kind: "append"; num: number; level: number }
  /**
   * Uma skill do Mystic Code equipado. Qual MC é, e em que nível, vive em
   * `DamageInput.mysticCode` — aqui só se escolhe **quais** skills dispararam,
   * como `ownSkill` faz com as do servo.
   *
   * Separar as duas coisas impede um estado sem sentido: duas entradas
   * apontando para Mystic Codes diferentes na mesma party.
   */
  | { kind: "mysticCodeSkill"; index: number }
  /**
   * Uma fonte de buff **externa**: outro servo contribuindo para este ataque.
   *
   * Pode aparecer quantas vezes quiser, inclusive com o mesmo `servantId` — duas
   * cópias do mesmo suporte somam, e Order Change permite mais de dois num turno.
   * Não há party aqui: a fórmula só quer a lista de contribuições.
   *
   * `targetsAttacker` responde a pergunta que só o usuário sabe: um buff de
   * **alvo único** apontou para quem está atacando? Buff de party inteira não
   * pergunta. Vale para 78 dos 462 servos.
   */
  | {
      kind: "support";
      servantId: number;
      skills: number[];
      skillLevel: number;
      targetsAttacker: boolean;
      /** O NP do suporte, quando ele foi usado. Nível e overcharge são DELE. */
      np?: { level: number; overcharge: number };
      /**
       * A CE do suporte — **efeitos só, nunca ATK**. A ATK daquela CE é do
       * suporte, não de quem ataca. E não há `level`: nível de CE move ATK e HP,
       * e o valor dos efeitos só muda com o MLB.
       */
      ce?: { id: number; mlb: boolean };
    }
  | { kind: "npSelfBuff" };

export interface DamageInput {
  attacker: {
    servantId: number;
    level: number;
    fou: number;
    npLevel: 1 | 2 | 3 | 4 | 5;
    overcharge: 1 | 2 | 3 | 4 | 5;
    /**
     * Qual NP usar, quando o servo tem mais de um (R24). Omitido = o padrão de
     * `selectableNps`. Id desconhecido cai no padrão em vez de falhar.
     */
    npId?: number;
    /**
     * A Craft Essence equipada. **Declaração única**: daqui saem a ATK e os
     * efeitos. `level` move a ATK; `mlb` escolhe entre `effectsBase` e
     * `effectsMlb`, que são conjuntos diferentes e não graus do mesmo (D17).
     */
    ce?: { id: number; level?: number; mlb: boolean };
    /**
     * HP atual do atacante, em % do máximo. Omitido = 100 (ileso).
     *
     * É uma **razão**, não um valor absoluto, porque é só disso que as duas
     * escalas de HP precisam (R25) — o que torna `hpMax`, e portanto o HP de
     * uma CE, irrelevante para o dano.
     */
    hpPercent?: number;
    /**
     * Quantas unidades o **atacante** carrega do trait que o NP dele conta
     * (R27). Omitido = 0. Só olhado quando o NP tem `countsOn: "self"` —
     * Charlemagne e mais sete.
     *
     * Separado de `enemy.stacks` de propósito: são contagens de entidades
     * diferentes, e um campo só mudaria de sentido conforme o servo.
     */
    stacks?: number;
  };
  /**
   * O Mystic Code equipado, se houver. Fica **fora** de `attacker` de propósito:
   * ele é do Master e vale para a party inteira, ao contrário da CE, que é do
   * servo. Quando a fase 5b trouxer suportes, cada um terá a sua CE e o MC
   * continuará sendo um só.
   *
   * Quais skills dispararam vem do `buffStack`, como `mysticCodeSkill`.
   */
  mysticCode?: { id: number; level: number };
  buffStack: BuffSource[];
  enemy: Enemy;
  action: {
    kind: "np" | "card" | "extra";
    card?: CardType;
    position?: 1 | 2 | 3;
    isCrit: boolean;
    /**
     * A **primeira carta da chain** foi Buster? (R32)
     *
     * Propriedade do turno, não desta carta: quando a chain abre em Buster,
     * todas as cartas dela ganham `firstCardBonus`. Omitido = deduzido — esta
     * carta ser a Buster de abertura, ou ser uma Buster Chain, já responde sim.
     */
    busterFirst?: boolean;
    busterChain: boolean;
    braveChain: boolean;
  };
  options: { rollMode: RollMode };
}

/** Documentos já carregados. O caller faz o I/O; o cálculo continua puro. */
export interface DamageData {
  servants: Map<number, Servant>;
  equips: Map<number, CraftEssence>;
  mysticCodes: Map<number, MysticCode>;
  constants: Constants;
}

// -------------------------------------------------------------------- saída

export interface ResolvedBuff {
  source: string;
  buffType: string;
  slot: DamageSlot;
  /** Já com o boost aplicado, quando houver. */
  value: number;
  chance: number;
  /**
   * O slot deste buff entrou de fato **nesta ação**.
   *
   * `false` quando o buff resolveu num slot que a ação não usa: crit damage sem
   * crítico, NP damage num card. O buff continua listado — o jogador o tem —,
   * mas quem apresenta o resultado precisa separar "está no stack" de "somou".
   *
   * Vive aqui, e não na tela, para o MCP da fase 4 não ter que redescobrir a
   * regra e chegar a uma resposta diferente da interface.
   */
  counted: boolean;
  /** Valor antes do boost, e de onde ele veio. Ausentes quando não houve boost. */
  boostedFrom?: number;
  boostedBy?: string;
  /**
   * Quanto este buff valeria com HP cheio (R25). Só nos efeitos que escalam
   * com HP; presente mesmo quando o HP está cheio e os dois são iguais.
   */
  atFullHp?: number;
  /**
   * O limiar de HP que este buff exige, quando ele exige um (R30) — em texto,
   * já resolvido: `"HP at least 50%"`.
   *
   * Presente só quando o limiar **passou**; o que reprova sai em `skippedBuffs`
   * com o motivo. Aparece mesmo assim porque o buff estar valendo *agora* e
   * depender do HP são dois fatos distintos, e o segundo é o que explica o
   * número cair quando você apanha.
   */
  hpGate?: string;
}

export interface SkippedBuff {
  source: string;
  buffType: string;
  reason: string;
}

export interface DamageResult {
  min: number;
  avg: number;
  max: number;
  perHit: number[];
  breakdown: {
    servantAtk: number;
    /** Já com `npHpBonus` somado, quando houver. */
    npDamageMultiplier: number;
    /**
     * R25: a parcela de `npDamageMultiplier` que veio do HP faltante, em %.
     * `0` nos 409 NPs sem a mecânica, e também com HP cheio.
     */
    npHpBonus: number;
    /** HP do atacante em % do máximo. 100 = ileso, o padrão. */
    hpPercent: number;
    /**
     * R27: quantas unidades foram contadas para o super-efetivo, já presas ao
     * teto. `0` quando o NP não conta nada, que é o caso de 396 dos 413.
     */
    superEffectiveStacks: number;
    /** Termo `cardMod` da fórmula, isolado. */
    cardMod: number;
    /** `firstCardBonus + cardDamageValue * (1 + cardMod)` já resolvido. */
    cardTerm: number;
    /**
     * A parcela de `cardTerm` que veio da chain ter aberto em Buster (R32).
     *
     * Separada porque é a única do termo que **não** depende desta carta: some
     * a mesma 0,5 de uma Arts em segunda posição e de uma Buster em terceira.
     */
    firstCardBonus: number;
    classAtkBonus: number;
    /** Já com a sobrescrita aplicada, quando houver. */
    triangleModifier: number;
    /** Da matriz padrão. Diferente de `triangleModifier` só quando houve override (R22). */
    triangleModifierBase: number;
    attributeModifier: number;
    atkMod: number;
    defMod: number;
    powerMod: number;
    /**
     * Soma dos buffs no slot, **esteja ou não valendo nesta ação**.
     *
     * `critDamageMod` só entra na fórmula num crítico e `npDamageMod` só num NP.
     * Quem lê o breakdown precisa dos dois fatos separados — "tenho o buff" e
     * "ele contou" —, por isso o valor fica cru aqui e `isCrit`/`isNP` dizem se
     * foi usado. Zerar o campo esconderia um buff que o jogador tem.
     */
    critDamageMod: number;
    npDamageMod: number;
    isNP: boolean;
    isCrit: boolean;
    specialDefMod: number;
    superEffectiveModifier: number;
    /** 1 ou `CRITICAL_ATTACK_RATE`. */
    criticalModifier: number;
    /** 1, `EXTRA_ATTACK_RATE_SINGLE` ou `_GRAND`. */
    extraCardModifier: number;
    flatDamage: number;
    /** `servantAtk * busterChainMod`, somado fora do produto. */
    busterChainBonus: number;
    pierceDefence: boolean;
  };
  /**
   * As premissas do cálculo, em texto.
   *
   * **Estas strings vão para a tela e para a resposta do MCP, então são em
   * inglês** — ao contrário dos comentários deste projeto. Quem editar `reason`
   * ou `source` está editando interface, não log.
   */
  assumptions: {
    rollMode: RollMode;
    resolved: string[];
    appliedBuffs: ResolvedBuff[];
    skippedBuffs: SkippedBuff[];
    uncertainBuffs: { source: string; buffType: string; chance: number }[];
    unmodeled: string[];
  };
}

// ----------------------------------------------------------- escolha do NP

/**
 * Os NPs entre os quais dá para escolher (R24).
 *
 * Cinco servos têm mais de um card de NP, e o multiplicador muda junto: a Space
 * Ishtar vai de 300–500% no Buster a 600–1000% no Quick, e a Mélusine tem dois
 * NPs de nomes diferentes, 300–500% e 900–1500%. Calcular sempre pelo `np`
 * "ativo" erra por quase o dobro nesses casos.
 *
 * `npAlternatives` mistura duas coisas: variante, que é escolha, e rank up, que é
 * história (a Mash tem oito versões Arts). O que separa as duas é o par
 * **card + alvo**: dentro do mesmo par, a de maior `priority` é a atual (R8);
 * pares diferentes coexistem.
 *
 * O alvo faz parte da chave porque nem toda variante muda o card: a
 * UDK-Barghest tem dois NPs Arts, AoE a 450% e ST a 900%, e o Jade Rabbit e a
 * BB Dubai são iguais. Agrupar só por card escondia justamente a versão de
 * dobro do multiplicador.
 *
 * Desempate por `condQuestId` porque o Emiya tem os dois eixos ao mesmo tempo —
 * Buster e Arts, cada um em versão pré e pós rank up, e as duas Arts empatam em
 * `priority`. Sem o desempate a escolha seria a ordem do array.
 *
 * O que a tela **não** tenta responder é como o servo chega àquele estado: a
 * Space Ishtar troca por mecânica própria, o Ptolemaîos por `transformServant`,
 * a Mash por forma. Isso é estado (D14), e quem monta o cenário decide — o mesmo
 * princípio de D18 para buffs.
 */
export function selectableNps(servant: Servant): NoblePhantasm[] {
  const best = new Map<string, NoblePhantasm>();
  for (const np of [servant.np, ...servant.npAlternatives]) {
    if (!np) continue;
    const key = `${np.card}/${np.target}`;
    const cur = best.get(key);
    const better =
      !cur || np.priority > cur.priority || (np.priority === cur.priority && np.condQuestId > cur.condQuestId);
    if (better) best.set(key, np);
  }
  // O ativo primeiro; o resto por card e alvo, para a ordem não depender do Map.
  const rank = (n: NoblePhantasm) => `${n.card}/${n.target}`;
  return [...best.values()].sort((a, b) =>
    a.id === servant.np?.id ? -1 : b.id === servant.np?.id ? 1 : rank(a).localeCompare(rank(b)),
  );
}

/** O NP escolhido, ou o padrão quando não há escolha (ou o id não existe). */
function chosenNp(servant: Servant, npId: number | undefined): NoblePhantasm | null {
  const options = selectableNps(servant);
  return options.find((n) => n.id === npId) ?? options[0] ?? servant.np;
}

// ------------------------------------------------------------------ inimigo

const CARD_TRAIT: Record<CardType, string> = {
  buster: "cardBuster",
  arts: "cardArts",
  quick: "cardQuick",
  extra: "cardExtra",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Alvo sem classe e sem atributo — "não me importo com vantagem".
 *
 * Não é uma classe do jogo, e é justamente esse o ponto: dizer que o inimigo é
 * um Shielder é uma **afirmação sobre o inimigo**, e traz o trait
 * `classShielder` junto, que 4 efeitos do roster procuram. Dizer `neutral` é
 * dizer que o cenário não fixou classe nenhuma — nenhum multiplicador, nenhum
 * trait derivado.
 *
 * Os dois multiplicadores tratam o caso **explicitamente**, e não por o `?? 1`
 * do lookup falhar: acertar por engano é como a maioria dos defeitos deste
 * projeto começou.
 */
export const NEUTRAL = "neutral";

/**
 * Traits efetivos do inimigo: os escolhidos mais os derivados de classe e
 * atributo (D15).
 *
 * Sem a derivação, 71 checagens anti-classe e 16 anti-atributo falhariam em
 * silêncio — um Saber declarado sem o trait `classSaber` não ativaria nenhum
 * bônus anti-Saber.
 */
export function enemyTraitNames(enemy: Enemy): Set<string> {
  const names = new Set(enemy.traits.map((t) => t.name));
  // `neutral` não deriva trait: não há classe nem atributo para derivar de.
  if (enemy.className !== NEUTRAL) names.add(`class${cap(enemy.className)}`);
  if (enemy.attribute !== NEUTRAL) names.add(`attribute${cap(enemy.attribute)}`);
  return names;
}

/**
 * Os traits de um lado, por id **e** por nome.
 *
 * Os dois porque nenhum sozinho basta. Seis condições do dump têm o nome
 * `"unknown"` (R10), e casar por nome faria qualquer uma delas bater com o
 * `unknown` que quase todo servo carrega no fim da lista — a Artoria tem um.
 * Já os traits derivados do inimigo (`classSaber`, `attributeHuman`) existem só
 * como nome, porque são deduzidos e não vêm do dump.
 */
interface SideTraits {
  ids: Set<number>;
  names: Set<string>;
}

const sideTraitsOf = (traits: Trait[], extraNames?: Set<string>): SideTraits => ({
  ids: new Set(traits.map((t) => t.id)),
  names: extraNames ?? new Set(traits.map((t) => t.name)),
});

/** Id primeiro; o nome só vale quando é um nome de verdade. */
const carries = (t: Trait, s: SideTraits): boolean =>
  s.ids.has(t.id) || (t.name !== "unknown" && s.names.has(t.name));

/**
 * `condFunc` (`functvals`): o efeito só cai em **quem tem** certos traits (R31).
 *
 * As descrições japonesas não deixam dúvida sobre de quem é a exigência:
 * 味方全体の**〔円卓の騎士〕**の攻撃力をアップ — "sobe o ataque dos aliados **que
 * são Cavaleiros da Távola Redonda**". É filtro de destinatário, então o lado
 * avaliado é aquele em que o efeito cai.
 *
 * **A lista é OR, e o dado prova.** O Hans exige
 * `alignmentGood + alignmentBalanced + alignmentEvil`, que são mutuamente
 * exclusivos: sob AND a skill dele nunca valeria para ninguém.
 */
function condFuncRejection(
  conds: Trait[],
  side: "attacker" | "enemy",
  attacker: SideTraits,
  enemy: SideTraits,
): string | null {
  if (conds.length === 0) return null;

  const identity = conds.filter((t) => !t.name.startsWith("buff"));
  if (identity.some((t) => carries(t, side === "attacker" ? attacker : enemy))) return null;

  // Estado de buff, como em `condTarget` (§3.8): não é identidade e não é
  // modelado (D14). Vem depois do OR de propósito — um trait de identidade que
  // casou já resolveu a condição, e aí o estado não precisa ser consultado.
  const state = conds.filter((t) => t.name.startsWith("buff"));
  if (state.length > 0) {
    return `requires the holder to carry ${state.map((t) => t.name).join("/")} — buff state is not modelled`;
  }

  const what = identity.map((t) => (t.name === "unknown" ? `trait ${t.id}` : t.name)).join("/");
  return side === "attacker"
    ? `only applies to allies with ${what}, and the attacker has none of them`
    : `only applies to targets with ${what}`;
}

/**
 * Como se chama o que um NP conta, em texto — tela, auditoria e MCP dizem a
 * mesma coisa porque saem daqui (R33).
 *
 * Quase todos contam **trait**, e o nome do trait basta. A Ereshkigal conta
 * **fases de um medidor**, que não é trait nenhum: `traits` vem vazio e o nome
 * do que se conta vem de `countLabel`.
 */
export function countFieldLabel(se: SuperEffective): string {
  const traits = se.traits.map((t) => t.name).join("/");
  return traits ? `${traits} stacks` : "Battle Point phase";
}

/** A frase da auditoria. Duas formas porque "fase 7 de 10" não é "7 stacks". */
export function countPhrase(se: SuperEffective, n: number): string {
  const traits = se.traits.map((t) => t.name).join("/");
  if (traits) {
    return `${n} of up to ${se.maxCount} ${se.countsOn === "self" ? "own" : "target"} ${traits} stacks`;
  }
  return `Battle Point phase ${n} of ${se.maxCount}${se.countLabel ? ` (${se.countLabel})` : ""}`;
}

// --------------------------------------------------------- resolução de buff

/** Buff que pega a party inteira: alcança quem ataca sem perguntar. 400 efeitos. */
const REACHES_PARTY = new Set(["ptAll", "ptFull"]);
/**
 * Buff de **alvo único** entre aliados: alcança quem ataca só se tiver sido
 * apontado para ele. 125 efeitos, em 78 servos.
 */
const REACHES_ONE_ALLY = new Set(["ptOne", "ptOneOther", "ptOther", "ptSelfAnotherFirst"]);

/**
 * Um buff vindo de fora chega em quem ataca?
 *
 * A versão anterior juntava os dois conjuntos num só e decidia por um ternário
 * invertido: com `targetsAttacker: false`, um `ptOne` passava mesmo assim,
 * porque estava na mesma lista do `ptAll`. Ninguém tinha notado porque a fonte
 * `support` ainda não tinha superfície — só testes chegavam nela.
 */
const reachesAttacker = (target: string, targetsAttacker: boolean): boolean =>
  REACHES_PARTY.has(target) || (targetsAttacker && REACHES_ONE_ALLY.has(target));

interface Candidate {
  effect: Effect;
  source: string;
  /** Índice de nível dentro de `effect.values`. */
  levelIndex: number;
  /** true quando o efeito vem de fora do atacante e precisa alcançá-lo. */
  fromSupport: boolean;
  /** Só em fonte externa: o buff de alvo único foi apontado para quem ataca? */
  targetsAttacker?: boolean;
  /**
   * Overcharge a usar neste efeito. Omitido = o do atacante.
   *
   * O NP de um suporte tem overcharge **próprio** — 26 dos 47 NPs que buffam a
   * party escalam com ele, e o Prince of Lan Ling vai de +30% a +50% de ATK.
   * Herdar o overcharge de quem ataca daria o número de outro NP.
   */
  overcharge?: number;
  /** true quando vem da Craft Essence equipada. Ver `isEventOnlyBonus`. */
  fromCe: boolean;
}

/**
 * Bônus de dano que só vale dentro do evento da CE (R29).
 *
 * Uma CE de evento costuma dar "ataque +X% neste evento". No dump isso chega
 * como um `upDamage` **sem condição nenhuma**, e qual evento é vive em dado de
 * quest que não ingerimos — então aplicá-lo aqui inflava toda luta.
 *
 * O que autoriza a regra é a assimetria: em **servos**, `upDamage` sem condição
 * de trait tem **zero** ocorrências — todo `upDamage` de servo é anti-alguma
 * coisa. Nas CEs são 148, **todas** de evento, e 132 delas dizem no próprio
 * texto `『nome do evento』において`. Ou seja, não existe CE que dê dano
 * incondicional fora de evento: se não tem condição e veio de CE, é do evento.
 *
 * Recusa em vez de aplicar, e com o motivo à vista: a Golden Sumo dava +200% de
 * `powerMod` no MLB, quase triplicando o dano em qualquer luta.
 */
function isEventOnlyBonus(c: Candidate): boolean {
  return (
    c.fromCe &&
    c.effect.buffType === "upDamage" &&
    c.effect.condSelf.length === 0 &&
    c.effect.condTarget.length === 0 &&
    c.effect.condFunc.length === 0
  );
}

/** Como o limiar se lê em inglês, para a auditoria e para o motivo da recusa. */
const gateLabel = (g: HpGate): string => `HP ${g.kind === "atLeast" ? "at least" : "at most"} ${g.percent}%`;

/**
 * Limiar de HP do portador (R30). Devolve o motivo da recusa, ou `null`.
 *
 * **O limiar é de quem carrega o buff**, não de quem o deu. Num buff de party a
 * cópia que interessa é a que caiu no atacante, e é o HP dele que decide. Num
 * debuff, o portador é o inimigo — e o HP do inimigo não é modelado, então ali
 * se recusa dizendo isso, em vez de avaliar contra o HP errado.
 */
function hpGateRejection(gate: HpGate | null, side: "attacker" | "enemy", hpPercent: number): string | null {
  if (gate === null) return null;
  if (side !== "attacker") return `holds only at ${gateLabel(gate)} on the target, and enemy HP is not modelled`;
  const ok = gate.kind === "atLeast" ? hpPercent >= gate.percent : hpPercent <= gate.percent;
  return ok ? null : `holds only at ${gateLabel(gate)}, and the attacker is at ${hpPercent}%`;
}

function valueOf(effect: Effect, levelIndex: number, overcharge: number): number {
  const row = effect.valuesByOvercharge ? effect.valuesByOvercharge[overcharge - 1] : effect.values;
  return row?.[Math.min(levelIndex, (row.length || 1) - 1)] ?? 0;
}

/** Uma linha de `SuperEffectiveValues`, escolhida por overcharge e nível de NP. */
function ocValue(v: SuperEffectiveValues, overcharge: number, npLevel: number): number | undefined {
  return v.valuesByOvercharge ? v.valuesByOvercharge[overcharge - 1]?.[npLevel - 1] : v.values[npLevel - 1];
}

/**
 * Valor de um buff que cresce conforme o HP do portador cai (R25).
 *
 * Interpola linearmente entre as duas pontas da faixa. **Acima da faixa a
 * escala inteira não vale** — é o gatilho "só abaixo de 50% de HP" da
 * Passionlip, e é o que separa esta função de um simples `lerp`.
 *
 * Com HP cheio o resultado é o valor que a ingestão já guardava sozinha, então
 * este caminho não muda nenhum número que já estivesse certo.
 */
function hpScaledValue(base: number, s: HpScaling, levelIndex: number, hpPercent: number): number {
  if (hpPercent > s.rangeHigh) return base;

  const at = (a: number[]) => a[Math.min(levelIndex, (a.length || 1) - 1)] ?? 0;
  const lo = at(s.atLow);
  const hi = at(s.atHigh);
  const span = s.rangeHigh - s.rangeLow;
  const t = span > 0 ? (Math.max(hpPercent, s.rangeLow) - s.rangeLow) / span : 0;
  return base + lo + t * (hi - lo);
}

/**
 * Filtra e classifica os candidatos em slots da fórmula.
 *
 * Três razões para um buff não entrar, todas reportadas em vez de silenciadas:
 *  - alcance: efeito `self` de um suporte fica no suporte;
 *  - `condSelf`: buff de Buster não vale num NP Arts (R11);
 *  - `condTarget`: buff anti-`human` não vale contra alvo não humano.
 */
function resolveBuffs(
  candidates: Candidate[],
  input: DamageInput,
  enemyTraits: Set<string>,
  /** Os traits do servo que ataca — de quem `condFunc` fala quando o buff cai nele. */
  attackerTraits: Trait[],
  /**
   * Card **efetivo** da ação, já resolvido pelo chamador.
   *
   * Não pode ser deduzido de `input.action.card`: num NP o card vem do próprio
   * NP. Ler o campo errado fazia o buff de Buster da skill 2 da Artoria ser
   * descartado num Excalibur, que é Buster.
   */
  actionCard: CardType,
): {
  applied: ResolvedBuff[];
  skipped: SkippedBuff[];
  unmodeled: string[];
  relationOverrides: { source: string; buffType: string; rows: ClassRelationOverride[] }[];
} {
  const applied: ResolvedBuff[] = [];
  /** Traits de cada buff aplicado, paralelo a `applied` — só para casar boosts. */
  const appliedTraits: number[][] = [];
  const boosts: Boost[] = [];
  const relationOverrides: { source: string; buffType: string; rows: ClassRelationOverride[] }[] = [];
  const skipped: SkippedBuff[] = [];
  const unmodeled = new Set<string>();

  const isNPAction = input.action.kind === "np";
  const cardName = CARD_TRAIT[actionCard];
  /** Serve às duas mecânicas de HP: a que escala o valor (R25) e a que liga o efeito (R30). */
  const hpPercent = clampPercent(input.attacker.hpPercent ?? 100);
  // Os dois lados na mesma forma, para `condFunc` avaliar contra quem recebe.
  const attackerSide = sideTraitsOf(attackerTraits);
  const enemySide = sideTraitsOf(input.enemy.traits, enemyTraits);

  /** `faceCard` é "command card", ou seja, qualquer coisa que não seja NP. */
  const isCardTrait = (name: string) => name.startsWith("card") || name === "faceCard";

  /**
   * Restrição de tipo de card.
   *
   * Aparece dos **dois lados** e quer dizer a mesma coisa nos dois: em
   * `condSelf` é o card com que o atacante golpeia; em `condTarget`, num debuff
   * de resistência, é o card que vai acertar o alvo. A Arts resistance down da
   * Kiara é `downDefencecommandall → enemy` com `condTarget: [cardArts]` — lida
   * como identidade do inimigo, era recusada sempre, porque nenhum inimigo
   * "é" um card Arts.
   */
  const cardRejection = (traits: Trait[]): string | null => {
    const conds = traits.filter((t) => isCardTrait(t.name));
    if (conds.length === 0) return null;
    const ok = conds.some((t) => (t.name === "faceCard" ? !isNPAction : t.name === cardName));
    if (ok) return null;
    const what = isNPAction ? `an NP (${cardName})` : cardName;
    return `restricted to ${conds.map((t) => t.name).join("/")}, this attack is ${what}`;
  };

  /** Condições de aplicação. Devolve o motivo da recusa, ou `null` se o efeito vale. */
  const rejectionOf = (e: Effect): string | null => {
    const byCard = cardRejection(e.condSelf) ?? cardRejection(e.condTarget);
    if (byCard) return byCard;

    // `buff*` em condTarget é estado de buff do inimigo, não identidade — e
    // estado ainda não é modelado (D14). Recusar é conservador; o que não pode
    // é recusar dizendo "exige alvo com buffCurse", como se fosse um trait.
    const buffConds = e.condTarget.filter((t) => t.name.startsWith("buff"));
    if (buffConds.length > 0) {
      return `requires the target to carry ${buffConds.map((t) => t.name).join("/")} — enemy buff state is not modelled`;
    }

    // O que sobra é identidade do alvo: classe, atributo, trait.
    const identity = e.condTarget.filter((t) => !isCardTrait(t.name) && !t.name.startsWith("buff"));
    if (identity.length > 0 && !identity.some((t) => enemyTraits.has(t.name))) {
      return `requires a target with ${identity.map((t) => t.name).join("/")}`;
    }
    return null;
  };

  for (const c of candidates) {
    const e = c.effect;
    if (e.buffType === null) continue; // funções sem buff não alimentam slots
    const label = e.buffType;

    // Alcance: um buff `self` de um suporte fica no suporte. Debuff no inimigo
    // não passa por aqui — qualquer um da party pode aplicá-lo, e o def down de
    // um suporte é uma das maiores fontes de dano do jogo.
    const side = sideOfTarget(e.target);
    if (side === "attacker" && c.fromSupport && !reachesAttacker(e.target, c.targetsAttacker ?? false)) {
      // O motivo distingue os dois casos: um `self` nunca chegaria; um `ptOne`
      // chegaria se tivesse sido apontado, e dizer isso é o que permite à pessoa
      // corrigir em vez de achar que a skill não faz nada.
      const reason = REACHES_ONE_ALLY.has(e.target)
        ? `target ${e.target} hits one ally, and this source was not pointed at the attacker`
        : `target ${e.target} does not reach the attacker`;
      skipped.push({ source: c.source, buffType: label, reason });
      continue;
    }

    if (isEventOnlyBonus(c)) {
      skipped.push({
        source: c.source,
        buffType: e.buffType ?? e.funcType,
        reason: "event-only bonus: this CE grants it inside its own event, and the data does not say which",
      });
      continue;
    }

    const spec = specFor(e.buffType);
    if (spec === null) {
      unmodeled.add(e.buffType);
      continue;
    }

    // Nem boost nem override têm slot próprio: um age sobre o slot alheio, o
    // outro sobre o `triangleModifier`.
    const boostTargets = e.boostsBuffTraits ?? [];
    const relationRows = e.classRelationOverrides ?? [];
    if (spec.slot === null && boostTargets.length === 0 && relationRows.length === 0) continue;

    // Lado errado: o Def Up do atacante não é a defesa do alvo, e o Atk Down
    // aplicado no alvo não é o ataque do atacante. Nenhum dos dois muda o dano
    // causado, e os dois entrariam se o slot fosse lido sem o lado.
    if (spec.slot !== null && SLOT_SIDE[spec.slot] !== side) {
      skipped.push({
        source: c.source,
        buffType: label,
        reason:
          SLOT_SIDE[spec.slot] === "enemy"
            ? `lands on the attacker; only the target's ${spec.slot} changes damage dealt`
            : `lands on the target; only the attacker's ${spec.slot} changes damage dealt`,
      });
      continue;
    }

    const reason = rejectionOf(e);
    if (reason !== null) {
      skipped.push({ source: c.source, buffType: label, reason });
      continue;
    }

    // R31: `condFunc` filtra QUEM recebe o efeito. Nunca era lido, e o `upAtk`
    // 〔genderMale〕 da Queen Medb entrava numa atacante feminina.
    const byWho = condFuncRejection(e.condFunc, side, attackerSide, enemySide);
    if (byWho !== null) {
      skipped.push({ source: c.source, buffType: label, reason: byWho });
      continue;
    }

    // R30: limiar de HP. Vem de `buff.script`, não de `svals` — é a outra
    // metade da mecânica de HP, a que liga e desliga em vez de escalar. Sem
    // isto as duas camadas de crítico da C.I.E.L somavam com qualquer HP.
    const byHp = hpGateRejection(e.hpGate, side, hpPercent);
    if (byHp !== null) {
      skipped.push({ source: c.source, buffType: label, reason: byHp });
      continue;
    }

    if (relationRows.length > 0) {
      relationOverrides.push({ source: c.source, buffType: label, rows: relationRows });
      continue;
    }

    const flat = valueOf(e, c.levelIndex, c.overcharge ?? input.attacker.overcharge);
    // R25: quatro buffs de dano crescem conforme o HP cai. Sem isto sobra o
    // valor de HP cheio, que na Passionlip e no Leonidas é zero.
    const raw = e.hpScaling ? hpScaledValue(flat, e.hpScaling, c.levelIndex, hpPercent) : flat;

    if (boostTargets.length > 0) {
      boosts.push({
        source: c.source,
        buffType: label,
        // Por id, nunca por nome: o Atlas não traduz todos os traits (R10).
        traitIds: new Set(boostTargets.map((t) => t.id)),
        traitNames: boostTargets.map((t) => t.name).join("/"),
        rate: raw,
      });
      continue;
    }

    applied.push({
      source: c.source,
      buffType: label,
      slot: spec.slot!,
      value: raw * signOf(e.buffType),
      chance: e.chance,
      // Presente mesmo com HP cheio: saber que o buff é sensível a HP é
      // informação, e com HP cheio é justamente quando ele vale menos.
      ...(e.hpScaling
        ? { atFullHp: hpScaledValue(flat, e.hpScaling, c.levelIndex, 100) * signOf(e.buffType) }
        : {}),
      // Mesma razão do `atFullHp`: o buff estar valendo agora e depender do HP
      // são fatos distintos, e o segundo explica o número mudar quando apanha.
      ...(e.hpGate ? { hpGate: gateLabel(e.hpGate) } : {}),
      // Os dois slots condicionais da fórmula: `critDamageMod * isCrit` e
      // `npDamageMod * isNP`.
      counted:
        (spec.slot !== "critDamageMod" || (input.action.isCrit && !isNPAction)) &&
        (spec.slot !== "npDamageMod" || isNPAction),
    });
    appliedTraits.push(e.buffTraits.map((t) => t.id));
  }

  applyBoosts(applied, appliedTraits, boosts, skipped);
  return { applied, skipped, unmodeled: [...unmodeled], relationOverrides };
}

interface Boost {
  source: string;
  buffType: string;
  traitIds: Set<number>;
  traitNames: string;
  /** Em %: 100 dobra o valor do buff alcançado. */
  rate: number;
}

/**
 * Buffs que multiplicam o valor de outros buffs (R21).
 *
 * A skill 3 do Oberon é o único caso no jogo: `buffRate` a 100% sobre os buffs
 * marcados `buffNpDamageUp`, ou seja, um `upNpdamage` de 20% passa a contar 40%.
 * `damage_formula.txt` não prevê isso — o post é de antes do Oberon existir.
 *
 * A correspondência é por **trait de buff**, não por nome do buff: se o jogo um
 * dia lançar um boost de ATK up, ele já funciona sem tocar aqui.
 *
 * Um boost que não alcançou nada vai para `skipped` em vez de sumir — a skill do
 * Oberon num alvo sem buff de NP damage não faz nada, e isso precisa aparecer.
 */
function applyBoosts(
  applied: ResolvedBuff[],
  appliedTraits: number[][],
  boosts: Boost[],
  skipped: SkippedBuff[],
): void {
  const used = new Set<Boost>();

  applied.forEach((b, i) => {
    const ids = appliedTraits[i] ?? [];
    const reaching = boosts.filter((x) => ids.some((id) => x.traitIds.has(id)));
    if (reaching.length === 0) return;

    // O estado é 重複不可 (não empilha). Entre vários, vale o maior.
    const best = reaching.reduce((m, x) => (x.rate > m.rate ? x : m));
    used.add(best);
    b.boostedFrom = b.value;
    b.value = b.value * (1 + best.rate / 100);
    b.boostedBy = `${best.source} +${best.rate}%`;
  });

  for (const x of boosts) {
    if (used.has(x)) continue;
    skipped.push({
      source: x.source,
      buffType: x.buffType,
      reason: `nothing to boost — no active buff carries ${x.traitNames}`,
    });
  }
}

/**
 * Monta os candidatos: as fontes declaradas no `BuffStack` **mais** as passivas
 * de classe, que não são declaráveis.
 *
 * Passiva de classe está sempre ativa no jogo — não se liga nem desliga, ao
 * contrário do append passive, que o jogador escolhe destravar (D8). Deixá-la a
 * cargo do chamador foi o que produziu o bug: **407 dos 462 servos** têm alguma
 * que afeta dano (349 só de Mad Enhancement, que é Buster up), e todos saíam
 * subestimados sem nenhum sintoma.
 */
function collectCandidates(input: DamageInput, data: DamageData): Candidate[] {
  const out: Candidate[] = [];
  const attacker = data.servants.get(input.attacker.servantId);
  if (!attacker) return out;

  for (const sk of attacker.classPassive) {
    for (const e of sk.effects) {
      // Passiva de classe não tem nível: o array de valores é constante.
      out.push({ effect: e, source: `${attacker.name} passive: ${sk.name}`, levelIndex: 0, fromSupport: false, fromCe: false });
    }
  }

  /**
   * A CE entra por `attacker.ce`, e **só** por ali.
   *
   * Antes eram dois lugares: `attacker.ce` dava a ATK e uma entrada `ce` no
   * `buffStack` dava os efeitos — e os dois structs nem concordavam, porque só
   * um tinha `level`. Declarar metade dava um número plausível: com o Black
   * Grail, ou faltavam 2.400 de ATK ou faltavam os +80% de dano de NP.
   *
   * Uma CE é equipamento do servo, não um buff que se liga e desliga. Fica onde
   * está o resto do que ele carrega.
   */
  const equipped = input.attacker.ce ? data.equips.get(input.attacker.ce.id) : undefined;
  if (equipped && input.attacker.ce) {
    const mlb = input.attacker.ce.mlb;
    for (const e of mlb ? equipped.effectsMlb : equipped.effectsBase) {
      out.push({ effect: e, source: `CE ${equipped.name}${mlb ? " (MLB)" : ""}`, levelIndex: 0, fromSupport: false, fromCe: true });
    }
  }

  for (const src of input.buffStack) {
    switch (src.kind) {
      case "ownSkill": {
        const sk = attacker.skills.find((s) => s.num === src.skillNum);
        if (!sk) break;
        for (const e of sk.effects) {
          out.push({ effect: e, source: `${attacker.name} skill ${src.skillNum}`, levelIndex: src.level - 1, fromSupport: false, fromCe: false });
        }
        break;
      }
      case "append": {
        const sk = attacker.appendPassive[src.num - 1];
        if (!sk) break;
        for (const e of sk.effects) {
          out.push({ effect: e, source: `${attacker.name} append ${src.num}`, levelIndex: src.level - 1, fromSupport: false, fromCe: false });
        }
        break;
      }
      case "npSelfBuff": {
        // Efeitos do NP que vêm ANTES da função de dano entram no próprio golpe
        // (D20/R20). Os de depois, não — e é por isso que a ordem é contratual.
        const np = chosenNp(attacker, input.attacker.npId);
        if (!np || np.damageEffectIndex === null) break;
        for (const e of np.effects.slice(0, np.damageEffectIndex)) {
          out.push({ effect: e, source: `${attacker.name} NP (before the damage)`, levelIndex: input.attacker.npLevel - 1, fromSupport: false, fromCe: false });
        }
        break;
      }
      case "mysticCodeSkill": {
        const equipped = input.mysticCode;
        const mc = equipped ? data.mysticCodes.get(equipped.id) : undefined;
        const sk = mc?.skills[src.index];
        if (!mc || !sk || !equipped) break;
        // `fromSupport` porque o MC é do Master, não do servo: um efeito `self`
        // dele fica no Master e não alcança quem ataca (§3.7).
        // `name`, não `shortName`: o curto é japonês e traz uma quebra de linha
        // dentro ("カルデア\n戦闘服"), que arrebentaria a linha da auditoria.
        const label = mc.name.replace(/^Mystic Code:\s*/, "");
        for (const e of sk.effects) {
          // O MC é do Master e vale para a party: um buff de alvo único dele
          // pode ser apontado para quem ataca, como o de um suporte.
          out.push({ effect: e, source: `${label} skill ${src.index + 1}`, levelIndex: equipped.level - 1, fromSupport: true, targetsAttacker: true, fromCe: false });
        }
        break;
      }
      case "support": {
        const sup = data.servants.get(src.servantId);
        if (!sup) break;
        // Tudo que vem de fora carrega `fromSupport` e o alvo pretendido; quem
        // decide o que alcança é `reachesAttacker`, num lugar só.
        const ext = { fromSupport: true, targetsAttacker: src.targetsAttacker, fromCe: false };

        for (const num of src.skills) {
          const sk = sup.skills.find((s) => s.num === num);
          if (!sk) continue;
          for (const e of sk.effects) {
            out.push({ effect: e, source: `${sup.name} skill ${num}`, levelIndex: src.skillLevel - 1, ...ext });
          }
        }

        if (src.np && sup.np) {
          /**
           * D20 vale aqui também: só o que roda **antes** da função de dano
           * entra no golpe. Mas num NP **de suporte** não existe função de dano
           * — `damageEffectIndex` é `null` —, e aí não há "depois" nenhum: tudo
           * vale. São **20 dos 47** NPs que buffam a party, e é justamente onde
           * estão Castoria e Merlin. Cortar em `null` os deixaria com zero buff.
           */
          const corte = sup.np.damageEffectIndex ?? sup.np.effects.length;
          for (const e of sup.np.effects.slice(0, corte)) {
            out.push({
              effect: e,
              source: `${sup.name} NP`,
              levelIndex: src.np.level - 1,
              overcharge: src.np.overcharge,
              ...ext,
            });
          }
        }

        if (src.ce) {
          // Efeitos só. A ATK daquela CE é do suporte — somá-la em quem ataca
          // daria +2.400 vindos do nada com um Black Grail no suporte.
          const ce = data.equips.get(src.ce.id);
          if (ce) {
            for (const e of src.ce.mlb ? ce.effectsMlb : ce.effectsBase) {
              out.push({
                effect: e,
                source: `${sup.name}'s CE ${ce.name}${src.ce.mlb ? " (MLB)" : ""}`,
                levelIndex: 0,
                ...ext,
                fromCe: true,
              });
            }
          }
        }
        break;
      }
    }
  }
  return out;
}

/**
 * Sobrescrita da matriz de classe (R22).
 *
 * A regra casa por **par de classes**, então uma mesma passiva pode trazer
 * várias linhas e nenhuma valer: a Nega-Saver da Kiara declara `assassin→ruler`
 * e `alterEgo→ruler`, e ela é alterEgo. Contra um Saber, nenhuma das duas casa —
 * e é isso que vira registro em `skipped`, para "não fez nada" ter explicação.
 *
 * `overwriteForce` é o único modo que aparece do lado do atacante hoje. O outro
 * (`overwriteMoreThanTarget`) é tratado como "vale o maior", leitura **não
 * conferida contra o jogo** por falta de caso real.
 */
function applyRelationOverrides(
  base: number,
  attackerClass: string,
  targetClass: string,
  overrides: { source: string; buffType: string; rows: ClassRelationOverride[] }[],
  skipped: SkippedBuff[],
): { triangleModifier: number; note: string | null } {
  let value = base;
  let note: string | null = null;

  for (const o of overrides) {
    const row = o.rows.find((r) => r.attackerClass === attackerClass && r.targetClass === targetClass);
    if (!row) {
      skipped.push({
        source: o.source,
        buffType: o.buffType,
        reason: `no class relation rule for ${attackerClass} vs ${targetClass}`,
      });
      continue;
    }
    const next = row.mode === "overwriteForce" ? row.rate : Math.max(value, row.rate);
    if (next === value) continue;
    note = `class advantage x${next} from ${o.source} (was x${value})`;
    value = next;
  }

  return { triangleModifier: value, note };
}

// ------------------------------------------------------------------- fórmula

const sumSlot = (buffs: ResolvedBuff[], slot: DamageSlot): number =>
  buffs.filter((b) => b.slot === slot).reduce((a, b) => a + b.value, 0) / 100;

export function calculateDamage(input: DamageInput, data: DamageData): DamageResult {
  const k = data.constants;
  const attacker = data.servants.get(input.attacker.servantId);
  if (!attacker) throw new Error(`servant ${input.attacker.servantId} is not loaded`);

  const enemyTraits = enemyTraitNames(input.enemy);

  // O card precisa ser resolvido ANTES dos buffs: as restrições `condSelf` são
  // quase todas de tipo de card, e num NP o card vem do NP, não da ação.
  const isNP = input.action.kind === "np";
  const np = chosenNp(attacker, input.attacker.npId);
  const card: CardType = isNP
    ? np?.card ?? "arts"
    : input.action.kind === "extra"
      ? "extra"
      : input.action.card ?? "arts";

  const candidates = collectCandidates(input, data);
  const { applied, skipped, unmodeled, relationOverrides } = resolveBuffs(
    candidates,
    input,
    enemyTraits,
    attacker.traits,
    card,
  );

  // ---- ATK
  const base = attacker.atkGrowth[input.attacker.level - 1] ?? 0;
  const ce = input.attacker.ce ? data.equips.get(input.attacker.ce.id) : undefined;
  // Nível omitido = o máximo daquela CE, que varia com a raridade (50 a 100).
  // Quem sabe o teto é o documento, então quem resolve é aqui — e o clamp
  // existe porque índice fora da faixa devolveria `0` de ATK em silêncio.
  const ceLevel = ce ? clampInt(input.attacker.ce?.level ?? ce.lvMax, 1, ce.atkGrowth.length) : 0;
  const ceAtk = ce ? ce.atkGrowth[ceLevel - 1] ?? 0 : 0;
  const servantAtk = base + input.attacker.fou + ceAtk;

  // ---- NP e card
  const hpPercent = clampPercent(input.attacker.hpPercent ?? 100);
  /**
   * R25: em `damageNpHpratioLow` o multiplicador tem duas parcelas — a base,
   * que escala com o nível de NP, e este bônus, que escala com **overcharge** e
   * é multiplicado pelo HP que falta. Ignorá-lo deixava o overcharge inerte nos
   * quatro servos que usam a mecânica.
   */
  const npHpBonus =
    isNP && np?.damageHpBonus
      ? ((ocValue(np.damageHpBonus, input.attacker.overcharge, input.attacker.npLevel) ?? 0) *
          (100 - hpPercent)) /
        100
      : 0;
  const npDamageMultiplier =
    isNP && np?.damageMultiplier
      ? ((np.damageMultiplier[input.attacker.npLevel - 1] ?? 0) + npHpBonus) / 100
      : 1;
  // "NP cards act as a First card of the appropriate type."
  const position = isNP ? 1 : input.action.position ?? 1;
  const cardEntry = k.cardMultiplier[card]?.[position] ?? { adjustAtk: 1, addAtk: 0 };
  /**
   * "firstCardBonus: 0.5 **if first card is a Buster card**. No bonus to NPs."
   *
   * O bônus é da **chain**, não da carta: quando a primeira é Buster, as três
   * ganham. Ler `addAtk` da carta atual dava o bônus só à Buster em primeira
   * posição — a 2ª e a 3ª de uma chain aberta em Buster saíam sem ele, e uma
   * Arts em segunda posição perdia 0,5 de um termo que vale 1,2 (R32).
   *
   * A entrada é factual: "a primeira carta foi Buster?". Quando *esta* carta é
   * a Buster de abertura, ou quando é uma Buster Chain, a resposta é sim por
   * construção e não se pergunta.
   */
  const busterOpened =
    !isNP &&
    (input.action.busterFirst === true ||
      input.action.busterChain ||
      (position === 1 && card === "buster"));
  // Do dump, não literal: `buster[1].addAtk` é onde o 0,5 mora.
  const firstCardBonus = busterOpened ? k.cardMultiplier["buster"]?.[1]?.addAtk ?? 0 : 0;
  const cardMod = sumSlot(applied, "cardMod");
  const cardTerm = firstCardBonus + cardEntry.adjustAtk * (1 + cardMod);

  // ---- multiplicadores de classe e atributo
  const classAtkBonus = k.classAttackRate[attacker.className] ?? 1;
  const triangleModifierBase =
    input.enemy.className === NEUTRAL ? 1 : k.classRelation[attacker.className]?.[input.enemy.className] ?? 1;
  const { triangleModifier, note: relationNote } = applyRelationOverrides(
    triangleModifierBase,
    attacker.className,
    input.enemy.className,
    relationOverrides,
    skipped,
  );
  const attributeModifier =
    input.enemy.attribute === NEUTRAL
      ? 1
      : k.attributeRelation[attacker.attribute]?.[input.enemy.attribute as keyof typeof k.attributeRelation] ?? 1;

  // ---- modificadores de buff
  const atkMod = sumSlot(applied, "atkMod");
  const pierce = applied.some((b) => b.slot === "pierceDefence") || (isNP && np !== null && PIERCE_FUNCS.has(np.effects[np.damageEffectIndex ?? 0]?.funcType ?? ""));
  const defBuff = sumSlot(applied, "defMod") + input.enemy.defMod / 100;
  // "Def Up (mas não Def Down) é ignorado se o NP ignora defesa."
  const defMod = pierce ? Math.min(defBuff, 0) : defBuff;

  const powerMod = sumSlot(applied, "powerMod");
  const critDamageMod = sumSlot(applied, "critDamageMod");
  const npDamageMod = sumSlot(applied, "npDamageMod");
  const specialDefMod = sumSlot(applied, "specialDefMod") + input.enemy.specialDefMod / 100;
  // `dmgPlusAdd` é o dano plano do atacante; `selfDmgCutAdd` é o corte de dano
  // do alvo, que entra negativo. Slots distintos porque os lados são distintos.
  const flatDamage =
    applied.filter((b) => b.slot === "dmgPlusAdd" || b.slot === "selfDmgCutAdd").reduce((a, b) => a + b.value, 0);

  // ---- super-efetivo
  const dmgEffect = isNP && np && np.damageEffectIndex !== null ? np.effects[np.damageEffectIndex] : undefined;
  const se = dmgEffect?.superEffective ?? null;
  /**
   * R27: em 17 NPs o bônus não vem de "o alvo tem o trait", e sim de **quantas
   * unidades** do trait existem — 〔Heroic King〕 no próprio Charlemagne,
   * queimadura no alvo do Jacques de Molay.
   *
   * A contagem vem de dois campos separados, e não de um só, porque são coisas
   * de **entidades diferentes**. Um campo único mudaria de significado conforme
   * o servo escolhido, que é exatamente o formato de defeito que este projeto
   * já pagou quatro vezes (R23, R25, R27).
   *
   * Qual dos dois vale é o **dado** que decide, por `countsOn` — nunca a tela.
   */
  const seCounts = se !== null && se.maxCount > 0;
  const seStacks = !seCounts
    ? 0
    : Math.min(
        Math.max(0, (se!.countsOn === "self" ? input.attacker.stacks : input.enemy.stacks) ?? 0),
        se!.maxCount,
      );
  const seApplies =
    se !== null && (seCounts ? seStacks > 0 : se.traits.some((t) => enemyTraits.has(t.name)));
  const superEffectiveModifier = seApplies
    ? (ocValue(se!, input.attacker.overcharge, input.attacker.npLevel) ?? 100) + se!.perCount * seStacks
    : 100;

  // ---- termos fixos
  // Duas regras do jogo sobre o que uma ação pode ser, não sobre como o dano é
  // calculado — mas moram aqui, e não na tela, para que nenhum chamador
  // (inclusive o MCP da fase 4) consiga pedir o impossível:
  //   1. um NP nunca é crítico;
  //   2. um NP nunca faz parte de uma chain, que é feita de command cards.
  const isCrit = input.action.isCrit && !isNP;
  const criticalModifier = isCrit ? k.criticalAttackRate : 1;
  const extraCardModifier =
    input.action.kind === "extra"
      ? input.action.braveChain
        ? k.extraAttackRateGrand
        : k.extraAttackRateSingle
      : 1;
  const busterChainBonus =
    input.action.kind === "card" && card === "buster" && input.action.busterChain
      ? servantAtk * k.busterChainMod
      : 0;

  const constantPart =
    servantAtk *
    npDamageMultiplier *
    cardTerm *
    classAtkBonus *
    triangleModifier *
    attributeModifier *
    k.attackRate *
    (1 + atkMod - defMod) *
    criticalModifier *
    extraCardModifier *
    (1 - specialDefMod) *
    (1 + powerMod + (isCrit ? critDamageMod : 0) + (isNP ? npDamageMod : 0)) *
    (1 + (superEffectiveModifier / 100 - 1) * (seApplies ? 1 : 0));

  const withRoll = (roll: number) => Math.max(1, Math.floor(constantPart * roll + flatDamage + busterChainBonus));

  const min = withRoll(k.randomMin);
  const avg = withRoll(1);
  const max = withRoll(k.randomMax);

  const hits = isNP && np ? np.hits : attacker.hitsDistribution[card] ?? [100];
  const chosen = input.options.rollMode === "min" ? min : input.options.rollMode === "max" ? max : avg;
  const perHit = hits.map((pct) => Math.floor((chosen * pct) / 100));

  return {
    min,
    avg,
    max,
    perHit,
    breakdown: {
      servantAtk,
      npDamageMultiplier,
      npHpBonus,
      hpPercent,
      superEffectiveStacks: seStacks,
      cardMod,
      cardTerm,
      firstCardBonus,
      classAtkBonus,
      triangleModifier,
      triangleModifierBase,
      attributeModifier,
      atkMod,
      defMod,
      powerMod,
      critDamageMod,
      npDamageMod,
      isNP,
      isCrit,
      specialDefMod,
      superEffectiveModifier,
      criticalModifier,
      extraCardModifier,
      flatDamage,
      busterChainBonus,
      pierceDefence: pierce,
    },
    assumptions: {
      rollMode: input.options.rollMode,
      resolved: [
        `${attacker.name} lv${input.attacker.level}`,
        `${input.attacker.fou} fou`,
        `NP${input.attacker.npLevel}`,
        `OC${input.attacker.overcharge}`,
        ...(hpPercent < 100 ? [`at ${hpPercent}% HP`] : []),
        `vs ${input.enemy.className}/${input.enemy.attribute}`,
        input.action.kind === "np" ? "NP" : `card ${card} pos${position}`,
        ...(isCrit ? ["critical"] : []),
        ...(seApplies ? [`super effective ${superEffectiveModifier}%`] : []),
        // Um NP que soma até 220% por stack não pode devolver o número de zero
        // stacks calado (R27). Com zero a linha vira o convite para informar.
        ...(seCounts
          ? [
              countPhrase(se!, seStacks) +
                (seStacks > 0 ? ` (+${se!.perCount * seStacks}% super effective)` : " — none counted"),
            ]
          : []),
        ...(relationNote ? [relationNote] : []),
      ],
      appliedBuffs: applied,
      skippedBuffs: skipped,
      // Chance < 100% nunca filtra: quem compõe o stack decide (D18/§4.5).
      uncertainBuffs: applied
        .filter((b) => b.chance < 100)
        .map((b) => ({ source: b.source, buffType: b.buffType, chance: b.chance })),
      unmodeled,
    },
  };
}
