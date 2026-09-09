import { createHash, randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { MULTIMODAL_SOURCE_URLS, multimodalSnapshotSchema, type MultimodalSnapshot } from "../lib/benchmark-atlas-multimodal-data";

const OUTPUT = path.join(import.meta.dir, "..", "data", "benchmark-atlas-multimodal.json");
const SOURCES = MULTIMODAL_SOURCE_URLS;

function plain(value: string): string {
  return value.replace(/<[^>]*>/gu, " ").replace(/&amp;/gu, "&").replace(/&nbsp;/gu, " ").replace(/\s+/gu, " ").trim();
}
function number(value: string): number {
  if (!/^\d+(?:\.\d+)?$/u.test(value)) throw new Error(`Expected a native numeric score, received ${value}.`);
  return Number(value);
}
function id(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}
function rows(html: string): string[][] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gu)].map(match => (
    [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gu)].map(cell => plain(cell[1]))
  ));
}
function provider(label: string): string {
  if (/Qwen|Z-Image|Wan2\.1|EasyAnimate/u.test(label)) return "Alibaba";
  if (/Nano\s?Banana|Gemini/u.test(label)) return "Google";
  if (/GPT|Sora/u.test(label)) return "OpenAI";
  if (/SenseNova/u.test(label)) return "SenseTime";
  if (/Seedream|BAGEL|Bagel/u.test(label)) return "ByteDance";
  if (/FLUX/u.test(label)) return "Black Forest Labs";
  if (/Hunyuan|Youtu/u.test(label)) return "Tencent";
  if (/SD-/u.test(label)) return "Stability AI";
  if (/Janus|DeepSeek/u.test(label)) return "DeepSeek";
  if (/GLM|CogVideo/u.test(label)) return "Z.ai";
  if (/Cosmos/u.test(label)) return "NVIDIA";
  if (/Ray2/u.test(label)) return "Luma";
  if (/PaddleOCR|Qianfan/u.test(label)) return "Baidu";
  if (/MinerU|InternVL/u.test(label)) return "OpenDataLab / Shanghai AI Lab";
  if (/LongCat/u.test(label)) return "Meituan";
  if (/Step1X/u.test(label)) return "StepFun";
  if (/Kimi/u.test(label)) return "Moonshot AI";
  if (/Mistral/u.test(label)) return "Mistral AI";
  if (/Gen-3/u.test(label)) return "Runway";
  if (/Hailuo/u.test(label)) return "MiniMax";
  // A project is a useful provenance identity; do not invent an institutional affiliation.
  return `${label.replace(/ \(.+\)$/u, "")} project`;
}

export function extractWise(text: string): MultimodalSnapshot["wise"]["rows"] {
  if (!text.includes("- Judge model: `Qwen3.5-35B-A3B`") || !text.includes("binary `score`") || !text.includes("0.40 * CULTURE + 0.12 * TIME + 0.12 * SPACE + 0.12 * BIOLOGY + 0.12 * PHYSICS + 0.12 * CHEMISTRY")) throw new Error("WISE Verified judge or weighting changed.");
  const header = "| Rank | Model | Overall | CULTURE | TIME | SPACE | BIOLOGY | PHYSICS | CHEMISTRY | Samples | Complete |";
  if (!text.includes(header)) throw new Error("WISE Verified result columns changed.");
  const selected = text.split("\n").filter(line => /^\| \d+ \|/u.test(line)).map(line => {
    const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
    if (cells.length !== 11 || cells[10] !== "yes" || cells[9] !== "1000") throw new Error("WISE cohort completeness changed.");
    const label = cells[1];
    const [score, culture, time, space, biology, physics, chemistry] = cells.slice(2, 9).map(number);
    return { id: id(label), label, provider: provider(label), score, culture, time, space, biology, physics, chemistry, samples: 1000 as const };
  });
  if (selected.length !== 29) throw new Error("WISE research cohort changed; review model admission.");
  return selected;
}

