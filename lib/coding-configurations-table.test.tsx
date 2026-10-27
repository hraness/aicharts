import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CodingConfigurationsTable } from "@/components/coding-configurations-table";
import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot, type CodingAgentSnapshot } from "./coding-agent-data";
import {
  CODING_CONFIGURATION_COLUMNS,
  codingConfigurationRows,
  codingConfigurationsMarkdownTable,
} from "./coding-configurations-table";

const chartHomeStyles = await Bun.file(new URL("../styles/chart-home.css", import.meta.url)).text();

function firstRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return chartHomeStyles.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u"))?.groups?.body ?? "";
}

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
    const existingMissing = snapshot.records.reduce((count, record) => (
      count + CODING_CONFIGURATION_COLUMNS.filter(column => column.value(record) === null).length
    ), 0);
    const missing = withMissingValues();
    const html = renderToStaticMarkup(createElement(CodingConfigurationsTable, { snapshot: missing }));
    expect(html.match(/<span aria-hidden="true">–<\/span><span class="sr-only">Not reported<\/span>/gu))
      .toHaveLength(existingMissing + 5);
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

  test("keeps the wide nowrap table inside its own horizontal scroll region", () => {
    const section = firstRule(".coding-configurations");
    const scroll = firstRule(".coding-configurations__scroll");
    const cells = firstRule(".coding-configurations__table :is(th, td)");
    expect(section).toContain("max-width: 100%");
    expect(section).toContain("min-width: 0");
    expect(scroll).toContain("max-width: 100%");
    expect(scroll).toContain("min-width: 0");
    expect(scroll).toContain("overflow-x: auto");
    expect(cells).toContain("white-space: nowrap");
  });

  test("escapes backslashes and pipes so a cell cannot split its Markdown row", () => {
    const [first] = snapshot.records;
    const markdown = codingConfigurationsMarkdownTable([{ ...first!, agent: "Agent \\| Pipe\nLine" }]);
    const row = markdown.split("\n").at(-1)!;
    expect(row).toContain("| Agent \\\\\\| Pipe Line |");
    expect(row.replace(/\\./gu, "").split("|")).toHaveLength(markdown.split("\n")[0]!.split("|").length);
  });
});
