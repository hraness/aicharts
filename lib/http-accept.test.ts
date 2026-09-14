import { describe, expect, test } from "bun:test";

import {
  HTML_MEDIA_TYPE,
  MARKDOWN_MEDIA_TYPE,
  appendVaryAccept,
  parseAccept,
  preferredType,
} from "./http-accept";

describe("Accept parsing", () => {
  test("preserves client order and reads q-values", () => {
    expect(parseAccept("text/markdown, text/html;q=0.8, */*;q=0.1")).toEqual([
      { position: 0, q: 1, specificity: 2, type: "text/markdown" },
      { position: 1, q: 0.8, specificity: 2, type: "text/html" },
      { position: 2, q: 0.1, specificity: 0, type: "*/*" },
    ]);
  });

  test("treats an empty token list as no entries", () => {
    expect(parseAccept("")).toEqual([]);
    expect(parseAccept("   ,  ,")).toEqual([]);
  });
});

describe("preferred representation", () => {
  test("defaults to HTML when Accept is missing or empty", () => {
    expect(preferredType(null)).toBe(HTML_MEDIA_TYPE);
    expect(preferredType("")).toBe(HTML_MEDIA_TYPE);
    expect(preferredType("   ")).toBe(HTML_MEDIA_TYPE);
  });

  test("picks text/markdown when it appears before text/html at the same q", () => {
    expect(preferredType("text/markdown, text/html, */*")).toBe(MARKDOWN_MEDIA_TYPE);
  });

  test("picks the higher q-value even when markdown is listed first", () => {
    expect(preferredType("text/markdown;q=0.4, text/html;q=0.9")).toBe(HTML_MEDIA_TYPE);
  });

  test("lets a more specific range override a wildcard regardless of q", () => {
    expect(preferredType("text/html;q=0, */*;q=1")).toBe(MARKDOWN_MEDIA_TYPE);
  });

  test("returns null when every produced type is rejected or unmatched", () => {
    expect(preferredType("application/pdf")).toBeNull();
    expect(preferredType("text/markdown;q=0, text/html;q=0")).toBeNull();
  });

  test("honors */* as a match for the default HTML type", () => {
    expect(preferredType("*/*")).toBe(HTML_MEDIA_TYPE);
  });
});

describe("Vary: Accept", () => {
  test("adds Accept when Vary is missing or already lists other tokens", () => {
    const empty = new Headers();
    appendVaryAccept(empty);
    expect(empty.get("Vary")).toBe("Accept");

    const existing = new Headers({ Vary: "rsc, next-router-prefetch" });
    appendVaryAccept(existing);
    expect(existing.get("Vary")).toBe("rsc, next-router-prefetch, Accept");
  });

  test("does not duplicate Accept", () => {
    const headers = new Headers({ Vary: "Accept, Accept-Encoding" });
    appendVaryAccept(headers);
    expect(headers.get("Vary")).toBe("Accept, Accept-Encoding");
  });
});
