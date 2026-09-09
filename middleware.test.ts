import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

import { CANONICAL_MARKDOWN_REQUEST_HEADER } from "@/lib/markdown-http";

import { middleware } from "./middleware";

function request(
  path: string,
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest(new URL(path, "https://aicharts.io"), { headers });
}

describe("markdown content negotiation", () => {
  test("rewrites Accept: text/markdown to the markdown handler and sets Vary", () => {
    const response = middleware(request("/", { Accept: "text/markdown" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain("/api/markdown");
    expect(response.headers.get(`x-middleware-request-${CANONICAL_MARKDOWN_REQUEST_HEADER}`))
      .toBe("1");
    expect(response.headers.get("Vary")).toContain("Accept");
  });

  test("rewrites explicit .md URLs regardless of Accept", () => {
    for (const [path, expected] of [
      ["/data.md", "/api/markdown/data"],
      ["/coding.md", "/api/markdown/coding"],
      ["/benchmarks.md", "/api/markdown/benchmarks"],
      ["/blog/terminal-bench-science.md", "/api/markdown/blog/terminal-bench-science"],
      ["/models/openai/gpt-5.6-sol/max.md", "/api/markdown/models/openai/gpt-5.6-sol/max"],
    ] as const) {
      const response = middleware(request(path, { Accept: "text/html" }));
      expect(response.headers.get("x-middleware-rewrite")).toContain(expected);
      expect(response.headers.get(`x-middleware-request-${CANONICAL_MARKDOWN_REQUEST_HEADER}`))
        .toBeNull();
      expect(response.headers.get("Vary")).toContain("Accept");
    }
  });

  test("returns 406 when no produced type matches", () => {
    const response = middleware(request("/", { Accept: "application/pdf" }));
    expect(response.status).toBe(406);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Vary")).toBe("Accept");
    return expect(response.text()).resolves.toContain("Available: text/html, text/markdown");
  });

  test("leaves HTML and Next.js data requests alone while adding Vary on HTML", () => {
    const html = middleware(request("/", { Accept: "text/html" }));
    expect(html.headers.get("x-middleware-rewrite")).toBeNull();
    expect(html.headers.get("Vary")).toContain("Accept");

    const rsc = middleware(request("/", {
      Accept: "text/x-component",
      RSC: "1",
    }));
    expect(rsc.headers.get("x-middleware-rewrite")).toBeNull();
    expect(rsc.status).not.toBe(406);
  });

  test("negotiates only known HTML page routes", () => {
    for (const path of [
      "/",
      "/data",
      "/coding",
      "/benchmarks",
      "/models",
      "/models/openai/gpt-5.6-sol/max",
      "/blog",
      "/blog/terminal-bench-science",
    ]) {
      const response = middleware(request(path, { Accept: "text/markdown" }));
      expect(response.headers.get("x-middleware-rewrite")).toContain("/api/markdown");
    }
  });

  test("leaves every non-HTML public representation untouched", () => {
    const representations = [
      ["/data/benchmark-atlas.json", "application/json"],
      ["/data/benchmark-atlas/terminal-bench-4", "application/json"],
      ["/data/benchmark-atlas/arc-agi-2", "application/json"],
      ["/data/artificial-analysis-intelligence.json", "application/json"],
      ["/data/coding-agents.json", "application/json"],
      ["/data/terminal-bench-4.json", "application/json"],
      ["/data/terminal-bench-science-0-1.json", "application/json"],
      ["/blog/feed.xml", "application/atom+xml"],
      ["/llms.txt", "text/plain"],
      ["/robots.txt", "text/plain"],
      ["/sitemap.xml", "application/xml"],
      ["/icon.svg", "image/svg+xml"],
      ["/images/blog/terminal-bench-science.webp", "image/webp"],
      ["/opengraph-image", "image/png"],
      ["/models/opengraph-image-v7", "image/png"],
      ["/models/openai/gpt-5.6-sol/max/card.png", "image/png"],
      ["/models/openai/gpt-5.6-sol/max/opengraph-image", "image/png"],
    ] as const;

    for (const [path, accept] of representations) {
      for (const requestedType of [accept, "text/markdown", "application/pdf"]) {
        const response = middleware(request(path, { Accept: requestedType }));
        expect(response.headers.get("x-middleware-rewrite")).toBeNull();
        expect(response.status).toBe(200);
      }
    }
  });

  test("leaves inert Hraness previews on their single HTML representation", () => {
    for (const path of ["/preview", "/models/preview"]) {
      const markdown = middleware(request(path, {
        Accept: "text/markdown",
      }));
      const unsupported = middleware(request(path, {
        Accept: "application/pdf",
      }));

      expect(markdown.headers.get("x-middleware-rewrite")).toBeNull();
      expect(markdown.status).toBe(200);
      expect(unsupported.headers.get("x-middleware-rewrite")).toBeNull();
      expect(unsupported.status).toBe(200);
    }
  });
});

describe("old homepage comparison links", () => {
  test("redirects legacy chart state before negotiating its new canonical page", () => {
    for (const accept of ["text/html", "text/markdown", "text/x-component"]) {
      const response = middleware(request("/?atlas=arc-agi-2&atlasCompare=a&atlasCompare=b", { Accept: accept }));
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe("https://aicharts.io/benchmarks?atlas=arc-agi-2&atlasCompare=a&atlasCompare=b");
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
    expect(middleware(request("/?benchmark=deepSwe&compare=costUsd&point=id")).headers.get("location"))
      .toBe("https://aicharts.io/coding?benchmark=deepSwe&compare=costUsd&point=id");
  });
  test("does not redirect new destinations, normal home visits, or posted content", () => {
    for (const path of ["/", "/?utm_source=notes", "/coding?benchmark=deepSwe", "/benchmarks?atlas=arc-agi-2"]) {
      expect(middleware(request(path)).headers.get("location")).toBeNull();
    }
    const post = new NextRequest("https://aicharts.io/?atlas=arc-agi-2", { method: "POST" });
    expect(middleware(post).headers.get("location")).toBeNull();
  });
});
