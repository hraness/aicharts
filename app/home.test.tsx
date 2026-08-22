import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeDocument } from "@/components/home-document";
import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import { codingAgentSnapshotRows } from "@/lib/coding-agent-snapshot-rows";
import { homeDocumentModel, homeDocumentText } from "@/lib/site-markdown";

import Loading from "./loading";
import Home from "./page";
import { homeHeading } from "./site";

const parsed = parseCodingAgentSnapshot(codingAgentData);
if (!parsed.ok) throw parsed.error;
const snapshot = parsed.value;

describe("homepage agent document", () => {
  test("server-renders an H1, snapshot table, and more than 500 characters of text", () => {
    const document = homeDocumentModel(snapshot);
    const markup = renderToStaticMarkup(createElement(HomeDocument, { document, snapshot }));
    const text = homeDocumentText(snapshot);
    const rows = codingAgentSnapshotRows(snapshot.records);

    expect(markup).toContain(`<h1 id="home-document-heading">${homeHeading}</h1>`);
    expect(markup).toContain('class="home-document"');
    expect(markup).toContain('id="coding-agent-snapshot"');
    expect(markup).toContain("<table");
    expect(markup).toContain('href="/data"');
    expect(markup).toContain('href="/blog/aa-index-cost-coding-agents"');
    expect(markup).toContain('href="/llms.txt"');
    expect(markup).toContain('href="/sitemap.xml"');
    expect(text.length).toBeGreaterThan(500);
    expect(text).toContain(document.paragraphs[0] ?? "");
    expect(rows.length).toBe(snapshot.records.length);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(markup).toContain(row.model);
      expect(markup).toContain(row.agent);
    }
  });

  test("keeps the snapshot table in the loading fallback beside Loading chart", () => {
    const markup = renderToStaticMarkup(createElement(Loading));
    expect(markup).toContain('id="coding-agent-snapshot"');
    expect(markup).toContain("Loading chart…");
    expect(markup).toContain(snapshot.records[0]?.model ?? "");
  });

  test("keeps the document on the server page beside the chart", async () => {
    const source = await Bun.file(new URL("./page.tsx", import.meta.url)).text();
    expect(source).toContain("<HomeDocument");
    expect(source).toContain("<CodingAgentExplorer");
    expect(Home.name).toBe("Home");
  });
});
