import { describe, expect, test } from "bun:test";

import codingAgentData from "@/data/coding-agents.json";

import { parseCodingAgentSnapshot } from "./coding-agent-data";
import {
  codingAgentDatasetSummary,
  codingAgentLeadersMarkdownTable,
  currentCodingAgentBenchmarkLeaders,
  currentCodingAgentLeadersHeading,
  formatBenchmarkScore,
  homeLeadersParagraphs,
} from "./coding-agent-dataset";
import { formatRetrievedAt } from "./coding-agent-updates";

const parsed = parseCodingAgentSnapshot(codingAgentData);
if (!parsed.ok) throw parsed.error;
const snapshot = parsed.value;

describe("coding-agent homepage leaders copy", () => {
  test("formats scores to one decimal place without inventing values", () => {
    expect(formatBenchmarkScore(66.7)).toBe("66.7");
    expect(formatBenchmarkScore(68)).toBe("68.0");
  });

  test("uses the snapshot retrievedAt in the leaders heading", () => {
    expect(currentCodingAgentLeadersHeading(snapshot.source.retrievedAt)).toBe(
      `Current leaders as of ${snapshot.source.retrievedAt}`,
    );
  });

  test("answers with two to four snapshot-derived sentences", () => {
    const paragraphs = homeLeadersParagraphs(snapshot);
    const summary = codingAgentDatasetSummary(snapshot);
    const sentences = paragraphs.join(" ").split(/(?<=\.)\s+/u);

    expect(paragraphs).toHaveLength(2);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(4);
    expect(paragraphs[0]).toContain(snapshot.source.name);
    expect(paragraphs[0]).toContain(String(summary.recordCount));
    expect(paragraphs[0]).toContain(formatRetrievedAt(snapshot.source.retrievedAt));
    expect(paragraphs[1]).toContain("highest stored score");
    expect(paragraphs.join(" ")).not.toMatch(/\d+\.\d+/u);
  });

  test("renders a markdown table from the same leader rows", () => {
    const leaders = currentCodingAgentBenchmarkLeaders(snapshot);
    const table = codingAgentLeadersMarkdownTable(leaders);
    const first = leaders[0];
    if (first === undefined) throw new Error("Checked snapshot has no leaders.");

    expect(table).toContain("| Benchmark | Model | Agent | Provider | Setting | Score |");
    expect(table).toContain(first.definition.label);
    expect(table).toContain(first.record.model);
    expect(table).toContain(formatBenchmarkScore(first.value));
  });
});
