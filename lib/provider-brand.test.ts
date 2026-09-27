import { describe, expect, test } from "bun:test";

import { providerMark, providerMarkGlyphDataUri } from "@hraness/design-kit";
import { providerColors } from "./chart-colors.generated";
import { brandMonogram, chipGlyphColor, providerBrand } from "./provider-brand";

function registeredIconUrl(identity: string): string {
  const mark = providerMark(identity);
  if (mark === undefined) throw new Error(`Test expects a registered mark for ${identity}.`);
  return providerMarkGlyphDataUri(mark, "#f7f6f2");
}

describe("provider brand resolution", () => {
  test("charted providers get their generated chart color and registry icon", () => {
    const openAi = providerBrand("OpenAI");
    expect(openAi.chipColor).toBe(providerColors.openai);
    expect(openAi.iconUrl).toBe(registeredIconUrl("openai"));

    const nvidia = providerBrand("NVIDIA");
    expect(nvidia.chipColor).toBe(providerColors.nvidia);
    expect(nvidia.iconUrl).toBe(registeredIconUrl("nvidia"));
  });

  test("folds the naming variants benchmark sources actually publish", () => {
    for (const alias of ["SpaceXAI", "xAI", "xai"]) {
      expect(providerBrand(alias).chipColor).toBe(providerColors.xai);
      expect(providerBrand(alias).iconUrl).toBe(registeredIconUrl("xai"));
    }
    for (const alias of ["Z AI", "Z.AI", "Z.ai", "zai"]) {
      expect(providerBrand(alias).chipColor).toBe(providerColors.z_ai);
    }
    expect(providerBrand("Google DeepMind").iconUrl).toBe(registeredIconUrl("gemini"));
    expect(providerBrand("Kimi").chipColor).toBe(providerColors.moonshot_ai);
    expect(providerBrand("Moonshot AI").iconUrl).toBe(registeredIconUrl("moonshot"));
    expect(providerBrand("Alibaba").chipColor).toBe(providerColors.alibaba_cloud);
    expect(providerBrand("Anthropic").iconUrl).toBe(registeredIconUrl("anthropic"));
  });

  test("matches a source slug when the display name is unknown", () => {
    const brand = providerBrand("Some New Lab Name", "openai");
    expect(brand.chipColor).toBe(providerColors.openai);
    expect(brand.iconUrl).toBe(registeredIconUrl("openai"));
    expect(brand.monogram).toBe("SN");
  });

  test("cognition keeps its chart color with the registered Devin mark", () => {
    const brand = providerBrand("Cognition");
    expect(brand.chipColor).toBe(providerColors.cognition);
    expect(brand.iconUrl).toBe(registeredIconUrl("devin"));
    expect(brand.monogram).toBe("C");
  });

  test("unknown providers get the neutral chip and a name monogram", () => {
    const brand = providerBrand("Thinking Machines");
    expect(brand.chipColor).toBe("#6f6962");
    expect(brand.iconUrl).toBeNull();
    expect(brand.monogram).toBe("TM");
  });

  test("monograms survive punctuation and empty names", () => {
    expect(brandMonogram("Z.ai")).toBe("Z");
    expect(brandMonogram("  ")).toBe("AI");
    expect(brandMonogram("Multiverse Computing")).toBe("MC");
  });
});

describe("chip glyph contrast", () => {
  test("light chips get the dark glyph and dark chips get the light glyph", () => {
    expect(chipGlyphColor(providerColors.cognition)).toBe("#1c1917");
    expect(chipGlyphColor(providerColors.meta)).toBe("#1c1917");
    expect(chipGlyphColor(providerColors.openai)).toBe("#f7f6f2");
    expect(chipGlyphColor(providerColors.nvidia)).toBe("#f7f6f2");
    expect(chipGlyphColor("#ffffff")).toBe("#1c1917");
    expect(chipGlyphColor("#000000")).toBe("#f7f6f2");
  });

  test("an unparsable color falls back to the light glyph", () => {
    expect(chipGlyphColor("rebeccapurple")).toBe("#f7f6f2");
  });

  test("every generated provider color resolves a readable glyph", () => {
    for (const color of Object.values(providerColors)) {
      expect(["#1c1917", "#f7f6f2"]).toContain(chipGlyphColor(color));
    }
  });
});
