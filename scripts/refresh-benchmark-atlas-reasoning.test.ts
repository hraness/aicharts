import { describe, expect, test } from "bun:test";
import checked from "../data/benchmark-atlas-reasoning.json";
import { validateAtlasCatalog } from "../lib/benchmark-atlas";
import { REASONING_ATLAS_DATASETS, REASONING_ATLAS_ENTRIES } from "../lib/benchmark-atlas-reasoning";
import { reasoningSnapshotSchema } from "../lib/benchmark-atlas-reasoning-data";
import { extractArcRows, extractMemoryRows, extractResearchRows } from "./refresh-benchmark-atlas-reasoning";

function arcInput(version: "v2" | "v3") {
  const rows = version === "v2" ? checked.arc2.rows : [...checked.arc3Standard.rows, ...checked.arc3Adapter.rows];
  return { version, generatedAt: "2026-09-04T14:38:06.320Z", evaluations: rows.map(row => ({
    datasetId: `${version}_Semi_Private`, modelId: row.id, modelDisplayName: row.label,
    modelGroup: new URL(row.sourceUrl).pathname.split("/").at(-1) + (row.id.includes("provider-adapter") ? "-provider-adapter" : ""),
    modelType: "CoT", providerDisplayName: row.provider, score: row.score / 100,
    ...(row.costUsd === null ? {} : { cost: row.costUsd }),
    resultsUrl: new URL(row.sourceUrl).pathname, display: true,
  })) };
}

function researchHtml(providerYear = "") {
  return `9,430 132 InfoRecall TotalScore<table><thead class="bg-black"><tr><th>#</th><th>Model</th><th>InfoRecall</th><th>Analysis</th><th>Presentation</th><th>TotalScore</th></tr></thead><tbody>${checked.deepResearch.rows.map(row => `<tr><td>1</td><td><div>${row.label}</div><div>${row.provider}${providerYear} · Source</div></td><td>${row.recall}</td><td>${row.analysis}</td><td>${row.presentation}</td><td>${row.total}</td></tr>`).join("")}</tbody></table>`;
}

function memoryHtml() {
  return `451 115M<table class="results-table"><thead><tr><th>Method</th><th>Family</th><th>Small Overall</th><th>Small Latency</th><th>Medium Overall</th><th>Medium Latency</th></tr></thead><tbody>${checked.memory.rows.map(row => `<tr><td>${row.label}</td><td>${row.family}</td><td>${row.smallAccuracy}%</td><td>${row.smallLatencySeconds}s</td><td>${row.mediumAccuracy}%</td><td>${row.mediumLatencySeconds}s</td></tr>`).join("")}</tbody></table>`;
}

