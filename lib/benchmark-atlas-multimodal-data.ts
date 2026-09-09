import { z } from "./schema";
import { credentialFreeHttpsUrlSchema } from "./credential-free-https-url";

const text = z.string().trim().min(1).max(500);
const percent = z.number().finite().min(0).max(100);
const fraction = z.number().finite().min(0).max(1);
const source = z.object({
  url: credentialFreeHttpsUrlSchema,
  retrievedAt: z.iso.datetime(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
const identity = { id: text, label: text, provider: text };

export const MULTIMODAL_SOURCE_URLS = {
  wise: "https://raw.githubusercontent.com/PKU-YuanGroup/WISE/main/leadboard.md",
  editing: "https://zhangqijiang07.github.io/gedit2_web/",
  video: "https://videophy2.github.io/",
  documents: "https://raw.githubusercontent.com/opendatalab/OmniDocBench/main/README.md",
  world: "https://huggingface.co/spaces/Howieeeee/WorldScore_Leaderboard/raw/main/leaderboard.csv",
} as const;

/** Compact factual aggregates only; no benchmark prompts, media, or third-party arena data. */
export const multimodalSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  wise: z.object({
    version: z.literal("Verified · Qwen3.5-35B-A3B"), source,
    rows: z.array(z.object({
      ...identity, score: fraction, culture: fraction, time: fraction, space: fraction,
      biology: fraction, physics: fraction, chemistry: fraction, samples: z.literal(1000),
    }).strict()).length(29),
  }).strict(),
  editing: z.object({
    version: z.literal("2"), source,
    rows: z.array(z.object({
      ...identity, score: z.number().finite().positive(),
      lower: z.number().finite().positive(), upper: z.number().finite().positive(),
      instruction: z.number().finite().positive(), quality: z.number().finite().positive(),
      consistency: z.number().finite().positive(), samples: z.number().int().min(1).max(1200),
    }).strict()).length(16),
  }).strict(),
  video: z.object({
    version: z.literal("2 · human evaluation"), source,
    rows: z.array(z.object({
      ...identity, score: percent, hard: percent, physicalActivities: percent, objectInteractions: percent,
    }).strict()).length(7),
  }).strict(),
  documents: z.object({
    version: z.literal("1.6_full"), source,
    rows: z.array(z.object({
      ...identity, kind: z.enum(["Specialized VLMs", "General VLMs", "Pipeline Tools"]),
      size: text, score: percent, textEdit: fraction, formula: percent, table: percent,
      tableStructure: percent, readingOrderEdit: fraction,
    }).strict()).min(10).max(40),
  }).strict(),
  world: z.object({
    version: z.literal("Static · 2025 author cohort"), source,
    rows: z.array(z.object({
      ...identity, kind: z.enum(["Video", "3D", "4D"]), ability: z.enum(["I2V", "T2V"]),
      sampledBy: z.literal("WorldScore"), evaluatedBy: z.literal("WorldScore"),
      observedAt: z.literal("2025-03-30"), score: percent, cameraControl: percent, objectControl: percent,
      contentAlignment: percent, consistency3d: percent,
    }).strict()).length(19),
  }).strict(),
}).strict().superRefine((snapshot, ctx) => {
  for (const key of ["wise", "editing", "video", "documents", "world"] as const) {
    if (snapshot[key].source.url !== MULTIMODAL_SOURCE_URLS[key]) {
      ctx.addIssue({ code: "custom", path: [key, "source", "url"], message: "Unreviewed publisher source URL." });
    }
    const rows = snapshot[key].rows;
    if (new Set(rows.map(row => row.id)).size !== rows.length) {
      ctx.addIssue({ code: "custom", path: [key, "rows"], message: "Duplicate observation ID." });
    }
  }
  for (const [index, row] of snapshot.editing.rows.entries()) {
    if (row.lower > row.score || row.upper < row.score) {
      ctx.addIssue({ code: "custom", path: ["editing", "rows", index], message: "Bootstrap interval must contain its score." });
    }
  }
});

export type MultimodalSnapshot = z.infer<typeof multimodalSnapshotSchema>;
