import { existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeDocument } from "@/components/home-document";
import { HomeLeaders } from "@/components/home-leaders";
import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  currentCodingAgentBenchmarkLeaders,
  formatBenchmarkScore,
} from "@/lib/coding-agent-dataset";
import { homeDocumentModel, homeDocumentText } from "@/lib/site-markdown";

import Home from "./page";

const parsed = parseCodingAgentSnapshot(codingAgentData);
if (!parsed.ok) throw parsed.error;
const snapshot = parsed.value;

describe("homepage agent document", () => {
  test("server-renders only the accessible leaders table in the visible opening block", () => {
    const markup = renderToStaticMarkup(createElement(HomeLeaders, { snapshot }));
    const leaders = currentCodingAgentBenchmarkLeaders(snapshot);

    expect(markup).toContain('aria-label="Current coding-agent benchmark leaders"');
    expect(markup).not.toContain("<h1");
    expect(markup).not.toContain("<h2");
    expect(markup).not.toContain("<p");
    expect(markup).toContain("<table");
    expect(markup).toContain("<caption>Highest score by benchmark in the current snapshot</caption>");
    expect(markup).toContain("<th scope=\"col\">Benchmark</th>");
    expect(markup).toContain("<th scope=\"col\">Score</th>");
    for (const leader of leaders) {
      expect(markup).toContain(leader.definition.label);
      expect(markup).toContain(leader.record.model);
      expect(markup).toContain(leader.record.agent);
      expect(markup).toContain(leader.record.providerName);
      expect(markup).toContain(leader.record.setting);
      expect(markup).toContain(formatBenchmarkScore(leader.value));
    }
    expect(markup).not.toContain("Loading chart");
  });

  test("keeps the clipped document on the server page after the leaders block", () => {
    const document = homeDocumentModel(snapshot);
    const markup = renderToStaticMarkup(createElement(HomeDocument, { document, snapshot }));
    const text = homeDocumentText(snapshot);

    expect(markup).toContain('class="home-document"');
    expect(markup).not.toContain("<h1");
    expect(markup).not.toContain('id="coding-agent-snapshot"');
    expect(markup).toContain('href="/data"');
    expect(markup).toContain('href="/blog/aa-index-cost-coding-agents"');
    expect(markup).toContain('href="/llms.txt"');
    expect(markup).toContain('href="/sitemap.xml"');
    expect(text.length).toBeGreaterThan(500);
    expect(text).toContain(document.paragraphs[0] ?? "");
  });

  test("mounts visible leaders before the chart explorer and has no root loading fallback", async () => {
    const source = await Bun.file(new URL("./page.tsx", import.meta.url)).text();
    const leadersAt = source.indexOf("<HomeLeaders");
    const explorerAt = source.indexOf("<CodingAgentExplorer");
    const loadingAt = source.indexOf("Loading chart");

    expect(leadersAt).toBeGreaterThan(-1);
    expect(explorerAt).toBeGreaterThan(leadersAt);
    expect(loadingAt).toBe(-1);
    expect(source).toContain("heading: site.domain");
    expect(existsSync(new URL("./loading.tsx", import.meta.url))).toBeFalse();
    expect(Home.name).toBe("Home");
  });
});
