/**
 * Download incremental dos dumps do Atlas Academy.
 *
 * O Atlas responde a GET condicional: mandando `If-None-Match` com o ETag
 * guardado, um arquivo inalterado devolve 304 e zero bytes de payload.
 * Verificado: um sync sem novidades não transfere conteúdo nenhum.
 *
 * Ver docs/DATA.md.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  EMPTY_MANIFEST,
  RAW_DIR,
  REGION,
  SOURCES,
  exportUrl,
  infoUrl,
  type Manifest,
  type Source,
} from "./sources.js";

const manifestPath = join(RAW_DIR, "manifest.json");
const rawPath = (local: string) => join(RAW_DIR, REGION, `${local}.json`);

export async function loadManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  } catch {
    return structuredClone(EMPTY_MANIFEST);
  }
}

async function saveManifest(m: Manifest): Promise<void> {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(m, null, 2) + "\n");
}

export interface GameDataInfo {
  hash: string;
  timestamp: number;
}

/** ~1 KB. Diz se o gamedata da região mudou sem baixar nada pesado. */
export async function fetchInfo(): Promise<GameDataInfo> {
  const res = await fetch(infoUrl());
  if (!res.ok) throw new Error(`/info respondeu ${res.status}`);
  const body = (await res.json()) as Record<string, { hash: string; timestamp: number }>;
  const entry = body[REGION];
  if (!entry) throw new Error(`/info não trouxe a região ${REGION}`);
  return { hash: entry.hash, timestamp: entry.timestamp };
}

const fmtBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;

// ---------------------------------------------------------------------- check

export interface CheckResult {
  info: GameDataInfo;
  manifest: Manifest;
  changed: string[];
  missing: string[];
  unchanged: string[];
}

/**
 * HEAD em cada arquivo comparando ETag. Não baixa conteúdo.
 * Custo total: alguns KB.
 */
export async function check(): Promise<CheckResult> {
  const manifest = await loadManifest();
  const info = await fetchInfo();

  const changed: string[] = [];
  const missing: string[] = [];
  const unchanged: string[] = [];

  await Promise.all(
    SOURCES.map(async (src) => {
      const known = manifest.files[src.local];
      if (!known) {
        missing.push(src.local);
        return;
      }
      const res = await fetch(exportUrl(src.remote), { method: "HEAD" });
      const etag = res.headers.get("etag");
      if (etag && known.etag && etag === known.etag) unchanged.push(src.local);
      else changed.push(src.local);
    }),
  );

  return { info, manifest, changed, missing, unchanged };
}

export function reportCheck(r: CheckResult): void {
  const { manifest, info } = r;
  console.log(`região        ${REGION}`);
  if (manifest.syncedAt) {
    console.log(`último sync   ${manifest.syncedAt}`);
    console.log(`gamedata      ${manifest.gameDataHash} (local) vs ${info.hash} (remoto)`);
    const staleness = info.hash !== manifest.gameDataHash;
    console.log(`              ${staleness ? "⚠ desatualizado" : "✓ atualizado"}`);
  } else {
    console.log("último sync   nunca — rode `npm run data:sync`");
  }
  console.log();
  if (r.missing.length) console.log(`ausentes   (${r.missing.length}): ${r.missing.join(", ")}`);
  if (r.changed.length) console.log(`mudaram    (${r.changed.length}): ${r.changed.join(", ")}`);
  if (r.unchanged.length) console.log(`inalterados(${r.unchanged.length}): ${r.unchanged.join(", ")}`);
  console.log();
  const todo = r.missing.length + r.changed.length;
  console.log(todo === 0 ? "Nada a fazer." : `${todo} arquivo(s) seriam baixados por \`npm run data:sync\`.`);
}

// ----------------------------------------------------------------------- sync

async function syncOne(src: Source, manifest: Manifest): Promise<"downloaded" | "cached"> {
  const known = manifest.files[src.local];
  const headers: Record<string, string> = {};
  if (known?.etag) headers["If-None-Match"] = known.etag;
  else if (known?.lastModified) headers["If-Modified-Since"] = known.lastModified;

  const res = await fetch(exportUrl(src.remote), { headers });

  if (res.status === 304) {
    console.log(`  · ${src.local.padEnd(22)} 304 — inalterado`);
    return "cached";
  }
  if (!res.ok) throw new Error(`${src.remote}: HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const dest = rawPath(src.local);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);

  manifest.files[src.local] = {
    remote: src.remote,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
    bytes: buf.byteLength,
    sha256: createHash("sha256").update(buf).digest("hex"),
    syncedAt: new Date().toISOString(),
  };

  console.log(`  ↓ ${src.local.padEnd(22)} ${fmtBytes(buf.byteLength).padStart(9)}  (${src.description})`);
  return "downloaded";
}

export async function sync(): Promise<void> {
  const manifest = await loadManifest();
  const info = await fetchInfo();

  console.log(`Sincronizando ${SOURCES.length} arquivos da região ${REGION}...\n`);

  let downloaded = 0;
  for (const src of SOURCES) {
    const r = await syncOne(src, manifest);
    if (r === "downloaded") downloaded++;
  }

  manifest.region = REGION;
  manifest.gameDataHash = info.hash;
  manifest.gameDataTimestamp = info.timestamp;
  manifest.syncedAt = new Date().toISOString();
  await saveManifest(manifest);

  const total = Object.values(manifest.files).reduce((a, f) => a + f.bytes, 0);
  console.log();
  console.log(
    downloaded === 0
      ? "Nada mudou — nenhum byte de payload transferido."
      : `${downloaded} arquivo(s) atualizado(s).`,
  );
  console.log(`Total em disco: ${fmtBytes(total)}  ·  gamedata ${info.hash}`);
}

// ----------------------------------------------------------------- leitura

export async function readRaw<T>(local: string): Promise<T> {
  try {
    return JSON.parse(await readFile(rawPath(local), "utf8")) as T;
  } catch (err) {
    throw new Error(
      `Não consegui ler raw/${REGION}/${local}.json — rode \`npm run data:sync\` primeiro.\n  (${String(err)})`,
    );
  }
}
