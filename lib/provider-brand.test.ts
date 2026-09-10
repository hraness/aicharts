import { describe, expect, test } from "bun:test";

import { providerColors } from "./chart-colors.generated";
import { lobeModelIconDataUrls } from "./model-card-icons.generated";
import { brandMonogram, chipGlyphColor, providerBrand } from "./provider-brand";

describe("provider brand resolution", () => {
  test("charted providers get their generated chart color and pinned icon", () => {
    const openAi = providerBrand("OpenAI");
    expect(openAi.chipColor).toBe(providerColors.openai);
    expect(openAi.iconUrl).toBe(lobeModelIconDataUrls.openai);

    const nvidia = providerBrand("NVIDIA");
    expect(nvidia.chipColor).toBe(providerColors.nvidia);
    expect(nvidia.iconUrl).toBe(lobeModelIconDataUrls.nvidia);
  });

  test("folds the naming variants benchmark sources actually publish", () => {
    for (const alias of ["SpaceXAI", "xAI", "xai"]) {
      expect(providerBrand(alias).chipColor).toBe(providerColors.xai);
      expect(providerBrand(alias).iconUrl).toBe(lobeModelIconDataUrls.xai);
    }
    for (const alias of ["Z AI", "Z.AI", "Z.ai", "zai"]) {
      expect(providerBrand(alias).chipColor).toBe(providerColors.z_ai);
    }
    expect(providerBrand("Google DeepMind").iconUrl).toBe(lobeModelIconDataUrls.gemini);
    expect(providerBrand("Kimi").chipColor).toBe(providerColors.moonshot_ai);
    expect(providerBrand("Moonshot AI").iconUrl).toBe(lobeModelIconDataUrls.moonshot);
    expect(providerBrand("Alibaba").chipColor).toBe(providerColors.alibaba_cloud);
    expect(providerBrand("Anthropic").iconUrl).toBe(lobeModelIconDataUrls.claude);
  });

  test("matches a source slug when the display name is unknown", () => {
    const brand = providerBrand("Some New Lab Name", "openai");
    expect(brand.chipColor).toBe(providerColors.openai);
    expect(brand.monogram).toBe("SN");
  });

  test("cognition keeps its chart color with a monogram instead of an icon", () => {
    const brand = providerBrand("Cognition");
    expect(brand.chipColor).toBe(providerColors.cognition);
    expect(brand.iconUrl).toBeNull();
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
