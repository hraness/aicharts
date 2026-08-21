import { describe, expect, test } from "bun:test";

import { markdownForPath } from "@/lib/site-markdown";

import { GET } from "./[[...slug]]/route";

async function readMarkdown(slug?: string[]): Promise<Response> {
  return GET(new Request("https://aicharts.io/api/markdown"), {
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
    expect(await response.text()).toBe(expected.body);
  });

  test("keeps a real 404 status and recovery body for unknown paths", async () => {
    const response = await readMarkdown(["missing-agentic-path"]);
    const expected = markdownForPath("/missing-agentic-path");

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe(expected.contentType);
    expect(await response.text()).toBe(expected.body);
    expect(expected.found).toBeFalse();
  });
});
