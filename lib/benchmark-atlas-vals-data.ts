import { credentialFreeHttpsUrlSchema } from "./credential-free-https-url";
import { z } from "./schema";

/**
 * Vals AI publishes two kinds of board. Its private boards are evaluations Vals owns and
 * scores on data nobody else holds. Its public boards are Vals re-running someone else's
 * benchmark, which is a different system from that benchmark owner's leaderboard and must
 * never share a series with it. Only private boards are admitted here, and the literal
 * below is what enforces that: a public board fails the schema instead of a review step.
 */
export const VALS_DATASET_TYPE = "private";
export const VALS_SOURCE_NAME = "Vals AI";
export const VALS_SOURCE_ORIGIN = "https://www.vals.ai";
export const VALS_METHODOLOGY_URL = "https://www.vals.ai/about";

/** Slug, catalog id, and pinned publisher version. A version bump is a new admission. */
export const VALS_ADMITTED_BENCHMARKS = [
  { slug: "vals_index", benchmarkId: "vals-index", family: "vals_index", version: "2" },
  { slug: "fabv2", benchmarkId: "vals-finance-agent-v2", family: "finance_agent", version: "2" },
  { slug: "legal_research", benchmarkId: "vals-legal-research", family: "legal_research", version: "1" },
  { slug: "tax_agent_bench", benchmarkId: "vals-tax-agent", family: "tax_agent_bench", version: "1" },
  { slug: "medcode", benchmarkId: "vals-medcode", family: "medcode", version: "1" },
] as const;

export type ValsAdmittedBenchmark = typeof VALS_ADMITTED_BENCHMARKS[number];

export function valsBenchmarkUrl(slug: string): string {
  return `${VALS_SOURCE_ORIGIN}/benchmarks/${slug}`;
}

const nonempty = z.string().trim().min(1).max(500);
const nativeScore = z.number().finite().min(0).max(100);
const admittedSlugs = VALS_ADMITTED_BENCHMARKS.map(entry => entry.slug);

const sourceSchema = z.object({
  url: credentialFreeHttpsUrlSchema,
  retrievedAt: z.iso.datetime(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  observedAt: z.iso.datetime().nullable(),
  revision: nonempty.nullable(),
}).strict();

const componentSchema = z.object({ id: nonempty, label: nonempty, score: nativeScore }).strict();

/**
 * Identifiers stay exactly as Vals publishes them. Prettifying `meta/muse_spark_1_3_max`
 * or `claude-haiku-4-5-20251001-thinking` means guessing at a product name, so the model
 * id is carried verbatim and the provider is shown beside it.
 */
const rowSchema = z.object({
  id: nonempty,
  modelId: nonempty,
  provider: nonempty,
  effort: nonempty.nullable(),
  harness: nonempty.nullable(),
  score: nativeScore,
  standardError: z.number().finite().nonnegative().max(100),
  costUsdPerTest: z.number().finite().nonnegative().nullable(),
  latencySeconds: z.number().finite().nonnegative().nullable(),
  components: z.array(componentSchema).max(24),
}).strict();

const benchmarkSchema = z.object({
  slug: z.enum(admittedSlugs as [string, ...string[]]),
  benchmarkId: nonempty,
  name: nonempty,
  description: nonempty,
  family: nonempty,
  version: nonempty,
  industry: nonempty,
  datasetType: z.literal(VALS_DATASET_TYPE),
  mode: z.enum(["agentic", "one-shot"]),
  runner: nonempty,
  /** `use_cost_per_test` is the publisher's own statement that its cost column is comparable. */
  costBasis: z.enum(["cost-per-test", "unavailable"]),
  totalModels: z.number().int().positive().max(500),
  source: sourceSchema,
  rows: z.array(rowSchema).min(1).max(150),
}).strict();

export const valsSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  benchmarks: z.array(benchmarkSchema).length(VALS_ADMITTED_BENCHMARKS.length),
}).strict().superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const [index, benchmark] of value.benchmarks.entries()) {
    const path: (string | number)[] = ["benchmarks", index];
    const admitted = VALS_ADMITTED_BENCHMARKS.find(entry => entry.slug === benchmark.slug);
    if (admitted === undefined) {
      ctx.addIssue({ code: "custom", path, message: `Unreviewed Vals benchmark: ${benchmark.slug}.` });
      continue;
    }
    if (seen.has(benchmark.slug)) ctx.addIssue({ code: "custom", path, message: `Duplicate Vals benchmark: ${benchmark.slug}.` });
    seen.add(benchmark.slug);
    if (benchmark.benchmarkId !== admitted.benchmarkId) {
      ctx.addIssue({ code: "custom", path: [...path, "benchmarkId"], message: `Catalog id must stay ${admitted.benchmarkId}.` });
    }
    if (benchmark.family !== admitted.family || benchmark.version !== admitted.version) {
      ctx.addIssue({ code: "custom", path: [...path, "version"], message: `Admitted ${admitted.family} v${admitted.version}; the source now publishes ${benchmark.family} v${benchmark.version}. A version change needs a separate admission.` });
    }
    if (benchmark.source.url !== valsBenchmarkUrl(benchmark.slug)) {
      ctx.addIssue({ code: "custom", path: [...path, "source", "url"], message: "Source URL must be the admitted benchmark page." });
    }
    const { observedAt, retrievedAt } = benchmark.source;
    if (observedAt !== null && Date.parse(observedAt) > Date.parse(retrievedAt)) {
      ctx.addIssue({ code: "custom", path: [...path, "source"], message: "Publication cannot follow retrieval." });
    }
    if (new Set(benchmark.rows.map(row => row.id)).size !== benchmark.rows.length) {
      ctx.addIssue({ code: "custom", path: [...path, "rows"], message: "Duplicate observation ID." });
    }
    if (benchmark.costBasis === "unavailable" && benchmark.rows.some(row => row.costUsdPerTest !== null)) {
      ctx.addIssue({ code: "custom", path: [...path, "rows"], message: "The source does not present a comparable cost for this board; it must not be charted as one." });
    }
  }
});

export type ValsSnapshot = z.infer<typeof valsSnapshotSchema>;
export type ValsBenchmarkSnapshot = ValsSnapshot["benchmarks"][number];
export type ValsRow = ValsBenchmarkSnapshot["rows"][number];