export function extractEditing(html: string): MultimodalSnapshot["editing"]["rows"] {
  if (!html.includes("GEditBench v2") || !html.includes("GPT-4o") || !html.includes("PVC-Judge") || !html.includes("1,000 bootstrap")) throw new Error("GEditBench judge protocol changed.");
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gu)].map(match => match[1]);
  const table = tables.find(value => plain(value).includes("Instruction Following") && plain(value).includes("Visual Consistency") && plain(value).includes("Overall"));
  if (!table) throw new Error("GEditBench result table missing.");
  const headings = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gu)].map(match => plain(match[1]));
  if (headings.join("|") !== "Rank|Model|Source|Samples|Instruction Following|Visual Quality|Visual Consistency|Overall|Arena Elo|Arena Rank") throw new Error("GEditBench result column order changed.");
  const selected = rows(table).filter(cells => cells.length > 0).map(cells => {
    if (cells.length !== 10) throw new Error("GEditBench result columns changed.");
    const label = cells[1];
    const scores = cells.slice(4, 8).map(cell => {
      const match = cell.replace(/,/gu, "").match(/^(\d+)\s*-(\d+)\/\+(\d+)$/u);
      if (!match) throw new Error(`GEditBench confidence interval changed: ${label}.`);
      return { score: number(match[1]), lower: number(match[1]) - number(match[2]), upper: number(match[1]) + number(match[3]) };
    });
    // Deliberately never read columns 8–9: those are third-party AA Arena scores, not this benchmark.
    return {
      id: id(label), label, provider: provider(label), samples: number(cells[3].replace(/,/gu, "")),
      instruction: scores[0].score, quality: scores[1].score, consistency: scores[2].score, ...scores[3],
    };
  });
  if (selected.length !== 16) throw new Error("GEditBench research cohort changed; review model admission.");
  return selected;
}

export function extractVideo(html: string): MultimodalSnapshot["video"]["rows"] {
  if (!html.includes("VideoPhy 2") || !html.includes("Human Leaderboard") || !html.includes("SA=1 and PC=1")) throw new Error("VideoPhy2 human evaluation protocol changed.");
  const tables = [...html.matchAll(/<table\b[^>]*id="results_(?:open|closed)"[^>]*>([\s\S]*?)<\/table>/gu)].map(match => match[1]);
  if (tables.length !== 2) throw new Error("VideoPhy2 human result tables changed.");
  const selected = tables.flatMap(table => {
    const cells = rows(table);
    if (cells[0]?.join("|") !== "#|Model|Source|All|Hard|PA|OI") throw new Error("VideoPhy2 score columns changed.");
    return cells.slice(1).map(row => {
      if (row.length !== 7) throw new Error("VideoPhy2 result shape changed.");
      const label = row[1];
      const [score, hard, physicalActivities, objectInteractions] = row.slice(3).map(number);
      return { id: id(label), label, provider: provider(label), score, hard, physicalActivities, objectInteractions };
    });
  });
  if (selected.length !== 7) throw new Error("VideoPhy2 human research cohort changed; review model admission.");
  return selected;
}

export function extractDocuments(html: string): MultimodalSnapshot["documents"]["rows"] {
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gu)].map(match => match[1]).find(value => value.includes("(v1.6_full)</caption>"));
  if (!table || !table.includes("Formula<sup>CDM</sup>") || !table.includes("Read Order<sup>Edit</sup>")) throw new Error("OmniDocBench full-set result version or metrics changed.");
  const headings = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gu)].map(match => plain(match[1]));
  if (headings.join("|") !== "Model Type|Methods|Size|Overall&#x2191;|Text Edit &#x2193;|Formula CDM &#x2191;|Table TEDS &#x2191;|Table TEDS-S &#x2191;|Read Order Edit &#x2193;") throw new Error("OmniDocBench result column order changed.");
  const selected = rows(table).filter(row => row.length > 0).map<MultimodalSnapshot["documents"]["rows"][number]>(row => {
    if (row.length !== 9) throw new Error("OmniDocBench result columns changed.");
    const [label, kind, size] = row;
    if (kind !== "Specialized VLMs" && kind !== "General VLMs" && kind !== "Pipeline Tools") throw new Error(`Unreviewed document pipeline type: ${kind}.`);
    const [score, textEdit, formula, table, tableStructure, readingOrderEdit] = row.slice(3).map(number);
    return { id: id(label), label, provider: provider(label), kind, size, score, textEdit, formula, table, tableStructure, readingOrderEdit };
  });
  if (selected.length < 10 || selected.length > 40) throw new Error("OmniDocBench research cohort changed substantially.");
  return selected;
}

