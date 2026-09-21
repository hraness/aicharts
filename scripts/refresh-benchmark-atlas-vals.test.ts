import { describe, expect, test } from "bun:test";

import checked from "../data/benchmark-atlas-vals.json";
import { validateAtlasCatalog } from "../lib/benchmark-atlas";
import { VALS_ATLAS_DATASETS, VALS_ATLAS_ENTRIES, VALS_EVIDENCE_LABEL } from "../lib/benchmark-atlas-vals";
import {
  VALS_ADMITTED_BENCHMARKS,
  valsBenchmarkUrl,
  valsSnapshotSchema,
} from "../lib/benchmark-atlas-vals-data";
import {
  componentTaskIds,
  decodeAttribute,
  extractBenchmark,
  extractBenchmarkViewProps,
  unwrapAstroProps,
} from "./refresh-benchmark-atlas-vals";

const ADMITTED = VALS_ADMITTED_BENCHMARKS[0];
const SOURCE = {
  url: valsBenchmarkUrl(ADMITTED.slug),
  retrievedAt: "2026-09-21T12:00:00.000Z",
  sha256: "a".repeat(64),
  observedAt: null,
  revision: `${ADMITTED.family} v${ADMITTED.version}`,
};

/** Re-encode a decoded value into Astro's `[typeTag, value]` client props serialization. */
function astro(value: unknown): unknown {
  if (Array.isArray(value)) return [1, value.map(astro)];
  if (typeof value === "object" && value !== null) {
    return [0, Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, astro(entry)]))];
  }
  return [0, value];
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    accuracy: 68.825, stderr: 1.077, latency: 4576.315, cost_per_test: 28.916238,
    provider: "Anthropic", harness: null, reasoning_effort: null, compute_effort: "max",
    token_totals: { input_tokens: 10, output_tokens: 2, reasoning_tokens: null, cache_read_tokens: 3, cache_write_tokens: 1 },
    ...overrides,
  };
}

function view(overrides: { metadata?: Record<string, unknown>; tasks?: Record<string, unknown> } = {}) {
  return {
    metadata: {
      benchmark: "Vals Index", slug: ADMITTED.slug, description: "A single measure of economic impact.",
      family: ADMITTED.family, version: ADMITTED.version, updated: "2026-09-21", dataset_type: "private",
      industry: "index", mode: "agentic", runner: "external", use_cost_per_test: true, archived: false,
      total_models: 2, tasks: { overall: "Overall", finance_agent: "Finance Agent v2", all_pass__finance: "Finance" },
      ...overrides.metadata,
    },
    tasks: {
      overall: { "anthropic/claude-opus-5": result(), "openai/gpt-6-astra": result({ accuracy: 66.61, provider: "OpenAI" }) },
      finance_agent: { "anthropic/claude-opus-5": result({ accuracy: 50.5 }), "openai/gpt-6-astra": result({ accuracy: 49 }) },
      all_pass__finance: { "anthropic/claude-opus-5": result({ accuracy: 12 }), "openai/gpt-6-astra": result({ accuracy: 11 }) },
      ...overrides.tasks,
    },
  };
}

