import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CodingConfigurationsTable } from "@/components/coding-configurations-table";
import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot, type CodingAgentSnapshot } from "./coding-agent-data";
import {
  codingConfigurationRows,
  codingConfigurationsMarkdownTable,
} from "./coding-configurations-table";

const parsed = parseCodingAgentSnapshot(codingAgentData);
if (!parsed.ok) throw parsed.error;
const snapshot = parsed.value;

function withMissingValues(): CodingAgentSnapshot {
  const [first, ...rest] = snapshot.records;
  return {
    ...snapshot,
    records: [
      {
        ...first!,
        benchmarks: { ...first!.benchmarks, aaIndex: null, deepSwe: null },
        economics: { costUsd: null, durationSeconds: null },
        usage: { totalTokens: null },
      },
      ...rest,
    ],
  };
}

describe("coding configurations table", () => {
  test("shows a missing value as a labeled en dash, never as zero", () => {
    const missing = withMissingValues();
    const html = renderToStaticMarkup(createElement(CodingConfigurationsTable, { snapshot: missing }));
    expect(html.match(/<span aria-hidden="true">–<\/span><span class="sr-only">Not reported<\/span>/gu)).toHaveLength(5);
    const markdown = codingConfigurationsMarkdownTable(missing.records);
    const lastRow = markdown.split("\n").at(-1)!;
    expect(lastRow).toContain("| – | – |");
    expect(lastRow).not.toMatch(/\| \$?0(?:\.0+)? \|/u);
  });

  test("sorts by AA Index, highest first, with missing scores last", () => {
    const rows = codingConfigurationRows(withMissingValues().records);
    const scores = rows.map(record => record.benchmarks.aaIndex);
    expect(scores.at(-1)).toBeNull();
    const present = scores.filter((value): value is number => value !== null);
    expect(present).toEqual([...present].sort((left, right) => right - left));
    expect(rows).toHaveLength(snapshot.records.length);
  });
});