export function extractWorld(csv: string): MultimodalSnapshot["world"]["rows"] {
  const lines = csv.trim().split(/\r?\n/u);
  const expected = "Model Type,Model Name,Ability,Sampled by,Evaluated by,Accessibility,Date,WorldScore-Static,WorldScore-Dynamic,Camera Control,Object Control,Content Alignment,3D Consistency,Photometric Consistency,Style Consistency,Subjective Quality,Motion Accuracy,Motion Magnitude,Motion Smoothness";
  if (lines[0] !== expected) throw new Error("WorldScore version or metric columns changed.");
  const selected = lines.slice(1).flatMap(line => {
    const row = line.split(",");
    // An explicit research cohort, not a silent mixture of author and model-team submissions.
    if (row[3] !== "WorldScore" || row[4] !== "WorldScore" || row[6] !== "2025.03.30") return [];
    if (row.length !== 19) throw new Error("WorldScore selected row has malformed columns.");
    const label = row[1].match(/^\[([^\]]+)\]\(https:\/\/.+\)$/u)?.[1];
    const kind = row[0]; const ability = row[2];
    if (!label || !["Video", "3D", "4D"].includes(kind) || !["I2V", "T2V"].includes(ability)) throw new Error("WorldScore selected configuration changed.");
    return [{
      id: id(label), label, provider: provider(label), kind, ability,
      sampledBy: "WorldScore", evaluatedBy: "WorldScore", observedAt: "2025-03-30",
      score: number(row[7]), cameraControl: number(row[9]), objectControl: number(row[10]),
      contentAlignment: number(row[11]), consistency3d: number(row[12]),
    }];
  });
  // Validate the enum/literal boundary rather than casting external strings to domain types.
  return multimodalSnapshotSchema.shape.world.shape.rows.parse(selected);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(25_000), headers: { "User-Agent": "AICharts/1.0 (+https://aicharts.io)" } });
  if (!response.ok || !response.body) throw new Error(`Source failed with HTTP ${response.status}: ${url}.`);
  const maxBytes = 2_000_000;
  if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("Source exceeded byte limit.");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; if (size > maxBytes) throw new Error("Source exceeded byte limit.");
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}

export function hasChangedMultimodalRows(previous: MultimodalSnapshot, next: MultimodalSnapshot): boolean {
  let changed = false;
  for (const key of ["wise", "editing", "video", "documents", "world"] as const) {
    const before = previous[key]; const after = next[key];
    if (before.rows.some(row => !after.rows.some(candidate => candidate.id === row.id))) throw new Error(`Refusing disappearing ${key} observations; review cohort changes.`);
    if (after.source.retrievedAt < before.source.retrievedAt) throw new Error(`Refusing ${key} retrieval timestamp regression.`);
    changed ||= JSON.stringify(before.rows) !== JSON.stringify(after.rows);
  }
  return changed;
}

export async function main(args: readonly string[]): Promise<void> {
  if (args.length !== 1 || !["--check", "--refresh"].includes(args[0])) throw new Error("Use --check (offline validation) or --refresh (reviewed source refresh).");
  if (args[0] === "--check") {
    const checked = multimodalSnapshotSchema.parse(await Bun.file(OUTPUT).json());
    console.log(`Multimodal atlas: ${Object.values(checked).reduce((sum, section) => sum + (typeof section === "object" ? section.rows.length : 0), 0)} checked source observations.`);
    return;
  }
  const [wise, editing, video, documents, world] = await Promise.all(Object.values(SOURCES).map(fetchText));
  const retrievedAt = new Date().toISOString();
  const source = (url: string, text: string) => ({ url, retrievedAt, sha256: createHash("sha256").update(text).digest("hex") });
  const snapshot = multimodalSnapshotSchema.parse({
    schemaVersion: 1,
    wise: { version: "Verified · Qwen3.5-35B-A3B", source: source(SOURCES.wise, wise), rows: extractWise(wise) },
    editing: { version: "2", source: source(SOURCES.editing, editing), rows: extractEditing(editing) },
    video: { version: "2 · human evaluation", source: source(SOURCES.video, video), rows: extractVideo(video) },
    documents: { version: "1.6_full", source: source(SOURCES.documents, documents), rows: extractDocuments(documents) },
    world: { version: "Static · 2025 author cohort", source: source(SOURCES.world, world), rows: extractWorld(world) },
  });
  if (await Bun.file(OUTPUT).exists()) {
    const previous = multimodalSnapshotSchema.parse(await Bun.file(OUTPUT).json());
    // Checking an unchanged publisher page is not a new evaluation or an SEO update.
    if (!hasChangedMultimodalRows(previous, snapshot)) { console.log("Multimodal atlas unchanged."); return; }
  }
  const temporary = `${OUTPUT}.${randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, `${JSON.stringify(snapshot, null, 2)}\n`);
    await rename(temporary, OUTPUT);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log("Refreshed five bounded multimodal source cohorts. Review score and protocol changes before publishing.");
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : "Multimodal source refresh failed."); process.exitCode = 1; });
}
