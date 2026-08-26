import { describe, expect, test } from "bun:test";

import {
  isLobeModelIconKey,
  lobeModelIconKeys,
  modelIconDataUrl,
} from "./model-card-icons";

describe("model card icons", () => {
  test("keeps the supported icon keys unique and guarded", () => {
    expect(new Set(lobeModelIconKeys).size).toBe(lobeModelIconKeys.length);
    for (const key of lobeModelIconKeys) expect(isLobeModelIconKey(key)).toBe(true);
    expect(isLobeModelIconKey("anthropic")).toBe(false);
    expect(isLobeModelIconKey("google")).toBe(false);
  });

  test("loads every pinned Lobe icon as an SVG data URL", () => {
    for (const key of lobeModelIconKeys) {
      const first = modelIconDataUrl(key);
      expect(first.startsWith("data:image/svg+xml;base64,")).toBe(true);
      expect(Buffer.from(first.split(",")[1] ?? "", "base64").toString("utf8"))
        .toContain("<svg");
      expect(modelIconDataUrl(key)).toBe(first);
    }
  });

  test("creates a deterministic neutral monogram for an uncatalogued provider", () => {
    const first = modelIconDataUrl(null, "Example Research");
    const svg = Buffer.from(first.split(",")[1] ?? "", "base64").toString("utf8");
    expect(svg).toContain(">ER<");
    expect(svg).toContain("#f7f6f2");
    expect(modelIconDataUrl(null, "Example Research")).toBe(first);
  });
});
