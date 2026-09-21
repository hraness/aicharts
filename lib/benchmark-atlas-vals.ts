import checkedSnapshot from "../data/benchmark-atlas-vals.json";
import type { BenchmarkAtlasCategory, BenchmarkAtlasDataset, BenchmarkAtlasEntry, BenchmarkAtlasPoint } from "./benchmark-atlas";
import {
  VALS_METHODOLOGY_URL,
  VALS_SOURCE_NAME,
  valsSnapshotSchema,
  type ValsBenchmarkSnapshot,
} from "./benchmark-atlas-vals-data";

const snapshot = valsSnapshotSchema.parse(checkedSnapshot);

/**
 * Vals runs these evaluations itself on test sets nobody else holds. That makes it the
 * owner of the result and the only party who can reproduce it, which is a different
 * evidence class from a public benchmark's own leaderboard and from a vendor's launch
 * claim. Every point below carries the label so a reader never has to infer it.
 */
export const VALS_EVIDENCE_LABEL = "Independent evaluator · private test set";

const source = { name: VALS_SOURCE_NAME, url: "https://www.vals.ai/benchmarks", methodologyUrl: VALS_METHODOLOGY_URL };

type ValsEditorial = Readonly<{
  category: BenchmarkAtlasCategory;
  question: string;
  summary: string;
  measure: string;
  comparisonRule: string;
  limitations: readonly string[];
  tags: readonly string[];
  configurationLabel: string;
  comparabilityNote: string;
}>;

/** Identifiers are the publisher's own model ids, so this note is repeated on every board. */
const IDENTIFIER_NOTE = "Model names are the identifiers Vals publishes, not AI Charts canonical names.";

const EDITORIAL: Readonly<Record<string, ValsEditorial>> = {
  vals_index: {
    category: "general",
    question: "Which model does the most economically valuable work?",
    summary: "A GDP-weighted average of agentic performance across finance, coding, and legal tasks.",
    measure: "The publisher's composite of seven evaluations, weighted by each sector's share of U.S. GDP: finance 8.0, coding 5.6, and legal 1.2, over a denominator of 14.8.",
    comparisonRule: "Compare within index version 2. Versions 1 and 2 use different component benchmarks, so their scores are not a series.",
    limitations: [
      "This is the publisher's composite, not an AI Charts ranking. The sector weights are a deliberate simplification of how AI reaches the economy.",
      "The Code Migration component scores a fixed 60-task subset of the published 120-task run, not the full benchmark.",
      "Five of the seven components are private evaluations that no independent party can reproduce.",
      IDENTIFIER_NOTE,
    ],
    tags: ["composite", "economic impact", "agentic", "finance", "legal", "coding", "GDP"],
    configurationLabel: "Model at the effort Vals selected",
    comparabilityNote: "One publisher-defined composite. Cost is the average dollar cost of one test across the weighted components, not the cost of a task you would run.",
  },
  fabv2: {
    category: "work",
    question: "Can an agent do a financial analyst's work?",
    summary: "Multi-step analyst tasks covering modeling, comparables, earnings, and disclosure reading.",
    measure: "Severity-weighted partial credit across ten task families in the FAB v2 harness, averaged over repeated runs.",
    comparisonRule: "Compare within Finance Agent v2. The v1 board used a different task set and is not a continuation of this one.",
    limitations: [
      "The test set is private, so no independent party can reproduce these scores.",
      "Task-family scores in the inspector are components of the headline number, not separate rankings.",
      IDENTIFIER_NOTE,
    ],
    tags: ["finance", "analyst", "agentic", "financial modeling", "earnings", "professional work"],
    configurationLabel: "Model at the effort Vals selected",
    comparabilityNote: "Private evaluation run by Vals. Dollar values are the publisher's average cost per test under its own harness.",
  },
  legal_research: {
    category: "work",
    question: "Can an agent do legal research it can cite?",
    summary: "Case and statute research across eight areas of US law, scored against citation-backed answers.",
    measure: "Accuracy on research questions across administrative, business, civil, constitutional, criminal, family, health, and immigration law.",
    comparisonRule: "Compare within Legal Research Bench version 1. Per-area scores are components, not separate leaderboards.",
    limitations: [
      "The test set is private and was built with partner law firms, so no independent party can reproduce these scores.",
      "US law only. The result says nothing about research in another jurisdiction.",
      "A citation-backed answer that scores well is not legal advice and has not been checked by a lawyer for a specific matter.",
      IDENTIFIER_NOTE,
    ],
    tags: ["legal", "research", "citations", "case law", "agentic", "professional work"],
    configurationLabel: "Model at the effort Vals selected",
    comparabilityNote: "Private evaluation run by Vals with partner law firms. Dollar values are the publisher's average cost per test.",
  },
  tax_agent_bench: {
    category: "work",
    question: "Can an agent answer a research-grade tax question?",
    summary: "US corporate tax questions covering fact patterns, rule lookup, calculations, forms, and controversy.",
    measure: "Accuracy across six tax task families, with a stricter all-pass variant reported alongside the headline score.",
    comparisonRule: "Compare within Tax Agent Bench version 1. This board covers 22 configurations, fewer than the other Vals boards.",
    limitations: [
      "The test set is private, so no independent party can reproduce these scores.",
      "US corporate tax only, and tax rules change with the filing year.",
      "A score here is not tax advice and does not establish that an answer is filing-ready.",
      IDENTIFIER_NOTE,
    ],
    tags: ["tax", "research", "agentic", "compliance", "professional work"],
    configurationLabel: "Model at the effort Vals selected",
    comparabilityNote: "Private evaluation run by Vals. Dollar values are the publisher's average cost per test.",
  },
  medcode: {
    category: "work",
    question: "Can a model assign the right medical billing code?",
    summary: "Medical coding for the billing process, scored one-shot rather than as an agent.",
    measure: "Accuracy on medical billing code assignment in a single-response setting.",
    comparisonRule: "One-shot only. These scores are not comparable with the agentic Vals boards, which let a model take many steps.",
    limitations: [
      "Vals does not present a comparable cost for this board, so no cost axis is offered.",
      "The board retains configurations from 2025 alongside current models, so the range spans more than one model generation.",
      "The test set is private, so no independent party can reproduce these scores.",
      IDENTIFIER_NOTE,
    ],
    tags: ["healthcare", "medical coding", "billing", "one-shot", "professional work"],
    configurationLabel: "Model at the effort Vals selected",
    comparabilityNote: "Private one-shot evaluation run by Vals. The publisher does not present a comparable cost for this board.",
  },
};

