import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MODEL_CARD_PRESENTATIONS } from "@/lib/model-card-collection";
import type { ModelCardVisualClass } from "@/lib/model-card-presentation";

import { ModelCardIllumination } from "./model-card-illumination";

function geometryCount(markup: string): number {
  return (markup.match(/<(?:path|ellipse|circle)\b/gu) ?? []).length;
}

function signaturePath(markup: string, signature: "class" | "provider"): string {
  const match = markup.match(new RegExp(
    `<g[^>]*data-illumination-signature="${signature}"[^>]*>\\s*<path d="([^"]+)"`,
    "u",
  ));
  if (match?.[1] === undefined) throw new Error(`Expected a ${signature} signature path.`);
  return match[1];
}

describe("model card illumination", () => {
  test("is deterministic for a model profile and unique across the collection", () => {
    const first = MODEL_CARD_PRESENTATIONS[0];
    if (first === undefined) throw new Error("Expected a model-card fixture.");
    expect(renderToStaticMarkup(<ModelCardIllumination card={first} />)).toBe(
      renderToStaticMarkup(<ModelCardIllumination card={first} />),
    );
    expect(new Set(MODEL_CARD_PRESENTATIONS.map(card => card.seed)).size).toBe(
      MODEL_CARD_PRESENTATIONS.length,
    );
    const renderedCards = MODEL_CARD_PRESENTATIONS.map(card => (
      renderToStaticMarkup(<ModelCardIllumination card={card} />)
    ));
    expect(new Set(renderedCards).size).toBe(renderedCards.length);
  });

  test("assigns every provider a stable named motif", () => {
    const motifByProvider = new Map<string, string>();
    for (const card of MODEL_CARD_PRESENTATIONS) {
      const markup = renderToStaticMarkup(<ModelCardIllumination card={card} />);
      const motif = markup.match(/data-illumination-motif="([^"]+)"/u)?.[1];
      expect(motif).toBeDefined();
      const previous = motifByProvider.get(card.providerId);
      if (previous === undefined && motif !== undefined) motifByProvider.set(card.providerId, motif);
      else expect(motif).toBe(previous);
    }
    expect(new Set(motifByProvider.values()).size).toBe(motifByProvider.size);

    const fixture = MODEL_CARD_PRESENTATIONS[0];
    if (fixture === undefined) throw new Error("Expected a model-card fixture.");
    const providerSignatures = [...motifByProvider.keys()].map(providerId => (
      signaturePath(renderToStaticMarkup(
        <ModelCardIllumination card={{ ...fixture, providerId }} />,
      ), "provider")
    ));
    expect(new Set(providerSignatures).size).toBe(providerSignatures.length);
  });

  test("gives each visual class its own organic topology", () => {
    const fixture = MODEL_CARD_PRESENTATIONS[0];
    if (fixture === undefined) throw new Error("Expected a model-card fixture.");
    const visualClasses = ["standard", "fast", "thinking", "max"] as const;
    const renderedClasses = visualClasses.map((visualClass: ModelCardVisualClass) => (
      renderToStaticMarkup(<ModelCardIllumination card={{ ...fixture, visualClass }} />)
    ));
    for (const [index, visualClass] of visualClasses.entries()) {
      expect(renderedClasses[index]).toContain(`data-illumination-class="${visualClass}"`);
    }
    const classSignatures = renderedClasses.map(markup => signaturePath(markup, "class"));
    expect(new Set(classSignatures).size).toBe(visualClasses.length);
    expect(new Set(renderedClasses).size).toBe(visualClasses.length);
  });

  test("uses a lighter gallery pass without losing either signature", () => {
    const fixture = MODEL_CARD_PRESENTATIONS.find(card => card.illuminationDensity === 5);
    if (fixture === undefined) throw new Error("Expected a density 5 fixture.");
    const full = renderToStaticMarkup(<ModelCardIllumination card={fixture} />);
    const gallery = renderToStaticMarkup(
      <ModelCardIllumination card={fixture} mode="gallery" />,
    );
    expect(gallery).toContain('data-illumination-mode="gallery"');
    expect(signaturePath(gallery, "provider")).toBeDefined();
    expect(signaturePath(gallery, "class")).toBeDefined();
    expect(geometryCount(gallery)).toBeLessThan(geometryCount(full) * .6);
  });

  test("adds visibly more geometry at each density", () => {
    const geometryCounts = [1, 2, 3, 4, 5].map((density) => {
      const card = MODEL_CARD_PRESENTATIONS.find(candidate => (
        candidate.illuminationDensity === density
      ));
      if (card === undefined) throw new Error(`Expected a density ${density} fixture.`);
      const markup = renderToStaticMarkup(<ModelCardIllumination card={card} />);
      return geometryCount(markup);
    });
    expect(geometryCounts).toEqual([...geometryCounts].sort((left, right) => left - right));
    expect(new Set(geometryCounts).size).toBe(geometryCounts.length);
  });
});
