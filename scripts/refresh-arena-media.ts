import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  ARENA_MEDIA_DATASET, ARENA_MEDIA_LICENSE, ARENA_MEDIA_SOURCE,
  ARENA_MEDIA_TRACKS, ARENA_MEDIA_VERSION, arenaMediaPageSchema, arenaMediaSnapshotSchema,
  type ArenaMediaRow, type ArenaMediaSnapshot, type ArenaMediaTrack,
} from "../lib/arena-media-data";
import { z } from "../lib/schema";

const OUTPUT = path.join(import.meta.dir, "..", "data", "arena-media.json");
const MAX_BYTES = 2_000_000;
type FetchSource = (url: string, init: RequestInit) => Promise<Response>;
const metadataSchema = z.object({
  id: z.literal(ARENA_MEDIA_DATASET), sha: z.string().regex(/^[a-f0-9]{40}$/u),
  private: z.literal(false), gated: z.literal(false),
  cardData: z.object({ license: z.literal("cc-by-4.0") }),
});

async function boundedText(url: string, fetchSource: FetchSource): Promise<{ text: string; revision: string | null }> {
  const response = await fetchSource(url, { signal: AbortSignal.timeout(30_000), redirect: "error", credentials: "omit" });
  if (!response.ok || response.body === null) throw new Error(`Arena public dataset request failed: HTTP ${response.status}.`);
  if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Arena response exceeded byte limit.");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; if (size > MAX_BYTES) throw new Error("Arena response exceeded byte limit.");
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  return { text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), revision: response.headers.get("x-revision") };
}

export function assertArenaLicense(readme: string): void {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(readme)?.[1];
  const licenses = frontmatter?.split(/\r?\n/u).filter(line => /^license:/u.test(line));
  if (licenses?.length !== 1 || licenses[0] !== "license: cc-by-4.0") {
    throw new Error("Arena owner README no longer grants the reviewed CC BY 4.0 license.");
  }
}

export function selectArenaOverall(rows: readonly ArenaMediaRow[]): ArenaMediaSnapshot["cohorts"][ArenaMediaTrack] {
  // Other categories can have different dates even within the publisher's latest split.
  const selected = rows.filter(row => row.category === "overall");
  const cohort = { version: ARENA_MEDIA_VERSION, publishedAt: selected[0]?.leaderboard_publish_date, rows: selected };
  return arenaMediaSnapshotSchema.shape.cohorts.shape.text_to_image.parse(cohort);
}

export function admitArenaPage(value: unknown, responseRevision: string | null, expectedRevision: string, offset: number, expectedTotal?: number) {
  if (responseRevision !== expectedRevision) throw new Error("Arena viewer revision changed or is missing; refusing mixed source revisions.");
  const page = arenaMediaPageSchema.parse(value);
  if (expectedTotal !== undefined && expectedTotal !== page.num_rows_total) throw new Error("Arena row count changed between pages.");
  const count = Math.min(100, page.num_rows_total - offset);
  if (count <= 0 || page.rows.length !== count || page.rows.some((row, index) => row.row_idx !== offset + index)) {
    throw new Error("Arena page is incomplete, duplicated, or out of order.");
  }
  return page;
}

export async function collectArenaMedia(fetchSource: FetchSource = fetch, retrievedAt = new Date().toISOString()): Promise<ArenaMediaSnapshot> {
  const metadata = metadataSchema.parse(JSON.parse((await boundedText(`https://huggingface.co/api/datasets/${ARENA_MEDIA_DATASET}`, fetchSource)).text));
  const license = await boundedText(`${ARENA_MEDIA_SOURCE}/raw/${metadata.sha}/README.md`, fetchSource);
  assertArenaLicense(license.text);
  const pairs = await Promise.all(ARENA_MEDIA_TRACKS.map(async track => {
    const rows: ArenaMediaRow[] = [];
    let total: number | undefined;
    for (let offset = 0; total === undefined || offset < total; offset += 100) {
      const url = new URL("https://datasets-server.huggingface.co/rows");
      for (const [key, value] of Object.entries({ dataset: ARENA_MEDIA_DATASET, config: track, split: "latest", offset: String(offset), length: "100" })) url.searchParams.set(key, value);
      const response = await boundedText(url.href, fetchSource);
      const page = admitArenaPage(JSON.parse(response.text), response.revision, metadata.sha, offset, total);
      total = page.num_rows_total;
      rows.push(...page.rows.map(item => item.row));
    }
    return [track, selectArenaOverall(rows)] as const;
  }));
  return arenaMediaSnapshotSchema.parse({
    schemaVersion: 1,
    source: { dataset: ARENA_MEDIA_DATASET, revision: metadata.sha, retrievedAt, license: ARENA_MEDIA_LICENSE },
    cohorts: Object.fromEntries(pairs),
  });
}

export function hasArenaMediaChanged(previous: ArenaMediaSnapshot, next: ArenaMediaSnapshot): boolean {
  if (Date.parse(next.source.retrievedAt) < Date.parse(previous.source.retrievedAt)) throw new Error("Arena retrieval time regressed.");
  for (const track of ARENA_MEDIA_TRACKS) {
    const before = previous.cohorts[track]; const after = next.cohorts[track];
    if (after.publishedAt < before.publishedAt) throw new Error(`Arena ${track} publication date regressed.`);
    const retained = new Set(after.rows.map(row => row.model_name));
    if (before.rows.some(row => !retained.has(row.model_name))) throw new Error(`Arena ${track} lost a model configuration; review cohort retention.`);
  }
  // A new upstream commit or retrieval alone does not manufacture fresh observations.
  return JSON.stringify(previous.cohorts) !== JSON.stringify(next.cohorts);
}

export async function main(args: readonly string[]): Promise<void> {
  if (args.length !== 1 || !["--check", "--refresh"].includes(args[0])) throw new Error("Use --check (offline) or --refresh (public licensed source).");
  if (args[0] === "--check") {
    const snapshot = arenaMediaSnapshotSchema.parse(await Bun.file(OUTPUT).json());
    console.log(`Arena media: ${ARENA_MEDIA_TRACKS.map(track => `${track} ${snapshot.cohorts[track].rows.length} (${snapshot.cohorts[track].publishedAt})`).join(", ")}.`);
    return;
  }
  const snapshot = await collectArenaMedia();
  if (await Bun.file(OUTPUT).exists()) {
    const previous = arenaMediaSnapshotSchema.parse(await Bun.file(OUTPUT).json());
    if (!hasArenaMediaChanged(previous, snapshot)) { console.log("Arena media observations unchanged."); return; }
  }
  const temporary = `${OUTPUT}.${randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, `${JSON.stringify(snapshot, null, 2)}\n`);
    await rename(temporary, OUTPUT);
  } finally { await rm(temporary, { force: true }); }
  console.log("Refreshed four separate Arena media cohorts with source dates, ratings, intervals, and vote counts.");
}

if (import.meta.main) main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : "Arena media refresh failed."); process.exitCode = 1;
});
