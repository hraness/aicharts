import { describe, expect, test } from "bun:test";

import { markdownForPath } from "@/lib/site-markdown";
import { CANONICAL_MARKDOWN_REQUEST_HEADER } from "@/lib/markdown-http";

import { GET } from "./[[...slug]]/route";

async function readMarkdown(
  slug?: string[],
  canonicalRepresentation = false,
): Promise<Response> {
  return GET(new Request("https://aicharts.io/api/markdown", {
    headers: canonicalRepresentation
      ? { [CANONICAL_MARKDOWN_REQUEST_HEADER]: "1" }
      : undefined,
  }), {
    params: Promise.resolve({ slug }),
  });
}

describe("markdown route handler", () => {
  test("serves known pages as text/markdown with Vary: Accept", async () => {
    const response = await readMarkdown();
    const expected = markdownForPath("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(expected.contentType);
    expect(response.headers.get("Vary")).toBe("Accept");
    expect(response.headers.get("Link"))
      .toBe('<https://aicharts.io/>; rel="canonical"');
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, follow");
    expect(await response.text()).toBe(expected.body);
  });

  test("keeps negotiated Markdown indexable at the canonical page URL", async () => {
    const response = await readMarkdown(["data"], true);

    expect(response.status).toBe(200);
    expect(response.headers.get("Link"))
      .toBe('<https://aicharts.io/data>; rel="canonical"');
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });

  test("preserves canonical negotiation for each focused comparison workspace", async () => {
    for (const path of ["coding", "benchmarks"]) {
      for (const negotiated of [false, true]) {
        const response = await readMarkdown([path], negotiated);
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
        expect(response.headers.get("Vary")).toBe("Accept");
        expect(response.headers.get("Link")).toBe(`<https://aicharts.io/${path}>; rel="canonical"`);
        expect(response.headers.get("X-Robots-Tag")).toBe(negotiated ? null : "noindex, follow");
        expect(await response.text()).toBe(markdownForPath(`/${path}`).body);
      }
    }
  });

  test("serves /usage as Markdown with its canonical page URL", async () => {
    for (const negotiated of [false, true]) {
      const response = await readMarkdown(["usage"], negotiated);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
      expect(response.headers.get("Vary")).toBe("Accept");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Link")).toBe('<https://aicharts.io/usage>; rel="canonical"');
      // Only the negotiated representation of the canonical URL is indexable; the .md alias is not.
      expect(response.headers.get("X-Robots-Tag")).toBe(negotiated ? null : "noindex, follow");
      expect(await response.text()).toBe(markdownForPath("/usage").body);
    }
  });

  test("answers unknown usage Markdown paths with 404", async () => {
    for (const slug of [["usage", "missing"], ["usage", "details"], ["usage", "sessions"], ["usage", "pairing"]]) {
      const response = await readMarkdown(slug, true);
      expect(response.status, slug.join("/")).toBe(404);
      expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
      expect(response.headers.get("Link")).toBeNull();
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex, follow");
    }
  });

  test("keeps a real 404 status and recovery body for unknown paths", async () => {
    const response = await readMarkdown(["missing-agentic-path"]);
    const expected = markdownForPath("/missing-agentic-path");

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe(expected.contentType);
    expect(response.headers.get("Link")).toBeNull();
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, follow");
    expect(await response.text()).toBe(expected.body);
    expect(expected.found).toBeFalse();
  });
});
