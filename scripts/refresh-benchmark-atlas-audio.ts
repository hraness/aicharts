import { createHash, randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  AUDIO_BENCHMARK_VERSION, AUDIO_MODELS, AUDIO_OBSERVED_AT, AUDIO_SOURCE_REVISION,
  AUDIO_SOURCE_SHA256, AUDIO_SOURCE_URL, audioRowsSchema, audioSnapshotSchema, type AudioSnapshot,
} from "../lib/benchmark-atlas-audio-data";

const OUTPUT = path.join(import.meta.dir, "..", "data", "benchmark-atlas-audio.json");
const MAX_BYTES = 60_000;
export const AUDIO_CSV_HEADER = "model,avg,RTFx,License,Size (B),# Languages,Encoder,Decoder,Training data disclosure,AMI-Cleaned WER,Earnings22-Cleaned-AA-chunked WER,Gigaspeech-Cleaned WER,LS Clean WER,LS Other WER,SPGISpeech WER,Voice Arena Monsoon WER,Voxpopuli-AA-Cleaned WER,AMI-Cleaned RTFx,Earnings22-Cleaned-AA-chunked RTFx,Gigaspeech-Cleaned RTFx,LS Clean RTFx,LS Other RTFx,SPGISpeech RTFx,Voice Arena Monsoon RTFx,Voxpopuli-AA-Cleaned RTFx,AMI WER,Earnings22 WER,Gigaspeech WER,Voxpopuli WER";

function parseCsv(csv: string): string[][] {
  if (Buffer.byteLength(csv, "utf8") > MAX_BYTES || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(csv)) throw new Error("Audio CSV exceeds the bounded text contract.");
  const rows: string[][] = [];
  let row: string[] = []; let cell = ""; let quoted = false; let closed = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char !== '"') { cell += char; continue; }
      if (csv[index + 1] === '"') { cell += '"'; index += 1; continue; }
      quoted = false; closed = true; continue;
    }
    if (char === ",") { row.push(cell); cell = ""; closed = false; continue; }
    if (char === "\n" || char === "\r") {
      if (char === "\r") {
        if (csv[index + 1] !== "\n") throw new Error("Audio CSV contains an invalid line ending.");
        index += 1;
      }
      rows.push([...row, cell]); row = []; cell = ""; closed = false; continue;
    }
    if (closed) throw new Error("Audio CSV has content after a quoted field.");
    if (char === '"') {
      if (cell.length > 0) throw new Error("Audio CSV has a misplaced quote.");
      quoted = true; continue;
    }
    cell += char;
  }
  if (quoted) throw new Error("Audio CSV contains an unfinished quoted field.");
  if (row.length > 0 || cell.length > 0 || closed) rows.push([...row, cell]);
  return rows;
}

/** Named metric, exact header order and selected IDs prevent old-AMI or speed-column leakage. */
export function extractAudioRows(csv: string): AudioSnapshot["rows"] {
  const [header, ...rows] = parseCsv(csv);
  const expected = AUDIO_CSV_HEADER.split(",");
  if (JSON.stringify(header) !== JSON.stringify(expected)) throw new Error("Open ASR metric columns or order changed.");
  const modelColumn = expected.indexOf("model"); const werColumn = expected.indexOf("AMI-Cleaned WER");
  const byModel = new Map<string, string[]>();
  for (const row of rows) {
    if (row.length !== expected.length) throw new Error("Open ASR row width changed.");
    const modelId = row[modelColumn];
    if (!modelId || byModel.has(modelId)) throw new Error("Open ASR has a missing or duplicate model ID.");
    byModel.set(modelId, row);
  }
  return audioRowsSchema.parse(AUDIO_MODELS.map(({ modelId }) => {
    const row = byModel.get(modelId);
    if (!row) throw new Error(`Missing selected Open ASR model: ${modelId}.`);
    const value = row[werColumn];
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value) || !Number.isFinite(Number(value))) throw new Error(`Invalid native WER for ${modelId}.`);
    return { modelId, wer: Number(value) };
  }));
}

export function buildAudioSnapshot(csv: string, retrievedAt: string): AudioSnapshot {
  if (createHash("sha256").update(csv).digest("hex") !== AUDIO_SOURCE_SHA256) throw new Error("Pinned Open ASR source checksum changed; review the result revision and protocol before admission.");
  return audioSnapshotSchema.parse({
    schemaVersion: 1, version: AUDIO_BENCHMARK_VERSION, observedAt: AUDIO_OBSERVED_AT,
    source: { url: AUDIO_SOURCE_URL, revision: AUDIO_SOURCE_REVISION, sha256: AUDIO_SOURCE_SHA256, retrievedAt },
    task: { dataset: "hf-audio/open-asr-leaderboard", configuration: "ami_cleaned", split: "test", language: "English", metricColumn: "AMI-Cleaned WER", unit: "% WER" },
    rows: extractAudioRows(csv),
  });
}

async function fetchAudioSource(): Promise<string> {
  const response = await fetch(AUDIO_SOURCE_URL, { redirect: "error", signal: AbortSignal.timeout(25_000), headers: { "User-Agent": "AICharts/1.0 (+https://aicharts.io)" } });
  if (!response.ok || !response.body) throw new Error(`Open ASR source failed with HTTP ${response.status}.`);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Open ASR source exceeded the byte limit.");
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) throw new Error("Open ASR source exceeded the byte limit.");
      chunks.push(next.value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally { await reader.cancel(); }
}

export async function writeAudioSnapshot(candidate: unknown, output = OUTPUT): Promise<"written" | "unchanged"> {
  const snapshot = audioSnapshotSchema.parse(candidate);
  if (await Bun.file(output).exists()) {
    const previous = audioSnapshotSchema.parse(await Bun.file(output).json());
    if (Date.parse(snapshot.source.retrievedAt) < Date.parse(previous.source.retrievedAt)) throw new Error("Refusing audio retrieval timestamp regression.");
    if (JSON.stringify(previous.rows) !== JSON.stringify(snapshot.rows)) throw new Error("Pinned audio observations changed; review the source contract before replacement.");
    // Rechecking immutable bytes does not manufacture new freshness or a new observation.
    return "unchanged";
  }
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, `${JSON.stringify(snapshot, null, 2)}\n`);
    await rename(temporary, output);
  } finally { await rm(temporary, { force: true }); }
  return "written";
}

export async function refreshAudioSnapshot(output = OUTPUT, fetchSource: () => Promise<string> = fetchAudioSource): Promise<"written" | "unchanged"> {
  const snapshot = buildAudioSnapshot(await fetchSource(), new Date().toISOString());
  return writeAudioSnapshot(snapshot, output);
}

export async function main(args: readonly string[]): Promise<void> {
  if (args.length !== 1 || !["--check", "--refresh"].includes(args[0])) throw new Error("Use --check (offline validation) or --refresh (reproduce the reviewed pinned source).");
  if (args[0] === "--check") {
    const checked = audioSnapshotSchema.parse(await Bun.file(OUTPUT).json());
    console.log(`Audio atlas: ${checked.rows.length} checked AMI-Cleaned observations from ${checked.observedAt}.`);
    return;
  }
  console.log(`Audio atlas ${await refreshAudioSnapshot()}. The pinned cohort requires review before its source revision changes.`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : "Audio source refresh failed."); process.exitCode = 1; });
}
