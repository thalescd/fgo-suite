/**
 * Validação dos artefatos gerados contra valores conhecidos do jogo.
 *
 * Roda depois de `data:build`. Serve para dois momentos:
 *   1. Agora, provando que a ingestão está correta.
 *   2. Depois de cada `data:sync`, detectando se o Atlas mudou de formato —
 *      uma quebra silenciosa apareceria aqui antes de virar número errado.
 *
 * Todo valor esperado abaixo tem procedência: ou é conhecido do jogo
 * (Excalibur NP1 = 400%), ou foi medido no dump e registrado em PLANO.md.
 *
 * Contagens que crescem com o roster NÃO são `check`: são `census`, comparadas
 * contra `data/census.json` pelas regras de `census.ts`. Um patch novo do jogo
 * não quebra a validação; uma contagem que encolhe, sim.
 *
 *   --accept   grava o censo mesmo com regressão (mudança legítima e conferida).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Constants, CraftEssence, IndexEntry, IndexEntryServant, Meta, Servant } from "../core/model.js";
import { type CensusEntry, type CensusFile, compareCensus, toCensusFile } from "./census.js";
import { OUT_DIR } from "./sources.js";

const CENSUS_PATH = "data/census.json";
const ACCEPT = process.argv.includes("--accept");

const read = async <T>(rel: string): Promise<T> =>
  JSON.parse(await readFile(join(OUT_DIR, rel), "utf8")) as T;

let pass = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}\n      obtido:   ${a}\n      esperado: ${e}`);
    console.log(`  ✗ ${label}  ->  ${a}  (esperado ${e})`);
  }
}

const censusEntries: CensusEntry[] = [];

/** Contagem do roster: registrada aqui, comparada no fim contra o censo. */
function census(key: string, label: string, value: CensusEntry["value"], onGrowth?: string): void {
  censusEntries.push({ key, label, value, onGrowth });
  console.log(`  # ${label}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`);
}

