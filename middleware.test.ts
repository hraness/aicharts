import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

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
    expect(response.headers.get("Vary")).toContain("Accept");
  });

  test("rewrites explicit .md URLs regardless of Accept", () => {
    const response = middleware(request("/data.md", { Accept: "text/html" }));
    expect(response.headers.get("x-middleware-rewrite")).toContain("/api/markdown/data");
    expect(response.headers.get("Vary")).toContain("Accept");
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

  test("does not negotiate the JSON snapshot or generated search files", () => {
    const json = middleware(request("/data/coding-agents.json", {
      Accept: "text/markdown",
    }));
    const sitemap = middleware(request("/sitemap.xml", { Accept: "text/markdown" }));
    expect(json.headers.get("x-middleware-rewrite")).toBeNull();
    expect(sitemap.headers.get("x-middleware-rewrite")).toBeNull();
  });

  test("does not negotiate generated model-card images", () => {
    const portrait = middleware(request(
      "/models/openai/gpt-5.6-sol/max/card.png",
      { Accept: "image/png" },
    ));
    const social = middleware(request(
      "/models/openai/gpt-5.6-sol/max/opengraph-image",
      { Accept: "image/png" },
    ));
    expect(portrait.headers.get("x-middleware-rewrite")).toBeNull();
    expect(portrait.status).not.toBe(406);
    expect(social.headers.get("x-middleware-rewrite")).toBeNull();
    expect(social.status).not.toBe(406);
  });
});
