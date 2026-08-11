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
  check("466 servos jogáveis", meta.counts.servants, 466);
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
  check("245 servos com rank up de skill", withRankUp, 245);

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

  console.log("\n§5.6 — welfare e NP level");
  check("57 servos welfare (nice_servant; o basic diz 56)", servants.filter((s) => s.isWelfare).length, 57);
  check("welfare 5★ = Solomon", servants.find((s) => s.isWelfare && s.rarity === 5)?.name, "Solomon");
  check("1 servo rarity 0 (Aŋra Mainiiu)", servants.filter((s) => s.rarity === 0).length, 1);
  const npLevel = (s: IndexEntryServant) => (s.rarity <= 3 || s.isWelfare ? 5 : 1);
  check("Solomon -> NP5 (welfare vence raridade)", npLevel(servants.find((s) => s.name === "Solomon")!), 5);
  check("Artoria 5★ -> NP1", npLevel(byCn(2)), 1);

  console.log("\nR9 — identidade");
  check("displayName único para todos", new Set(servants.map((s) => s.displayName)).size, servants.length);
  check("displayName desambiguado", byCn(2).displayName, "Altria Pendragon (saber, 5★)");
  check("apelidos curados carregados", byCn(150).aliases.includes("Merlin"), true);
  check("4 servos com collectionNo 0", servants.filter((s) => s.collectionNo === 0).length, 4);

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
  check("89 traits de identidade", traits.length, 89);
  check("ordenado por frequência", traits[0]!.uses >= traits[traits.length - 1]!.uses, true);

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
