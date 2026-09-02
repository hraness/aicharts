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