function editorialFor(slug: string): ValsEditorial {
  const editorial = EDITORIAL[slug];
  if (editorial === undefined) throw new Error(`Admitted Vals board ${slug} has no editorial record.`);
  return editorial;
}

function displayVersion(benchmark: ValsBenchmarkSnapshot): string {
  return `${benchmark.version} · private test set`;
}

function atlasPoint(benchmark: ValsBenchmarkSnapshot, row: ValsBenchmarkSnapshot["rows"][number]): BenchmarkAtlasPoint {
  const details: { label: string; value: string }[] = [
    { label: "Publisher model id", value: row.modelId },
    { label: "Standard error", value: `±${row.standardError.toFixed(2)} points` },
  ];
  if (row.latencySeconds !== null) {
    details.push({ label: "Mean latency", value: `${Math.round(row.latencySeconds).toLocaleString("en-US")} seconds per test` });
  }
  if (benchmark.costBasis === "unavailable") {
    details.push({ label: "Cost", value: "Not presented as comparable by the publisher" });
  }
  details.push({ label: "Evaluation mode", value: benchmark.mode === "agentic" ? "Agentic · many steps allowed" : "One-shot · single response" });
  for (const component of row.components) {
    details.push({ label: component.label, value: `${component.score.toFixed(1)}%` });
  }
  return {
    id: row.id,
    label: row.modelId,
    model: row.modelId,
    provider: row.provider,
    harness: row.harness,
    effort: row.effort,
    score: row.score,
    costUsd: row.costUsdPerTest,
    uncertainty: {
      lower: Math.max(0, row.score - row.standardError),
      upper: Math.min(100, row.score + row.standardError),
      label: "±1 standard error",
    },
    sourceUrl: benchmark.source.url,
    details,
  };
}

export const VALS_ATLAS_ENTRIES: readonly BenchmarkAtlasEntry[] = snapshot.benchmarks.map(benchmark => {
  const editorial = editorialFor(benchmark.slug);
  return {
    id: benchmark.benchmarkId,
    name: `${benchmark.name} · Vals AI`,
    version: displayVersion(benchmark),
    category: editorial.category,
    question: editorial.question,
    summary: editorial.summary,
    source: { ...source, url: benchmark.source.url },
    measure: editorial.measure,
    comparisonRule: editorial.comparisonRule,
    limitations: editorial.limitations,
    coverage: "charted",
    tags: [...editorial.tags, "Vals AI", "independent evaluator"],
  };
});

export const VALS_ATLAS_DATASETS: readonly BenchmarkAtlasDataset[] = snapshot.benchmarks.map(benchmark => {
  const editorial = editorialFor(benchmark.slug);
  return {
    benchmarkId: benchmark.benchmarkId,
    version: displayVersion(benchmark),
    score: { label: "Accuracy", unit: "%", direction: "higher", minimum: 0, maximum: 100 },
    source: {
      name: `${VALS_SOURCE_NAME} · ${benchmark.name}`,
      url: benchmark.source.url,
      retrievedAt: benchmark.source.retrievedAt,
      revision: benchmark.source.revision ?? `SHA-256 ${benchmark.source.sha256}`,
    },
    ...(benchmark.source.observedAt === null ? {} : { observedAt: benchmark.source.observedAt }),
    evidenceLabel: VALS_EVIDENCE_LABEL,
    configurationLabel: editorial.configurationLabel,
    comparabilityNote: `${editorial.comparabilityNote} ${IDENTIFIER_NOTE}`,
    ...(benchmark.costBasis === "cost-per-test" ? { costLabel: "Average cost per test (USD)" } : {}),
    points: benchmark.rows.map(row => atlasPoint(benchmark, row)),
  };
});
