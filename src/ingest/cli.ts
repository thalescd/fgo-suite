/**
 * CLI da ingestão.
 *
 *   npm run data:check   HEAD em cada arquivo + /info. Não baixa. Custa alguns KB.
 *   npm run data:sync    GET condicional. Só baixa o que mudou.
 *   npm run data:build   raw/ -> public/data/
 */

import { build } from "./build.js";
import { check, reportCheck, sync } from "./sync.js";

const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case "check": {
      reportCheck(await check());
      break;
    }

    case "sync": {
      await sync();
      break;
    }

    case "build": {
      const s = await build();
      console.log();
      console.log("Artefatos gerados em public/data/");
      console.log(`  servos            ${s.servants}`);
      console.log(`  craft essences    ${s.equipsCombat + s.equipsFarm}  (combat ${s.equipsCombat} · farm ${s.equipsFarm})`);
      console.log(`  CEs descartadas   ${s.equipsDropped}  (inertes)`);
      console.log(`  mystic codes      ${s.mysticCodes}`);
      console.log(`  traits catalogados${String(s.traitCatalog).padStart(4)}`);
      if (s.displayNameCollisions) {
        console.log(`  colisões de nome  ${s.displayNameCollisions} (resolvidas com sufixo numérico)`);
      }
      if (s.warnings.length) {
        console.log();
        console.log("Avisos:");
        for (const w of s.warnings) console.log(`  ⚠ ${w}`);
      }
      break;
    }

    default:
      console.error("uso: cli.ts <check|sync|build>");
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(`\nErro: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