describe("reasoning atlas source contracts", () => {
  test("checked sources validate against the catalog without mixing cohorts", () => {
    expect(reasoningSnapshotSchema.safeParse(checked).success).toBe(true);
    expect(validateAtlasCatalog(REASONING_ATLAS_ENTRIES, REASONING_ATLAS_DATASETS).ok).toBe(true);
    const standard = REASONING_ATLAS_DATASETS.find(dataset => dataset.benchmarkId === "arc-agi-3-standard")!;
    const adapter = REASONING_ATLAS_DATASETS.find(dataset => dataset.benchmarkId === "arc-agi-3-adapter")!;
    expect(standard.points.some(point => point.label.includes("Provider Adapter"))).toBe(false);
    expect(adapter.points.every(point => point.harness === "Provider Adapter harness")).toBe(true);
    expect(standard.costLabel).toBe("Total evaluation cost (USD)");
  });

  test("ARC fraction-to-percent conversion retains missing cost without fabricating a value", () => {
    const rows = extractArcRows(arcInput("v2"), "v2");
    expect(rows.find(row => row.id === "openai-gpt-6-astra-max")?.score).toBe(95);
    expect(rows.every(row => row.costUsd === null)).toBe(true);
  });

  test("ARC selected cohorts retain their full evaluation cost and harness boundaries", () => {
    const input = arcInput("v3");
    expect(extractArcRows(input, "v3")).toHaveLength(12);
    expect(extractArcRows(input, "v3", true)).toHaveLength(6);
    expect(extractArcRows(input, "v3").find(row => row.id === "openai-gpt-6-astra-max")?.costUsd).toBeCloseTo(26097.50172, 5);
  });

  test("a changed split or removed selected model fails admission", () => {
    const wrongSplit = arcInput("v2");
    wrongSplit.evaluations[0].datasetId = "v2_Public_Eval";
    expect(() => extractArcRows(wrongSplit, "v2")).toThrow("contract");
    const removed = arcInput("v2");
    removed.evaluations = removed.evaluations.filter(row => row.modelGroup !== "moonshot-kimi-k3");
    expect(() => extractArcRows(removed, "v2")).toThrow("Missing selected");
    expect(() => extractArcRows(arcInput("v2"), "v3")).toThrow("version changed");
  });

  test("malformed scores and source links fail admission", () => {
    const badScore = arcInput("v3");
    badScore.evaluations[0].score = 62.7;
    expect(() => extractArcRows(badScore, "v3")).toThrow();
    const badUrl = arcInput("v3");
    badUrl.evaluations[0].resultsUrl = "https://unrelated.example/results";
    expect(() => extractArcRows(badUrl, "v3")).toThrow("provenance");
  });

  test("checked snapshot rejects duplicate observations, false source URLs, and harness leakage", () => {
    const duplicate = structuredClone(checked);
    duplicate.arc2.rows.push(duplicate.arc2.rows[0]);
    expect(reasoningSnapshotSchema.safeParse(duplicate).success).toBe(false);
    const wrongSource = structuredClone(checked);
    wrongSource.memory.source.url = "https://example.com";
    expect(reasoningSnapshotSchema.safeParse(wrongSource).success).toBe(false);
    const leak = structuredClone(checked);
    leak.arc3Standard.rows.push(leak.arc3Adapter.rows[0]);
    expect(reasoningSnapshotSchema.safeParse(leak).success).toBe(false);
  });

  test("research import preserves distinct recall, analysis, presentation, and owner total", () => {
    const html = researchHtml();
    expect(extractResearchRows(html)).toEqual(checked.deepResearch.rows);
    expect(() => extractResearchRows(html.replace("64.38", "64.38%"))).toThrow("Malformed research score");
    expect(() => extractResearchRows(html.replace("AI21-DeepResearch", "unreviewed"))).toThrow("disappeared");
  });

  test("research provider metadata excludes publication years without rewriting the product version", () => {
    const html = researchHtml(", 2025");
    const rows = extractResearchRows(html);
    expect(rows.find(row => row.id === "openai-gpt-o3-deep-research")).toMatchObject({ label: "OpenAI-GPT-o3 Deep Research", provider: "OpenAI" });
    expect(rows.find(row => row.id === "gemini-3-pro-deep-research")?.provider).toBe("Google");
    expect(rows.every(row => !/,\s*20\d{2}$/u.test(row.provider))).toBeTrue();
    expect(checked.deepResearch.rows.every(row => !/,\s*20\d{2}$/u.test(row.provider))).toBeTrue();
  });

  test("memory parser enforces accuracy versus latency units and both tiers", () => {
    const html = memoryHtml();
    expect(extractMemoryRows(html)).toEqual(checked.memory.rows);
    expect(() => extractMemoryRows(html.replace("108.3s", "$108.3"))).toThrow("units changed");
    const memory = REASONING_ATLAS_DATASETS.filter(dataset => dataset.benchmarkId.startsWith("longmemeval-v2"));
    expect(memory).toHaveLength(2);
    expect(memory.every(dataset => dataset.points.every(point => point.costUsd === null))).toBe(true);
    for (const dataset of memory) {
      expect(new Set(dataset.points.map(point => point.model)).size).toBe(6);
      expect(dataset.points.find(point => point.id === "codex")).toMatchObject({ model: "Codex", label: "Codex · Qwen3.5-9B reader", harness: "Qwen3.5-9B reader" });
      expect(dataset.points.every(point => point.details?.some(detail => detail.label === "Reader" && detail.value === "Qwen3.5-9B (fixed)"))).toBeTrue();
    }
  });

  test("research admission rejects renamed, missing, reordered, or ambiguous metric headers", () => {
    const html = researchHtml();
    const reordered = html.replace("<th>InfoRecall</th><th>Analysis</th>", "<th>Analysis</th><th>InfoRecall</th>");
    expect(() => extractResearchRows(reordered)).toThrow("headers changed");
    expect(() => extractResearchRows(html.replace("<th>TotalScore</th>", "<th>TotalScore v2</th>"))).toThrow("headers changed");
    expect(() => extractResearchRows(html.replace(/<thead\b[^>]*>[\s\S]*?<\/thead>/u, ""))).toThrow("headers changed");
    expect(() => extractResearchRows(html + html)).toThrow("ambiguous");
    // A separate table cannot donate data rows to the admitted leaderboard.
    const unrelated = `<table>${html.match(/<tbody>([\s\S]*?)<\/tbody>/u)?.[1]}</table>`;
    expect(extractResearchRows(unrelated + html)).toEqual(checked.deepResearch.rows);
  });

  test("memory admission rejects reversed tiers even when every numeric unit still matches", () => {
    const html = memoryHtml();
    const reversedTiers = html.replace("<th>Small Overall</th><th>Small Latency</th><th>Medium Overall</th><th>Medium Latency</th>", "<th>Medium Overall</th><th>Medium Latency</th><th>Small Overall</th><th>Small Latency</th>");
    expect(() => extractMemoryRows(reversedTiers)).toThrow("headers changed");
    expect(() => extractMemoryRows(html.replace("<th>Small Overall</th>", "<th>Small Retrieval Recall</th>"))).toThrow("headers changed");
    expect(() => extractMemoryRows(html.replace(/<thead>[\s\S]*?<\/thead>/u, ""))).toThrow("headers changed");
    expect(() => extractMemoryRows(html + html)).toThrow("contract changed");
  });
});
