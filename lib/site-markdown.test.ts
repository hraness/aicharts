import { describe, expect, test } from "bun:test";

import { articleToMarkdown, blogArticles } from "@/app/blog/articles";
import { homeHeading, notFoundRecoveryLinks, site } from "@/app/site";
import codingAgentData from "@/data/coding-agents.json";

import { parseCodingAgentSnapshot } from "./coding-agent-data";
import {
  CODING_AGENT_DATASET_DESCRIPTION,
  codingAgentDatasetSummary,
} from "./coding-agent-dataset";
import {
  AGENT_GUIDE_CONTENT_TYPE,
  MARKDOWN_CONTENT_TYPE,
  agentGuideMarkdown,
  homeDocumentText,
  markdownForPath,
  notFoundMarkdown,
} from "./site-markdown";

const parsed = parseCodingAgentSnapshot(codingAgentData);
if (!parsed.ok) throw parsed.error;
const snapshot = parsed.value;

describe("homepage document", () => {
  test("has the product heading and more than 500 characters of text", () => {
    const text = homeDocumentText(snapshot);
    expect(text.startsWith(homeHeading)).toBeTrue();
    expect(text).toContain(site.description);
    expect(text).toContain(String(codingAgentDatasetSummary(snapshot).recordCount));
    expect(text.length).toBeGreaterThan(500);
  });
});

describe("markdown representations", () => {
  test("serves the homepage, dataset, blog, and agent guide", () => {
    const home = markdownForPath("/");
    const data = markdownForPath("/data");
    const blog = markdownForPath("/blog");
    const guide = markdownForPath("/llms.txt");

    expect(home).toMatchObject({ found: true, contentType: MARKDOWN_CONTENT_TYPE });
    expect(home.body).toContain(`# ${homeHeading}`);
    expect(home.body).toContain(site.origin);
    expect(home.body).toContain("| Model | Agent | Setting | AA Index | Cost |");
    expect(home.body).toContain(snapshot.records[0]?.model ?? "");
    expect(data.body).toContain(CODING_AGENT_DATASET_DESCRIPTION);
    expect(data.body).toContain(snapshot.source.url);
    expect(data.body).toContain("## All configurations");
    expect(data.body).toContain("| Model | Agent | Provider | Setting | AA Index | DeepSWE | Terminal-Bench v2 | SWE-Atlas-QnA | Cost |");
    expect(blog.body).toContain(blogArticles[0].title);
    expect(guide).toMatchObject({ found: true, contentType: AGENT_GUIDE_CONTENT_TYPE });
    expect(guide.body).toBe(agentGuideMarkdown(snapshot));
  });

  test("renders each blog article from the authored blocks", () => {
    for (const article of blogArticles) {
      const document = markdownForPath(`/blog/${article.slug}`);
      expect(document.found).toBeTrue();
      expect(document.body).toBe(articleToMarkdown(article));
      expect(document.body).toContain(`# ${article.title}`);
      expect(document.body).toContain(article.dek);
    }
  });

  test("returns a 404 markdown recovery document for unknown paths", () => {
    const missing = markdownForPath("/this-path-does-not-exist-agentic");
    expect(missing).toEqual({
      body: notFoundMarkdown(),
      contentType: MARKDOWN_CONTENT_TYPE,
      found: false,
    });
    for (const link of notFoundRecoveryLinks) {
      expect(missing.body).toContain(`](${site.origin}${link.href === "/" ? "/" : link.href})`);
    }
  });
});

describe("agent instruction file", () => {
  test("names when to use the existing chart, dataset, and notes", () => {
    const guide = agentGuideMarkdown(snapshot);
    expect(guide).toContain("## When to use AI Charts");
    expect(guide).toContain("Use AI Charts when you need a sourced comparison of coding agents");
    expect(guide).toContain("Do not treat AI Charts as a live API, ranker, or production SLA");
    expect(guide).toContain("/data/coding-agents.json");
    expect(guide).toContain("Accept: text/markdown");
    expect(guide).toContain("It does not expose OAuth, GraphQL, MCP, or commerce endpoints.");
  });
});
