import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import codingAgentData from "@/data/coding-agents.json";
import {
  parseCodingAgentSnapshot,
  type BenchmarkMetric,
} from "@/lib/coding-agent-data";
import {
  CODING_AGENT_BENCHMARK_DEFINITIONS,
  CODING_AGENT_DATASET_DESCRIPTION,
  CODING_AGENT_DATASET_DOWNLOAD_PATH,
  codingAgentDatasetJsonLd,
  codingAgentDatasetModifiedAt,
  codingAgentDatasetSummary,
  currentCodingAgentBenchmarkLeaders,
} from "@/lib/coding-agent-dataset";
import { INDEXABLE_ROBOTS } from "@hraness/web-discovery";

import { searchSite } from "../site";
import { GET, dynamic } from "./coding-agents.json/route";
import DataLayout from "./layout";
import CodingAgentDatasetPage, { metadata } from "./page";

const parsed = parseCodingAgentSnapshot(codingAgentData);
if (!parsed.ok) throw parsed.error;
const snapshot = parsed.value;

describe("coding-agent dataset surface", () => {
  test("publishes canonical, indexable page metadata", () => {
    expect(metadata).toMatchObject({
      title: "Coding Agent Benchmark Dataset | AI Charts",
      description: CODING_AGENT_DATASET_DESCRIPTION,
      alternates: { canonical: "https://aicharts.io/data" },
      robots: INDEXABLE_ROBOTS,
      openGraph: {
        type: "website",
        url: "https://aicharts.io/data",
      },
      twitter: { card: "summary_large_image" },
    });
  });

  test("uses the shared plain-publication shell and semantic navigation", () => {
    const markup = renderToStaticMarkup(
      createElement(
        DataLayout,
        null,
        createElement("main", { id: "data-content" }, "Dataset"),
      ),
    );

    expect(markup).toContain(
      'class="plain-site plain-publication aicharts-data"',
    );
    expect(markup).toContain('href="#data-content"');
    expect(markup).toContain('aria-label="Dataset navigation"');
    expect(markup).toContain('aria-current="page" href="/data"');
    expect(markup).toContain('href="/blog"');
    expect(markup).toContain('href="/"');
    expect(markup.match(/data-presentation="menu"/gu)).toHaveLength(1);
    const headerStart = markup.indexOf('<header class="plain-header">');
    const headerEnd = markup.indexOf("</header>", headerStart);
    const actionsStart = markup.indexOf(
      'class="plain-header__actions"',
      headerStart,
    );
    const navigationStart = markup.indexOf(
      'aria-label="Dataset navigation"',
      actionsStart,
    );
    const navigationEnd = markup.indexOf("</nav>", navigationStart);
    const appearance = markup.indexOf('data-presentation="menu"', actionsStart);
    expect(headerStart).toBeGreaterThan(-1);
    expect(actionsStart).toBeGreaterThan(headerStart);
    expect(navigationStart).toBeGreaterThan(actionsStart);
    expect(navigationEnd).toBeGreaterThan(navigationStart);
    expect(appearance).toBeGreaterThan(navigationEnd);
    expect(appearance).toBeLessThan(headerEnd);
    expect(markup.slice(navigationStart, navigationEnd))
      .not.toContain("hraness-design-theme-toggle");
    expect(markup.slice(appearance, headerEnd)).not.toContain("<a ");
    expect(markup).toContain('class="plain-footer"');
    expect(markup.slice(markup.indexOf('<footer class="plain-footer"')))
      .not.toContain("hraness-design-theme-toggle");
  });

  test("renders literal provenance, definitions, leaders, method, and limits", () => {
    const markup = renderToStaticMarkup(
      createElement(CodingAgentDatasetPage),
    );
    const summary = codingAgentDatasetSummary(snapshot);

    expect(markup).toContain("<h1>Coding-agent benchmark dataset</h1>");
    expect(markup).toContain(CODING_AGENT_DATASET_DESCRIPTION);
    expect(markup).toContain('id="source"');
    expect(markup).toContain('id="benchmarks"');
    expect(markup).toContain('id="leaders"');
    expect(markup).toContain('id="configurations"');
    expect(markup).toContain('id="method"');
    expect(markup).toContain('id="limitations"');
    expect(markup).toContain('scope="row"');
    expect(markup).toContain(snapshot.source.url);
    expect(markup).toContain(snapshot.source.retrievedAt);
    expect(markup).toContain(
      String(summary.recordCount) + " model-agent configurations",
    );
    expect(markup).toContain(
      'href="' + CODING_AGENT_DATASET_DOWNLOAD_PATH + '"',
    );
    expect(markup).toContain("AI Charts does not recalculate");
    expect(markup).toContain("not a real-time mirror");

    for (const definition of CODING_AGENT_BENCHMARK_DEFINITIONS) {
      expect(markup).toContain(definition.label);
      expect(markup).toContain(definition.description);
    }
    for (const leader of currentCodingAgentBenchmarkLeaders(snapshot)) {
      expect(markup).toContain(leader.record.model);
      expect(markup).toContain(leader.value.toFixed(1));
    }
    expect(markup).toContain('href="/blog/aa-index-cost-coding-agents"');
    expect(markup).toContain('id="coding-agent-snapshot"');
    for (const record of snapshot.records) {
      expect(markup).toContain(record.model);
      expect(markup).toContain(record.agent);
      expect(markup).toContain(record.setting);
    }
  });

  test("computes the highest available record for every benchmark", () => {
    const leaders = currentCodingAgentBenchmarkLeaders(snapshot);
    expect(leaders).toHaveLength(CODING_AGENT_BENCHMARK_DEFINITIONS.length);

    for (const leader of leaders) {
      const metric: BenchmarkMetric = leader.definition.id;
      const available = snapshot.records.flatMap((record) => {
        const value = record.benchmarks[metric];
        return value === null ? [] : [value];
      });
      expect(leader.value).toBe(Math.max(...available));
    }
  });

  test("uses the latest notable event as the meaningful modified time", () => {
    expect(codingAgentDatasetModifiedAt(snapshot)).toBe(
      snapshot.updates.reduce<string | undefined>((latest, update) =>
        latest === undefined || Date.parse(update.detectedAt) > Date.parse(latest)
          ? update.detectedAt
          : latest, undefined) ?? snapshot.source.retrievedAt,
    );
    const first = snapshot.updates[0];
    const second = snapshot.updates[1];
    if (first !== undefined && second !== undefined) {
      expect(codingAgentDatasetModifiedAt({
        ...snapshot,
        updates: [second, first],
      })).toBe(
        Date.parse(first.detectedAt) > Date.parse(second.detectedAt)
          ? first.detectedAt
          : second.detectedAt,
      );
    }
    expect(codingAgentDatasetModifiedAt({
      ...snapshot,
      updates: [],
    })).toBe(snapshot.source.retrievedAt);
  });

  test("emits Dataset JSON-LD that matches the page and download", () => {
    const data = codingAgentDatasetJsonLd(snapshot, searchSite);

    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Dataset",
      "@id": "https://aicharts.io/data#dataset",
      citation: snapshot.source.url,
      creator: {
        "@type": "Organization",
        name: snapshot.source.name,
        url: snapshot.source.url,
      },
      dateModified: codingAgentDatasetModifiedAt(snapshot),
      description: CODING_AGENT_DATASET_DESCRIPTION,
      distribution: {
        "@type": "DataDownload",
        contentUrl: "https://aicharts.io/data/coding-agents.json",
        encodingFormat: "application/json",
      },
      isBasedOn: snapshot.source.url,
      publisher: {
        "@type": "Organization",
        name: "AI Charts",
        url: "https://aicharts.io/",
      },
      url: "https://aicharts.io/data",
      version: snapshot.source.retrievedAt,
    });
    expect(data.variableMeasured.map(variable => variable.name)).toEqual([
      "AA Index",
      "DeepSWE",
      "Terminal-Bench v2",
      "SWE-Atlas-QnA",
      "API cost per task",
      "Active time per task",
      "Total tokens per task",
    ]);
  });
});

describe("coding-agent JSON download", () => {
  test("serves the checked snapshot with download and freshness headers", async () => {
    expect(dynamic).toBe("force-static");
    const response = GET();
    const body: unknown = await response.json();
    const downloaded = parseCodingAgentSnapshot(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="aicharts-coding-agent-benchmarks.json"',
    );
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=3600");
    expect(response.headers.get("Last-Modified")).toBe(
      new Date(snapshot.source.retrievedAt).toUTCString(),
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(downloaded.ok).toBe(true);
    if (downloaded.ok) expect(downloaded.value).toEqual(snapshot);
  });
});
