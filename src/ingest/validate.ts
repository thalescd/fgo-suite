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
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Constants, CraftEssence, IndexEntry, IndexEntryServant, Meta, Servant } from "../core/model.js";
import { OUT_DIR } from "./sources.js";

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

  console.log("Contagens");
  check("462 servos no índice (466 jogáveis menos 4 formas de combate)", meta.counts.servants, 462);
  check("4 formas de combate fora do índice", meta.counts.combatForms, 4);
  check("536 CEs inertes descartadas", meta.counts.craftEssencesDropped, 536);
  check("28 mystic codes", meta.counts.mysticCodes, 28);

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
  // 243 no índice; 245 contando as 4 formas de combate, que é o número citado em R8.
  check("243 servos com rank up de skill no índice", withRankUp, 243);

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

  // Asset ausente não quebra nada — a tela só não mostra imagem —, então o
  // erro sobreviveu desde a fase 0: `toMysticCode` lia `charaGraph`, que é
  // campo de servo e não existe em Mystic Code. Os 28 vinham com `null`.
  console.log("\nAssets de Mystic Code");
  const mcs = await read<{ id: number; name: string; assets: { male: string | null; female: string | null } }[]>(
    "mysticCodes.json",
  );
  check("os 28 têm ícone para os dois gêneros", mcs.filter((m) => m.assets.male && m.assets.female).length, 28);
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
  // 443/1855 nos 462 do índice; 446/1878 contando as 4 formas de combate.
  check("443 de 1855 efeitos de NP escalam com overcharge (índice)", [ocScaling, ocTotal], [443, 1855]);

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
  // 411/237 nos 462 do índice; 413/238 contando as 4 formas de combate.
  check("411 NPs de dano no índice, 237 com efeito antes do golpe", [dmgNps, withPre], [411, 237]);

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
  // 138/72 nos 462 do índice; as formas de combate somam mais alguns.
  //
  // Era 139/69 antes de R27, e os dois deltas se explicam: a Ereshkigal saiu
  // (o `damageNpBattlePointPhase` dela não é super-efetivo, era leitura errada
  // de `Correction`), e três NPs da família soma entraram no grupo que escala
  // com overcharge — `Value2` varia com OC em 3 dos 21, `Correction` em nenhum.
  check("138 NPs com super-efetivo no índice, 72 escalando com OC", [seCount, seOc], [138, 72]);
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
  check("56 welfare no índice — mesmo recorte do basic_servant", servants.filter((s) => s.isWelfare).length, 56);
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
  check("101 traits de identidade do inimigo", traits.length, 101);
  check("stack do atacante não entra no catálogo", traits.some((t) => t.name === "Heroic King"), false);
  check("mas stack contado no alvo entra", traits.some((t) => t.name === "Past Alteration"), true);
  check("ordenado por frequência", traits[0]!.uses >= traits[traits.length - 1]!.uses, true);
  // O caso que motivou a inclusão: o Enuma Elish do Gilgamesh.
  check("weakToEnumaElish está no catálogo", traits.some((t) => t.name === "weakToEnumaElish"), true);

  console.log();
  if (failures.length) {
    console.log(`${failures.length} FALHA(S):\n`);
    for (const f of failures) console.log(`  ✗ ${f}\n`);
    console.log("Se o Atlas mudou de propósito, atualize o valor esperado E o documento que o cita.");
    process.exit(1);
  }
  console.log(`Todos os ${pass} checks passaram.`);
}

main().catch((err: unknown) => {
  console.error(`\nErro: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