async function main(): Promise<void> {
  const meta = await read<Meta>("meta.json");
  const index = await read<IndexEntry[]>("index.json");
  const constants = await read<Constants>("constants.json");
  const traits = await read<{ id: number; name: string; uses: number }[]>("traits.json");

  const servants = index.filter((e): e is IndexEntryServant => e.kind === "servant");
  const equips = index.filter((e) => e.kind === "equip");
  const byCn = (cn: number) => servants.find((s) => s.collectionNo === cn)!;
  const servant = (id: number) => read<Servant>(`servant/${id}.json`);

  console.log(`Validando build de ${meta.builtAt} (gamedata ${meta.gameDataHash})\n`);

  console.log("Contagens (censo)");
  check("o índice tem todos os servos que o meta conta", servants.length, meta.counts.servants);
  check("e todas as CEs", equips.length, meta.counts.craftEssences);
  census("servants", "servos no índice (jogáveis menos formas de combate)", meta.counts.servants);
  census("lastCollectionNo", "maior collectionNo", Math.max(...servants.map((s) => s.collectionNo)));
  census("combatForms", "formas de combate fora do índice", meta.counts.combatForms);
  census("craftEssencesCombat", "CEs de combate", equips.filter((e) => e.kind === "equip" && e.category === "combat").length);
  census("craftEssencesFarm", "CEs de farm", equips.filter((e) => e.kind === "equip" && e.category === "farm").length);
  census("craftEssencesDropped", "CEs inertes descartadas", meta.counts.craftEssencesDropped);
  census("mysticCodes", "mystic codes", meta.counts.mysticCodes);
  census("welfare", "servos welfare no índice", servants.filter((s) => s.isWelfare).length);

  console.log("\nR7 — atkGrowth substitui atkMax");
  const artoria = await servant(byCn(2).id);
  check("Artoria atkGrowth tem 120 entradas", artoria.atkGrowth.length, 120);
  check("ATK lv90 = 11221 (o antigo atkMax)", artoria.atkGrowth[89], 11221);
  check("ATK lv120 = 14418 (28% maior)", artoria.atkGrowth[119], 14418);
  check("atkAtDefault = lv90 + 1000 fou", byCn(2).atkAtDefault, 12221);
  check("campo atkMax não existe no canônico", "atkMax" in artoria, false);

  console.log("\nUnidades");
  check("Excalibur NP1..NP5 em % (/10)", artoria.np?.damageMultiplier, [400, 500, 550, 575, 600]);
  check("deck da Artoria = QAABB", artoria.cards, ["quick", "arts", "arts", "buster", "buster"]);
  check("Excalibur card resolvido", artoria.np?.card, "buster");
  check("Excalibur target = aoe", artoria.np?.target, "aoe");

  const koyan = await servant(byCn(314).id);
  const gainNp = koyan.skills.find((s) => s.num === 1)?.effects.find((e) => e.funcType === "gainNp");
  check("gainNp da Koyanskaya lv10 = 50% (/100, divisor diferente)", gainNp?.values[9], 50);

  console.log("\nR8 — rank ups e NPs múltiplos");
  check("Artoria tem 1 NP alternativo", artoria.npAlternatives.length, 1);
  check("o alternativo é o pré-upgrade (300%)", artoria.npAlternatives[0]?.damageMultiplier?.[0], 300);
  let withRankUp = 0;
  for (const s of servants) {
    const f = await servant(s.id);
    if (f.skills.some((k) => k.previousVersions)) withRankUp++;
  }
  // R8 cita 245 de 466 porque conta as formas de combate; o censo conta o índice.
  census("servantsWithSkillRankUp", "servos com rank up de skill", withRankUp);

  console.log("\nR11 — condições de card e alvo");
  const cmd = koyan.skills.find((s) => s.num === 3)?.effects.find((e) => e.buffType === "upCommandall");
  check("upCommandall lv10 = 50%", cmd?.values[9], 50);
  check("condSelf preservado = cardBuster", cmd?.condSelf.map((t) => t.name), ["cardBuster"]);
  const sk2 = koyan.skills.find((s) => s.num === 2);
  check(
    "skill 2 distingue human de attributeHuman",
    sk2?.effects.filter((e) => e.condTarget.length > 0).map((e) => e.condTarget[0]?.name),
    ["human", "attributeHuman"],
  );

  console.log("\nR13 — CE base vs MLB");
  const kaleidId = equips.find((e) => e.collectionNo === 34)!.id;
  const kaleid = await read<CraftEssence>(`equip/${kaleidId}.json`);
  check("Kaleidoscope base = 80% de NP", kaleid.effectsBase[0]?.values[0], 80);
  check("Kaleidoscope MLB = 100% de NP", kaleid.effectsMlb[0]?.values[0], 100);

  // Os dois slots aditivos da fórmula não são percentuais: `damage_formula.txt`
  // diz "Note the lack of %". O `/10` que vale para todo buff os deixava dez
  // vezes menores, e 17,5 de Divinity é plausível demais para levantar suspeita.
  console.log("\nValores planos — buffs sem %");
  const gilDiv = (await read<Servant>(`servant/${byCn(12).id}.json`)).classPassive
    .flatMap((s) => s.effects)
    .find((e) => e.buffType === "addDamage");
  check("Divinity B do Gilgamesh = 175 de dano plano", gilDiv?.values[0], 175);
  check("e a unidade diz que é plano, não percentual", gilDiv?.valueUnit, "flat");
  check("Divinity é modelada, não 'NOT MODELLED'", gilDiv?.supported, true);
  const musashiCut = (await read<Servant>(`servant/${byCn(153).id}.json`)).skills
    .flatMap((s) => s.effects)
    .find((e) => e.buffType === "subSelfdamage");
  check("Fifth Force da Musashi = 1000 de corte de dano", musashiCut?.values[9], 1000);

  // R27 — o multiplicador super-efetivo muda de campo conforme a família.
  // Um multiplicador zero não erra por pouco: zera o produto inteiro.
  console.log("\nSuper-efetivo por soma (R27)");
  const seOf = async (cn: number) => {
    const s = await read<Servant>(`servant/${byCn(cn).id}.json`);
    return s.np?.effects[s.np.damageEffectIndex ?? -1]?.superEffective;
  };
  const musashiSe = await seOf(153);
  check("Musashi: multiplicador vem de Value2 = 150%", musashiSe?.values[0], 150);
  check("e Correction, que é 0, não virou multiplicador", musashiSe?.perCount, 0);
  check("Target não entra como trait: só os dois da TargetList", musashiSe?.traits.map((t) => t.name), [
    "classAlterEgo",
    "classMoonCancer",
  ]);
  const charlemagneSe = await seOf(343);
  check("Charlemagne: base neutra de 100%", charlemagneSe?.values[0], 100);
  check("mais 10% por stack, até 12", [charlemagneSe?.perCount, charlemagneSe?.maxCount], [10, 12]);
  check("contados nele mesmo, não no alvo", charlemagneSe?.countsOn, "self");
  const gilSe = await seOf(12);
  check("Gilgamesh (outra família) continua vindo de Correction = 150%", gilSe?.values[0], 150);

  // R28 — o multiplicador de NP vai direto para a fórmula, e ninguém consulta
  // `valueUnit` no caminho. `funcType` fora da tabela de divisores deixava o
  // valor cru: 4500% em vez de 450%, dano 10x, sem sintoma nenhum.
  console.log("\nR28 — todo multiplicador de NP tem unidade conhecida");
  const semUnidade: string[] = [];
  for (const s of servants) {
    const f = await servant(s.id);
    for (const np of [f.np, ...f.npAlternatives].filter((n) => n != null)) {
      if (np!.damageEffectIndex === null) continue;
      const e = np!.effects[np!.damageEffectIndex!];
      if (e && e.valueUnit !== "percent") semUnidade.push(`${f.name}/${e.funcType}`);
    }
  }
  check("nenhum NP de dano com unidade desconhecida", semUnidade, []);
  const eresh = await read<Servant>(`servant/${byCn(417).id}.json`);
  check("Ereshkigal NP1..NP5 = 450..750%, não 4500..7500", eresh.np?.damageMultiplier, [450, 600, 675, 712.5, 750]);
  const xx = await read<Servant>(`servant/${byCn(423).id}.json`);
  check("Heroine XX (Alter), o outro caso, = 600..1000%", xx.np?.damageMultiplier, [600, 800, 900, 950, 1000]);

  // R33 — a mesma Ereshkigal, o outro campo. O teto vem de `battlePoints`, que
  // é o único lugar do dump onde ele existe; sem ele o contador não aparece.
  console.log("\nR33 — fase de medidor");
  const ereshSe = eresh.np?.effects[eresh.np.damageEffectIndex ?? -1]?.superEffective;
  check(
    "base neutra, +10% por fase, teto 10, contado nela",
    [ereshSe?.values[0], ereshSe?.perCount, ereshSe?.maxCount, ereshSe?.countsOn],
    [100, 10, 10, "self"],
  );
  // O teto vem de `battlePoints`, único lugar do dump onde ele existe. Sem ele
  // `maxCount` seria 0, e `maxCount > 0` é o que faz o contador aparecer.
  check("sem trait para nomear: o rótulo são os tiers", [ereshSe?.traits, ereshSe?.countLabel], [
    [], "Mate/Buddy/Darling/Destiny",
  ]);
  // Um medidor a mais no dump é mecânica nova para conferir, não regressão —
  // por isso a lista é censo com aviso, e não escondida numa desigualdade.
  const comMedidor: string[] = [];
  for (const s of servants) {
    const f = await servant(s.id);
    for (const np of [f.np, ...f.npAlternatives].filter((x) => x != null)) {
      const se = np!.effects[np!.damageEffectIndex ?? -1]?.superEffective;
      if (se?.countLabel != null) comMedidor.push(f.name);
    }
  }
  check("a Ereshkigal tem medidor no NP e no rank up", comMedidor.filter((n) => n === "Ereshkigal").length, 2);
  census(
    "npsWithGauge",
    "NPs com medidor de fase",
    comMedidor,
    "medidor novo é mecânica nova: confira o superEffective dele na calculadora",
  );

  // Asset ausente não quebra nada — a tela só não mostra imagem —, então o
  // erro sobreviveu desde a fase 0: `toMysticCode` lia `charaGraph`, que é
  // campo de servo e não existe em Mystic Code. Os 28 vinham com `null`.
  console.log("\nAssets de Mystic Code");
  const mcs = await read<{ id: number; name: string; assets: { male: string | null; female: string | null } }[]>(
    "mysticCodes.json",
  );
  check("todos têm ícone para os dois gêneros", mcs.filter((m) => m.assets.male && m.assets.female).length, mcs.length);
  check(
    "e o ícone é o do equipamento, não a figura inteira",
    /\/Items\/masterequip/.test(mcs.find((m) => m.id === 20)?.assets.male ?? ""),
    true,
  );

  console.log("\nOvercharge — svals2..svals5");
  const nero = await servant(byCn(5).id);
  const defDown = nero.np?.effects.find((e) => e.buffType === "downDefence");
  check("Nero: NP tem efeito que escala com overcharge", defDown?.valuesByOvercharge !== null, true);
  check(
    "Nero downDefence OC1..OC5 em NP1 = 20..40%",
    defDown?.valuesByOvercharge?.map((r) => r[0]),
    [20, 25, 30, 35, 40],
  );
  check("linha OC1 é idêntica a `values`", defDown?.valuesByOvercharge?.[0], defDown?.values);
  const nptDmg = nero.np?.effects.find((e) => e.funcType.startsWith("damageNp"));
  check("dano do NP da Nero NÃO escala com OC (fica null)", nptDmg?.valuesByOvercharge, null);
  let ocScaling = 0;
  let ocTotal = 0;
  for (const s of servants) {
    const f = await servant(s.id);
    for (const e of f.np?.effects ?? []) {
      ocTotal++;
      if (e.valuesByOvercharge) ocScaling++;
    }
  }
  // Se o Atlas mover `svals2..5`, `ocScaling` despenca — e o censo recusa.
  census("npEffects", "efeitos de NP", ocTotal);
  census("npEffectsScalingWithOc", "efeitos de NP que escalam com overcharge", ocScaling);

  console.log("\nOrdem de execução do NP");
  const gilOrder = await servant(byCn(12).id);
  check("Gilgamesh: buff no índice 0, dano no 1", gilOrder.np?.damageEffectIndex, 1);
  check(
    "o efeito antes do dano é o upNpdamage nele mesmo",
    gilOrder.np?.effects[0] && [gilOrder.np.effects[0].buffType, gilOrder.np.effects[0].target],
    ["upNpdamage", "self"],
  );
  const artOrder = await servant(byCn(2).id);
  check("Artoria: dano no índice 0, refund só depois", artOrder.np?.damageEffectIndex, 0);
  check("o efeito depois do dano é o gainNp", artOrder.np?.effects[1]?.funcType, "gainNp");
  let withPre = 0;
  let dmgNps = 0;
  for (const s of servants) {
    const f = await servant(s.id);
    const i = f.np?.damageEffectIndex;
    if (i === null || i === undefined) continue;
    dmgNps++;
    if (i > 0) withPre++;
  }
  census("damageNps", "NPs de dano", dmgNps);
  census("damageNpsWithPreEffect", "NPs de dano com efeito antes do golpe", withPre);

  console.log("\nSuper-efetivo — Target/TargetList + Correction");
  const gil = await servant(byCn(12).id);
  const se = gil.np?.effects.find((e) => e.superEffective)?.superEffective;
  check("Gilgamesh: trait alvo resolvido a partir do id", se?.traits.map((t) => t.name), ["weakToEnumaElish"]);
  check(
    "multiplicador OC1..OC5 em NP1 = 150..200%",
    se?.valuesByOvercharge?.map((r) => r[0]),
    [150, 162.5, 175, 187.5, 200],
  );
  let seCount = 0;
  let seOc = 0;
  let seZero = 0;
  for (const s of servants) {
    const f = await servant(s.id);
    for (const e of f.np?.effects ?? []) {
      if (!e.superEffective) continue;
      seCount++;
      if (e.superEffective.valuesByOvercharge) seOc++;
      if (e.superEffective.traits.some((t) => t.id === 0)) seZero++;
    }
  }
  // Histórico (gamedata 489221): o número foi de 139 a 138 no R27 e voltou a
  // 139 no R33, pela **mesma** Ereshkigal — e as duas mexidas estavam certas.
  // R27 tirou porque `Correction` ali não é multiplicador super-efetivo, e
  // mantê-la era leitura errada. R33 devolveu porque ela **tem** um bônus que
  // cresce, só que por fase de medidor, com o teto vindo de `battlePoints`. O OC
  // subiu de 69 para 72 no R27: `Value2` varia com OC em 3 dos 21 da família
  // soma, `Correction` em nenhum. Mudanças de código assim, com o mesmo
  // gamedata, são exatamente o que o censo recusa até alguém aceitar.
  census("superEffectiveNps", "efeitos de NP super-efetivos", seCount);
  census("superEffectiveNpsScalingWithOc", "super-efetivos escalando com OC", seOc);
  check("nenhum trait placeholder id 0 sobrou", seZero, 0);

  console.log("\n§3.4.2 — buff que multiplica buff (R21)");
  // Sem estes campos a skill 3 do Oberon vira "buff não modelado" e o dano dele
  // sai pela metade — sem sintoma, porque o número continua plausível.
  const oberon = await servant(byCn(316).id);
  const boost = oberon.skills.find((s) => s.num === 3)?.effects.find((e) => e.boostsBuffTraits !== null);
  check("Oberon skill 3 traz o boost", boost?.buffType, "buffRate");
  check("multiplica buffNpDamageUp", boost?.boostsBuffTraits?.map((t) => t.name), ["buffNpDamageUp"]);
  check("100% no nível 10 (dobra)", boost?.values[9], 100);
  const npUp = oberon.skills.find((s) => s.num === 1)?.effects.find((e) => e.buffType === "upNpdamage");
  check("o buff alvo carrega o trait que o boost procura",
    npUp?.buffTraits.some((t) => t.name === "buffNpDamageUp"), true);

  console.log("\n§3.4.3 — sobrescrita da matriz de classe (R22)");
  // Sem `atkSide` a Kiara perde 1/3 do dano dela contra Ruler, sem sintoma.
  const kiara = await servant(byCn(167).id); // a alterEgo; a moonCancer é a 285
  const negaSaver = kiara.classPassive
    .flatMap((sk) => sk.effects)
    .find((e) => e.classRelationOverrides !== null)
    ?.classRelationOverrides?.find((r) => r.attackerClass === "alterEgo");
  check("Kiara: Nega-Saver sobrescreve alterEgo -> ruler", negaSaver?.targetClass, "ruler");
  check("para 1,5x, em modo overwriteForce", [negaSaver?.rate, negaSaver?.mode], [1.5, "overwriteForce"]);
  // A passiva de classe precisa existir no documento para a calculadora achá-la.
  const herc = await servant(byCn(47).id);
  check("Heracles: Mad Enhancement é passiva de classe",
    herc.classPassive.flatMap((sk) => sk.effects).some((e) => e.buffType === "upCommandall"), true);

  console.log("\nFormas de combate");
  const jekyll = await servant(600700);
  const hyde = await read<Servant>("servant/600710.json");
  check("Hyde fora do índice", servants.filter((s) => s.id === 600710).length, 0);
  check("só uma Aozaki Aoko no índice", servants.filter((s) => s.name === "Aozaki Aoko").length, 1);
  check("nenhum collectionNo 0 sobra no índice", servants.filter((s) => s.collectionNo === 0).length, 0);
  check("Jekyll aponta para a forma Hyde", jekyll.combatForms, [600710]);
  check("Hyde continua existindo como artefato", hyde.className, "berserker");
  check("Hyde aponta de volta para o base", hyde.combatFormOf, 600700);
  check("o base não é forma de ninguém", jekyll.combatFormOf, null);

  console.log("\n§5.6 — welfare e NP level");
  check("welfare 5★ = Solomon", servants.find((s) => s.isWelfare && s.rarity === 5)?.name, "Solomon");
  check("1 servo rarity 0 (Aŋra Mainiiu)", servants.filter((s) => s.rarity === 0).length, 1);
  const npLevel = (s: IndexEntryServant) => (s.rarity <= 3 || s.isWelfare ? 5 : 1);
  check("Solomon -> NP5 (welfare vence raridade)", npLevel(servants.find((s) => s.name === "Solomon")!), 5);
  check("Artoria 5★ -> NP1", npLevel(byCn(2)), 1);

  // R30 — o limiar de HP mora em `buff.script`, não em `svals`, que é onde vive
  // a outra metade da mecânica (R25). São poucos, e "poucos" é justamente o que
  // faz um campo perdido passar em silêncio: sem limiar o buff fica sempre
  // ligado, e sempre ligado é o valor máximo — um número plausível.
  console.log("\nR30 — limiar de HP");
  const ciel = await servant(byCn(418).id);
  const critGates = ciel.skills
    .find((s) => s.num === 2)!
    .effects.filter((e) => e.buffType === "upCriticaldamage")
    .map((e) => e.hpGate);
  check("C.I.E.L: duas camadas de crítico, 50% e 100%", critGates, [
    { kind: "atLeast", percent: 50 },
    { kind: "atLeast", percent: 100 },
  ]);
  const aesc = await servant(byCn(385).id);
  check(
    "Aesc: quatro camadas de ataque, no sentido inverso",
    aesc.skills.find((s) => s.num === 2)!.effects.filter((e) => e.hpGate?.kind === "atMost").map((e) => e.hpGate!.percent),
    [99, 75, 50, 25],
  );
  check("buff sem limiar continua sem o campo", artoria.skills[0]!.effects[0]!.hpGate, null);

  // R31 — `functvals` filtra quem RECEBE o efeito. Os três checks prendem as
  // três decisões que o dado impôs: a condição existe ao lado de um efeito
  // gêmeo sem condição, ela é OR, e ela casa por id.
  console.log("\nR31 — condição de quem recebe");
  const medb = await servant(byCn(99).id);
  check(
    "Medb: um upAtk para todos e outro só 〔genderMale〕",
    medb.skills.find((s) => s.num === 2)!.effects
      .filter((e) => e.buffType === "upAtk")
      .map((e) => `${e.target}:${e.condFunc.map((t) => t.name).join("+") || "-"}`),
    ["ptAll:-", "ptOther:genderMale"],
  );
  const hans = await servant(byCn(33).id);
  check(
    "Hans exige três alinhamentos que se excluem — logo é OR",
    hans.skills.find((s) => s.num === 1)!.effects.find((e) => e.condFunc.length === 3)!.condFunc.map((t) => t.name),
    ["alignmentGood", "alignmentBalanced", "alignmentEvil"],
  );
  // O Jekyll exige o id da forma Hyde num trait chamado "unknown", e os DOIS
  // servos carregam um trait com esse nome — com ids diferentes. Casar por nome
  // aplicaria o buff no Jekyll, que é o oposto do que a skill faz.
  check("Jekyll exige o trait 600710, sem nome",
    hyde.skills.find((s) => s.num === 3)!.effects.find((e) => e.condFunc.length > 0)!.condFunc,
    [{ id: 600710, name: "unknown" }]);
  check("e só a forma Hyde carrega esse id", [
    hyde.traits.some((t) => t.id === 600710),
    jekyll.traits.some((t) => t.id === 600710),
  ], [true, false]);

  console.log("\nR9 — identidade");
  check("displayName único para todos", new Set(servants.map((s) => s.displayName)).size, servants.length);
  check("displayName desambiguado", byCn(2).displayName, "Altria Pendragon (saber, 5★)");
  check("apelidos curados carregados", byCn(150).aliases.includes("Merlin"), true);
  check("displayName do Hyde distingue do base", hyde.displayName !== jekyll.displayName, true);

  console.log("\nConstantes da fórmula");
  check("ATTACK_RATE = 0.23", constants.attackRate, 0.23);
  check("critical = 2.0", constants.criticalAttackRate, 2);
  check("random 0.9–1.1", [constants.randomMin, constants.randomMax], [0.9, 1.1]);
  check("buster chain = 0.2", constants.busterChainMod, 0.2);
  check(
    "buster 1.5/1.8/2.1 + firstCardBonus 0.5",
    [1, 2, 3].map((p) => constants.cardMultiplier.buster[p]!.adjustAtk).concat(constants.cardMultiplier.buster[1]!.addAtk),
    [1.5, 1.8, 2.1, 0.5],
  );
  check("quick 0.8/0.96/1.12", [1, 2, 3].map((p) => constants.cardMultiplier.quick[p]!.adjustAtk), [0.8, 0.96, 1.12]);
  check("saber -> lancer = 2.0", constants.classRelation.saber?.lancer, 2);
  check("saber -> archer = 0.5", constants.classRelation.saber?.archer, 0.5);
  check("berserker -> beastI = 1.5", constants.classRelation.berserker?.beastI, 1.5);
  check("human -> sky = 1.1", constants.attributeRelation.human.sky, 1.1);

  console.log("\nCatálogo de traits");
  // 89 até a fase 3, quando `superEffective.traits` e os efeitos de CE/Mystic Code
  // entraram no catálogo: sem eles não havia como declarar o alvo de um NP
  // super-efetivo.
  // 101 depois de R27: o trait do super-efetivo pode descrever o ATACANTE na
  // família soma, e sete descrevem. `buffNegativeEffect` já saía pelo filtro
  // `^buff`; os outros seis (os cinco de `traitNames.json` mais `magicBullet`
  // da Aoko e `manuscriptComplete` da Chloe) eram oferecidos como filtro de
  // inimigo sem que inimigo nenhum pudesse carregá-los.
  // (101 na época do R27; agora é censo — servo novo traz trait novo.)
  census("enemyTraits", "traits de identidade do inimigo", traits.length);
  check("stack do atacante não entra no catálogo", traits.some((t) => t.name === "Heroic King"), false);
  check("mas stack contado no alvo entra", traits.some((t) => t.name === "Past Alteration"), true);
  check("ordenado por frequência", traits[0]!.uses >= traits[traits.length - 1]!.uses, true);
  // O caso que motivou a inclusão: o Enuma Elish do Gilgamesh.
  check("weakToEnumaElish está no catálogo", traits.some((t) => t.name === "weakToEnumaElish"), true);

  console.log();
  const ok = reportCensus(meta, servants);
  if (failures.length) {
    console.log(`${failures.length} FALHA(S):\n`);
    for (const f of failures) console.log(`  ✗ ${f}\n`);
    console.log("Estes são fatos do jogo, não tamanho do roster: um valor que mudou aqui");
    console.log("é o Atlas mudando de formato ou o jogo rebalanceando. Confira antes de mexer.");
    process.exit(1);
  }
  if (!ok) process.exit(1);
  console.log(`Todos os ${pass} checks passaram; censo com ${censusEntries.length} contagens.`);
}

