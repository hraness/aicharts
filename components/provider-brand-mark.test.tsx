import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { providerMark, providerMarkGlyphDataUri } from "@hraness/design-kit";
import { ProviderBrandLabel, ProviderBrandMark } from "./provider-brand-mark";

describe("provider brand mark", () => {
  test("renders a masked registry glyph for a charted lab", () => {
    const html = renderToStaticMarkup(<ProviderBrandMark displayName="OpenAI" />);
    const openAiMark = providerMark("openai");
    expect(openAiMark).not.toBeUndefined();
    expect(html).toContain("provider-brand-mark--inline");
    expect(html).toContain("--option-picker-icon:url(");
    expect(html).toContain(providerMarkGlyphDataUri(openAiMark!, "#f7f6f2"));
    expect(html).toContain("option-picker__glyph");
    expect(html).not.toContain("OA");
  });

  test("falls back to a monogram when no pinned icon exists", () => {
    const html = renderToStaticMarkup(
      <ProviderBrandLabel displayName="Thinking Machines" />,
    );
    expect(html).toContain("provider-brand-label");
    expect(html).toContain("TM");
    expect(html).toContain("Thinking Machines");
    expect(html).not.toContain("option-picker__glyph");
  });
});
