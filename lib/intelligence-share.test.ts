import { describe, expect, test } from "bun:test";

import {
  intelligenceShareIdentity,
  intelligenceShareSearch,
  parseIntelligenceShareView,
} from "./intelligence-share";

const records = [
  { id: "uuid-astra", slug: "gpt-6-astra" },
  { id: "uuid-fable-max", slug: "claude-fable-5-1" },
  { id: "uuid-fable-xhigh", slug: "claude-fable-5-1-xhigh" },
  { id: "uuid-dup-a", slug: "shared-slug" },
  { id: "uuid-dup-b", slug: "shared-slug" },
] as const;

const defaults = { metric: "costUsdPerTask" as const, pinnedId: "uuid-astra" };

describe("intelligence share URLs", () => {
  test("prefers unique slugs and falls back to opaque ids on collision", () => {
    expect(intelligenceShareIdentity(records, "uuid-fable-xhigh")).toBe("claude-fable-5-1-xhigh");
    expect(intelligenceShareIdentity(records, "uuid-dup-a")).toBe("uuid-dup-a");
    expect(intelligenceShareIdentity(records, "missing")).toBeNull();
  });

  test("round-trips encoded slug and token-metric selections", () => {
    const search = intelligenceShareSearch(
      { metric: "outputTokensPerTask", pinnedId: "uuid-fable-max" },
      records,
      defaults,
      "utm=notes",
    );
    const url = new URL(`https://aicharts.io/?${search}`);
    expect(url.searchParams.get("utm")).toBe("notes");
    expect(url.searchParams.get("model")).toBe("claude-fable-5-1");
    expect(url.searchParams.get("resource")).toBe("tokens");
    expect(search).not.toContain(" ");
    expect(parseIntelligenceShareView(`?${search}`, records, defaults)).toEqual({
      metric: "outputTokensPerTask",
      pinnedId: "uuid-fable-max",
    });
  });

  test("keeps the default homepage URL empty and restores either slug or id", () => {
    expect(intelligenceShareSearch(defaults, records, defaults)).toBe("");
    expect(parseIntelligenceShareView("", records, defaults)).toEqual(defaults);
    expect(parseIntelligenceShareView("?model=uuid-fable-xhigh", records, defaults).pinnedId)
      .toBe("uuid-fable-xhigh");
    expect(parseIntelligenceShareView("?model=unknown", records, defaults)).toEqual(defaults);
  });
});