/** Compara o censo, grava quando cabe, e diz se a validação pode passar. */
function reportCensus(meta: Meta, servants: IndexEntryServant[]): boolean {
  const prev = existsSync(CENSUS_PATH) ? (JSON.parse(readFileSync(CENSUS_PATH, "utf8")) as CensusFile) : null;
  const diff = compareCensus(prev, censusEntries, meta.gameDataHash);
  const from = prev ? prev.gameDataHash : "—";

  if (diff.growth.length) {
    console.log(`Novidades do dump (gamedata ${from} -> ${meta.gameDataHash}):\n`);
    for (const g of diff.growth) console.log(`  + ${g}`);
    const lastCn = prev?.counts.lastCollectionNo;
    if (typeof lastCn === "number") {
      const fresh = servants.filter((s) => s.collectionNo > lastCn).sort((a, b) => a.collectionNo - b.collectionNo);
      if (fresh.length) {
        console.log("\n  Servos novos:");
        for (const s of fresh) console.log(`    ${s.collectionNo}  ${s.displayName}`);
      }
    }
    console.log();
  }
  for (const n of diff.notes) console.log(`  · ${n}`);
  if (diff.notes.length) console.log();

  if (diff.regressions.length) {
    console.log(`${diff.regressions.length} contagem(ns) do censo REGREDIRAM:\n`);
    for (const r of diff.regressions) console.log(`  ✗ ${r}`);
    console.log();
    console.log("Contagem que encolhe costuma ser o Atlas mudando de formato: um campo renomeado");
    console.log("zera o que dependia dele. Confira. Se a mudança for legítima (o código passou a");
    console.log("contar diferente de propósito), aceite com:  npm run data:validate -- --accept\n");
  }

  const changed = !prev || diff.growth.length > 0 || diff.notes.length > 0 || prev.gameDataHash !== meta.gameDataHash;
  const canWrite = failures.length === 0 && (diff.regressions.length === 0 || ACCEPT);
  if (canWrite && (changed || (ACCEPT && diff.regressions.length))) {
    writeFileSync(CENSUS_PATH, `${JSON.stringify(toCensusFile(censusEntries, meta.gameDataHash, meta.builtAt), null, 2)}\n`);
    console.log(`${CENSUS_PATH} atualizado — faça commit dele junto com raw/manifest.json.\n`);
  }
  return diff.regressions.length === 0 || ACCEPT;
}

main().catch((err: unknown) => {
  console.error(`\nErro: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
