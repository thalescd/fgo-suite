/** Arquivos baixados do Atlas Academy e onde ficam em disco. */

export const REGION = "JP" as const;
export const API_BASE = "https://api.atlasacademy.io";
export const RAW_DIR = "raw";
export const OUT_DIR = "public/data";

export interface Source {
  /** Nome do arquivo no Atlas, sem .json. */
  remote: string;
  /** Nome local, sem .json. */
  local: string;
  description: string;
}

/**
 * Usamos as variantes `_lang_en` (D1): a região JP tem o conteúdo completo, mas
 * nomes em japonês. Medido: só 1 dos 466 servos permanece sem tradução (R2).
 *
 * Nota: usamos `nice_servant` e NÃO `nice_servant_lore` (88 MB vs 45 MB). O lore
 * traz apenas texto de perfil, que o modelo canônico não guarda. Se um dia perfis
 * entrarem no escopo, trocar o `remote` aqui — o manifest cuida do resto.
 */
export const SOURCES: Source[] = [
  { remote: "nice_servant_lang_en", local: "servants", description: "servos" },
  { remote: "nice_equip_lang_en", local: "equips", description: "craft essences" },
  { remote: "nice_mystic_code_lang_en", local: "mystic_codes", description: "mystic codes" },
  { remote: "NiceConstant", local: "constant", description: "constantes da fórmula" },
  { remote: "NiceClassAttackRate", local: "class_attack_rate", description: "atk por classe" },
  { remote: "NiceClassRelation", local: "class_relation", description: "matriz de classe" },
  { remote: "NiceAttributeRelation", local: "attribute_relation", description: "matriz de atributo" },
  { remote: "NiceCard", local: "card", description: "multiplicadores de card" },
];

export function exportUrl(remote: string): string {
  return `${API_BASE}/export/${REGION}/${remote}.json`;
}

export function infoUrl(): string {
  return `${API_BASE}/info`;
}

// ------------------------------------------------------------------- manifest

export interface ManifestEntry {
  remote: string;
  etag: string | null;
  lastModified: string | null;
  bytes: number;
  sha256: string;
  syncedAt: string;
}

export interface Manifest {
  region: string;
  /** hash e timestamp de /info no momento do último sync bem-sucedido. */
  gameDataHash: string;
  gameDataTimestamp: number;
  syncedAt: string;
  files: Record<string, ManifestEntry>;
}

export const EMPTY_MANIFEST: Manifest = {
  region: REGION,
  gameDataHash: "",
  gameDataTimestamp: 0,
  syncedAt: "",
  files: {},
};
