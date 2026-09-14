import { z } from "./schema";
import { credentialFreeHttpsUrlSchema } from "./credential-free-https-url";

const nonempty = z.string().trim().min(1).max(500);
const nativeScore = z.number().finite().min(0).max(100);
const sourceSchema = z.object({
  url: credentialFreeHttpsUrlSchema,
  retrievedAt: z.iso.datetime(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  observedAt: z.iso.datetime().nullable(),
  revision: nonempty.nullable(),
}).strict();

const arcRowSchema = z.object({
  id: nonempty, label: nonempty, model: nonempty, provider: nonempty,
  effort: nonempty, score: nativeScore,
  costUsd: z.number().finite().nonnegative().nullable(),
  sourceUrl: credentialFreeHttpsUrlSchema,
}).strict();
const arcSchema = z.object({ source: sourceSchema, rows: z.array(arcRowSchema).min(1).max(40) }).strict();

export const reasoningSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  arc2: arcSchema,
  arc3Standard: arcSchema,
  arc3Adapter: arcSchema,
  deepResearch: z.object({
    source: sourceSchema,
    rows: z.array(z.object({
      id: nonempty, label: nonempty, provider: nonempty,
      recall: nativeScore, analysis: nativeScore, presentation: nativeScore, total: nativeScore,
    }).strict()).min(4).max(25),
  }).strict(),
  memory: z.object({
    source: sourceSchema,
    rows: z.array(z.object({
      id: nonempty, label: nonempty, family: nonempty,
      smallAccuracy: nativeScore, smallLatencySeconds: z.number().finite().nonnegative(),
      mediumAccuracy: nativeScore, mediumLatencySeconds: z.number().finite().nonnegative(),
    }).strict()).length(6),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  for (const [key, section] of Object.entries(value)) {
    if (typeof section !== "object") continue;
    if (new Set(section.rows.map(row => row.id)).size !== section.rows.length) {
      ctx.addIssue({ code: "custom", path: [key, "rows"], message: "Duplicate observation ID." });
    }
  }
  const expectedSources = {
    arc2: "https://arcprize.org/media/data/leaderboard/v2.json",
    arc3Standard: "https://arcprize.org/media/data/leaderboard/v3.json",
    arc3Adapter: "https://arcprize.org/media/data/leaderboard/v3.json",
    deepResearch: "https://agentresearchlab.com/benchmarks/deepresearch-bench-ii/index.html",
    memory: "https://xiaowu0162.github.io/longmemeval-v2/",
  } as const;
  for (const key of Object.keys(expectedSources) as (keyof typeof expectedSources)[]) {
    if (value[key].source.url !== expectedSources[key]) ctx.addIssue({ code: "custom", path: [key, "source", "url"], message: "Unreviewed source URL." });
    const { observedAt, retrievedAt } = value[key].source;
    if (observedAt && Date.parse(observedAt) > Date.parse(retrievedAt)) ctx.addIssue({ code: "custom", path: [key, "source"], message: "Observation cannot follow retrieval." });
  }
  if (value.arc2.rows.some(row => row.costUsd !== null)) {
    ctx.addIssue({ code: "custom", path: ["arc2"], message: "This selected ARC-AGI-2 cohort does not publish cost." });
  }
  if (value.arc3Standard.rows.some(row => row.id.includes("provider-adapter"))) {
    ctx.addIssue({ code: "custom", path: ["arc3Standard"], message: "Provider Adapter cannot enter Standard results." });
  }
  if (value.arc3Adapter.rows.some(row => !row.id.includes("provider-adapter"))) {
    ctx.addIssue({ code: "custom", path: ["arc3Adapter"], message: "Standard cannot enter Provider Adapter results." });
  }
  if (value.arc3Standard.rows.some(row => row.costUsd === null) || value.arc3Adapter.rows.some(row => row.costUsd === null)) {
    ctx.addIssue({ code: "custom", path: ["arc3Standard"], message: "Selected ARC-AGI-3 observations require published total evaluation cost." });
  }
});

export type ReasoningSnapshot = z.infer<typeof reasoningSnapshotSchema>;