function page(value: unknown = view(), componentUrl = "/_astro/BenchmarkView.BJcgr7Je.js"): string {
  const props = JSON.stringify(astro({ benchmarkView: { default: value } }))
    .replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<html><body><astro-island component-url="${componentUrl}" props="${props}"></astro-island></body></html>`;
}

describe("Astro island decoding", () => {
  test.each([
    ["&amp;", "&"], ["&lt;", "<"], ["&gt;", ">"], ["&quot;", "\""], ["&#39;", "'"], ["&apos;", "'"],
  ])("decodes the supported entity %s exactly once", (encoded, expected) => {
    expect(decodeAttribute(encoded)).toBe(expected);
  });

  test("a decoded entity is never re-scanned as another entity", () => {
    expect(decodeAttribute("&amp;amp;")).toBe("&amp;");
    expect(decodeAttribute("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
  });

  test("round-trips every value shape through Astro's props encoding", () => {
    const value = { a: 1, b: "two", c: null, d: true, e: [1, "x", { f: [] }], g: { h: { i: 0.5 } } };
    expect(unwrapAstroProps(astro(value))).toEqual(value);
  });

  test("requires exactly one BenchmarkView island", () => {
    expect(() => extractBenchmarkViewProps("<html></html>")).toThrow("found 0");
    expect(() => extractBenchmarkViewProps(page() + page())).toThrow("found 2");
    expect(() => extractBenchmarkViewProps(page(view(), "/_astro/ScatterGraph.js"))).toThrow("found 0");
  });

  test("reports unparsable island props instead of returning a partial value", () => {
    expect(() => extractBenchmarkViewProps(`<astro-island component-url="BenchmarkView" props="{&quot;"></astro-island>`)).toThrow("not JSON");
  });
});

describe("Vals source contract", () => {
  test("extracts the published board with components, effort, and cost", () => {
    const benchmark = extractBenchmark(page(), ADMITTED, SOURCE);
    expect(benchmark.rows.map(row => row.id)).toEqual(["anthropic-claude-opus-5", "openai-gpt-6-astra"]);
    const [claude] = benchmark.rows;
    expect(claude.modelId).toBe("anthropic/claude-opus-5");
    expect(claude.provider).toBe("Anthropic");
    expect(claude.effort).toBe("max");
    expect(claude.score).toBe(68.825);
    expect(claude.standardError).toBe(1.077);
    expect(claude.costUsdPerTest).toBe(28.916238);
    expect(claude.latencySeconds).toBe(4576.315);
    expect(benchmark.source.observedAt).toBe("2026-09-21T00:00:00.000Z");
  });

  test("a breakdown of another headline metric never becomes a component", () => {
    expect(componentTaskIds({ overall: "Overall", weighted_pass: "Weighted", weighted_pass__family: "Family" }))
      .toEqual(["weighted_pass"]);
    expect(extractBenchmark(page(), ADMITTED, SOURCE).rows[0].components).toEqual([
      { id: "finance_agent", label: "Finance Agent v2", score: 50.5 },
    ]);
  });

  test("refuses a Vals re-run of a benchmark owned by someone else", () => {
    expect(() => extractBenchmark(page(view({ metadata: { dataset_type: "public" } })), ADMITTED, SOURCE))
      .toThrow("is now a public board");
  });

  test("refuses an archived, renamed, or re-versioned board rather than relabeling it", () => {
    expect(() => extractBenchmark(page(view({ metadata: { archived: true } })), ADMITTED, SOURCE)).toThrow("archived");
    expect(() => extractBenchmark(page(view({ metadata: { slug: "swebench" } })), ADMITTED, SOURCE)).toThrow("identifies as swebench");
    const bumped = extractBenchmark(page(view({ metadata: { version: "3" } })), ADMITTED, SOURCE);
    expect(valsSnapshotSchema.safeParse({ schemaVersion: 1, benchmarks: [bumped] }).success).toBe(false);
  });

  test("refuses a board whose published row count disagrees with its own model total", () => {
    expect(() => extractBenchmark(page(view({ metadata: { total_models: 3 } })), ADMITTED, SOURCE))
      .toThrow("reports 3 models but published 2");
  });

  test("drops cost when the publisher does not present it as comparable", () => {
    const benchmark = extractBenchmark(page(view({ metadata: { use_cost_per_test: false } })), ADMITTED, SOURCE);
    expect(benchmark.costBasis).toBe("unavailable");
    expect(benchmark.rows.every(row => row.costUsdPerTest === null)).toBe(true);
  });

  test("refuses a model identifier that is not a provider-scoped id", () => {
    const tasks = { overall: { "claude-opus-5": result(), "openai/gpt-6-astra": result() } };
    expect(() => extractBenchmark(page(view({ tasks })), ADMITTED, SOURCE)).toThrow("Unexpected model identifier shape");
  });

  test("a missing overall column fails instead of charting a component as the headline", () => {
    expect(() => extractBenchmark(page({ ...view(), tasks: { finance_agent: {} } }), ADMITTED, SOURCE))
      .toThrow("no longer publishes an overall score");
  });
});

describe("checked Vals snapshot", () => {
  test("validates and covers every admitted board exactly once", () => {
    expect(valsSnapshotSchema.safeParse(checked).success).toBe(true);
    expect(checked.benchmarks.map(benchmark => benchmark.slug).sort())
      .toEqual(VALS_ADMITTED_BENCHMARKS.map(entry => entry.slug).sort());
  });

  test("every admitted board is a private Vals evaluation, never a re-run of a public benchmark", () => {
    expect(checked.benchmarks.every(benchmark => benchmark.datasetType === "private")).toBe(true);
  });

  test("enters the shared catalog with its evidence class and source on every point", () => {
    expect(validateAtlasCatalog(VALS_ATLAS_ENTRIES, VALS_ATLAS_DATASETS).ok).toBe(true);
    for (const dataset of VALS_ATLAS_DATASETS) {
      expect(dataset.evidenceLabel).toBe(VALS_EVIDENCE_LABEL);
      expect(dataset.points.every(point => point.sourceUrl.startsWith("https://www.vals.ai/benchmarks/"))).toBe(true);
      expect(dataset.points.every(point => point.uncertainty?.label === "±1 standard error")).toBe(true);
    }
  });

  test("a board without a comparable cost offers no cost axis", () => {
    const medcode = VALS_ATLAS_DATASETS.find(dataset => dataset.benchmarkId === "vals-medcode")!;
    expect(medcode.costLabel).toBeUndefined();
    expect(medcode.points.every(point => point.costUsd === null)).toBe(true);
  });

  test("uncertainty stays inside the score domain and brackets the score", () => {
    for (const dataset of VALS_ATLAS_DATASETS) {
      for (const point of dataset.points) {
        expect(point.uncertainty!.lower).toBeGreaterThanOrEqual(0);
        expect(point.uncertainty!.upper).toBeLessThanOrEqual(100);
        expect(point.uncertainty!.lower).toBeLessThanOrEqual(point.score);
        expect(point.uncertainty!.upper).toBeGreaterThanOrEqual(point.score);
      }
    }
  });

  test("the one-shot board is never described as comparable with the agentic boards", () => {
    const medcode = VALS_ATLAS_ENTRIES.find(entry => entry.id === "vals-medcode")!;
    expect(medcode.comparisonRule).toContain("One-shot only");
    expect(VALS_ATLAS_DATASETS.find(dataset => dataset.benchmarkId === "vals-medcode")!.points[0].details)
      .toContainEqual({ label: "Evaluation mode", value: "One-shot · single response" });
  });
});
