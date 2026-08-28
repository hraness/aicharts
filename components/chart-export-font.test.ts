import { describe, expect, test } from "bun:test";

import { nebulaSansSocialFonts } from "@hraness/design-kit/fonts/nebula-sans/social";

import { createNebulaSansSvgFontResource } from "./chart-export-font";

describe("isolated chart export fonts", () => {
  test("embeds both immutable Nebula Sans OTF payloads with provenance", async () => {
    const first = await createNebulaSansSvgFontResource();
    const second = await createNebulaSansSvgFontResource();
    expect(second).toEqual(first);

    const embeddedPayloads = [...first.css.matchAll(
      /src:url\("data:font\/otf;base64,([^"]+)"\) format\("opentype"\)/gu,
    )].map(match => match[1] ?? "");
    const sourceFonts = [...nebulaSansSocialFonts()]
      .toSorted((left, right) => left.weight - right.weight);

    expect(embeddedPayloads).toHaveLength(2);
    expect(sourceFonts.map(font => font.weight)).toEqual([400, 700]);
    for (const [index, payload] of embeddedPayloads.entries()) {
      const source = sourceFonts[index];
      if (source === undefined) throw new Error("Expected an immutable Nebula Sans source font.");
      expect(Buffer.from(payload, "base64")).toEqual(Buffer.from(source.data));
      expect(Buffer.from(payload, "base64").subarray(0, 4).toString("ascii")).toBe("OTTO");
    }

    expect(first.metadata).toContain("SIL Open Font License, Version 1.1");
    expect(first.metadata).toContain("Reserved Font Name 'Nebula'");
    expect(first.metadata).toContain(
      "a9b56ef15e24b6e8195af7457cc75f714ecf5501fc3c20a69f546c8f589e7bdb",
    );
    expect(first.metadata).toContain("unmodified NebulaSans-Book.otf (400)");
    expect(first.metadata).toContain("NebulaSans-Bold.otf (700)");
  });
});
