/**
 * Servidor MCP — casca fina sobre `core/`, falando stdio.
 *
 * A regra que organiza o arquivo: **a descrição de cada tool é a documentação
 * inteira que o assistente recebe.** Ele não lê este código, nem o PLANO, nem o
 * SCHEMA — só o nome, a descrição e o JSON Schema dos parâmetros. Uma descrição
 * preguiçosa não é falta de capricho, é o modelo chutando argumento.
 *
 * Por isso cada `description` diz o que a tool devolve, o que ela assume por
 * padrão e o que ela **não** modela. Em inglês, como todo texto que atravessa a
 * fronteira do projeto.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { Store } from "./store.js";
import {
  calculateDamageTool,
  getServant,
  listCapabilities,
  searchServants,
  validationState,
} from "./tools.js";

const store = new Store();

const server = new McpServer(
  { name: "fgo", version: "0.1.0" },
  {
    instructions:
      `Fate/Grand Order data and damage calculator, built on Atlas Academy dumps of the JP region ` +
      `(${store.meta.counts.servants} servants, gamedata ${store.meta.gameDataHash}, built ${store.meta.builtAt.slice(0, 10)}).\n\n` +
      `Use calculate_damage instead of estimating damage from memory — it runs the community formula ` +
      `over the real game data and reports every assumption it made.\n\n` +
      `Damage validation: ${validationState()}.`,
  },
);

// ------------------------------------------------------------------- buscar

server.registerTool(
  "search_servants",
  {
    title: "Search servants",
    description:
      "Find servants by any combination of filters. Returns a compact list plus the total match count.\n\n" +
      "`query` matches name, curated alias and collection number, ignoring accents — 'scathach' finds Scáthach, " +
      "'auo' finds Gilgamesh.\n\n" +
      "`capabilities` filters by what a servant DOES, which is usually what you want for questions like " +
      "'who charges NP for the party'. Call list_capabilities first to see the tags; several are combined with AND.\n\n" +
      "Filters that match nothing are reported back as unknownTraits / unknownCapabilities instead of silently " +
      "returning an empty list.",
    inputSchema: {
      query: z.string().optional().describe("Free text: name, alias or collection number."),
      className: z
        .array(z.string())
        .optional()
        .describe("saber, archer, lancer, rider, caster, assassin, berserker, ruler, avenger, alterEgo, moonCancer, foreigner, pretender, shielder."),
      rarity: z.array(z.number().int().min(0).max(5)).optional(),
      attribute: z.array(z.enum(["human", "sky", "earth", "star", "beast"])).optional(),
      npTarget: z.array(z.enum(["st", "aoe", "support"])).optional().describe("Single target, area of effect, or a support NP that deals no damage."),
      npCard: z.array(z.enum(["buster", "arts", "quick"])).optional(),
      capabilities: z.array(z.string()).optional().describe("Tags from list_capabilities, combined with AND."),
      traits: z.array(z.string()).optional().describe("Trait names the servant carries, e.g. divine, dragon, humanoid."),
      welfareOnly: z.boolean().optional().describe("Only event reward servants."),
      sort: z.enum(["collectionNo", "rarity", "atk", "hp", "name"]).optional(),
      dir: z.enum(["asc", "desc"]).optional(),
      limit: z.number().int().min(1).max(200).optional().describe("Default 30."),
    },
  },
  async (args) => text(searchServants(store, args)),
);

// ------------------------------------------------------------------ detalhe

server.registerTool(
  "get_servant",
  {
    title: "Get servant details",
    description:
      "Full detail for one servant: stats, every Noble Phantasm, skills, class passives, append passives, " +
      "traits and capability tags.\n\n" +
      "Three things here are easy to get wrong from memory:\n" +
      "- **noblePhantasms may contain more than one entry.** Five servants switch card type and three switch " +
      "target with the same card, and the damage multiplier changes with it — Mélusine goes from 300% to 900%. " +
      "Pass the chosen `id` to calculate_damage as `npId`.\n" +
      "- **NP effects are listed in execution order.** Anything marked `[before damage]` is applied to that same " +
      "hit; anything after `[DAMAGE]` is not.\n" +
      "- **classPassives are always active** and the calculator includes them automatically; appendPassives are not.",
    inputSchema: {
      servant: z.string().describe("Name, alias, collection number or internal id."),
    },
  },
  async ({ servant }) => text(getServant(store, servant)),
);

// -------------------------------------------------------------------- dano

server.registerTool(
  "calculate_damage",
  {
    title: "Calculate damage",
    description:
      "Damage for one attack, with the full audit trail. Prefer this over estimating.\n\n" +
      "Returns `damage` (guaranteed / average / maximum — the game rolls a random 0.9–1.1 multiplier, so a single " +
      "hit lands somewhere in that band), every formula term with the value it took, every buff that counted, and " +
      "every buff that did NOT count with the reason. Read `notCounted` before trusting a number that looks low: " +
      "it is where a card-type restriction or an unmet condition shows up.\n\n" +
      "Defaults, applied when you omit them: natural max level, 1000 ATK fou, NP5 for 1–3★ and welfare servants / " +
      "NP1 for 4–5★, overcharge 1, no skills active, full HP, enemy Saber/human.\n\n" +
      "Automatic, not optional: class passives are always included, and an NP's own pre-damage buffs apply to that " +
      "same hit. An NP can never crit and never joins a card chain.\n\n" +
      "Some servants deal more damage the more HP they have LOST: Cú Chulainn, Leonidas, Passionlip, Hijikata, " +
      "Aśvatthāman, and both versions of Anne Bonny & Mary Read. Pass `hpPercent` for them — the default of 100 " +
      "gives their weakest case, and for Hijikata and Anne overcharge does nothing at all until HP is missing.\n\n" +
      "NOT modelled: Craft Essences, Mystic Codes, support servants, and state conditions other than HP (buff " +
      "counts, turn number). Buffs depending on those are reported in `notCounted` rather than guessed.\n\n" +
      `Accuracy: the implementation matches the community formula term by term, but ${validationState()} — ` +
      "say so when the exact figure matters.",
    inputSchema: {
      servant: z.string().describe("Name, alias, collection number or internal id."),
      level: z.number().int().min(1).max(120).optional().describe("Default: natural max. Above it means grail."),
      fou: z.number().int().min(0).max(2000).optional().describe("ATK fou. Default 1000."),
      npLevel: z.number().int().min(1).max(5).optional(),
      overcharge: z.number().int().min(1).max(5).optional().describe("Default 1."),
      hpPercent: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional()
        .describe("Attacker's current HP as a % of its maximum. Default 100. Only matters for the seven HP-scaling servants."),
      npId: z.number().int().optional().describe("Which NP, for servants that have more than one. See get_servant."),
      skills: z.array(z.number().int().min(1).max(3)).optional().describe("Which of the servant's own skills are active, by number."),
      skillLevel: z.number().int().min(1).max(10).optional().describe("Applies to all of them. Default 10."),
      appendPassives: z.array(z.number().int().min(1).max(5)).optional().describe("Off unless listed."),
      action: z.enum(["np", "buster", "arts", "quick", "extra"]).optional().describe("Default np."),
      cardPosition: z.number().int().min(1).max(3).optional().describe("Position in the chain; later cards hit harder. Cards only."),
      critical: z.boolean().optional().describe("Cards only — an NP cannot crit."),
      busterChain: z.boolean().optional().describe("Buster command cards only."),
      braveChain: z.boolean().optional().describe("Raises the extra card from x2 to x3.5."),
      enemyClass: z.string().optional().describe("Default saber. Beast variants are accepted (beastI, beastII, beastIIIR...)."),
      enemyAttribute: z.enum(["human", "sky", "earth", "star", "beast"]).optional().describe("Default human."),
      enemyTraits: z.array(z.string()).optional().describe("Trait names, e.g. undead, divine, weakToEnumaElish. Class and attribute already add their own traits."),
      enemyDefenceBuff: z.number().optional().describe("Percent defence already up on the enemy. Negative for defence down."),
      enemySpecialDefence: z.number().optional().describe("Percent special resistance some bosses have. Defence-piercing NPs do NOT bypass it."),
      roll: z.enum(["min", "avg", "max"]).optional().describe("Which roll drives perHit. Default avg."),
    },
  },
  async (args) => text(calculateDamageTool(store, args)),
);

// ------------------------------------------------------------- capabilities

server.registerTool(
  "list_capabilities",
  {
    title: "List capability tags",
    description:
      "The vocabulary for searching by what a servant does, with how many servants have each tag. " +
      "Call this before using `capabilities` in search_servants — the tags are derived from effect data and " +
      "guessing a name gives zero results.",
    inputSchema: {
      filter: z.string().optional().describe("Substring, e.g. 'np_charge' or 'buster'."),
    },
  },
  async ({ filter }) => text(listCapabilities(store, filter)),
);

// -------------------------------------------------------------------- saída

/** Toda tool devolve JSON: é sem ambiguidade e o cliente não precisa parsear prosa. */
function text(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 1) }] };
}

await server.connect(new StdioServerTransport());
