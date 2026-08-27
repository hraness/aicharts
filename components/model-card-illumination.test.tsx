import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MODEL_CARD_PRESENTATIONS } from "@/lib/model-card-collection";
import type { ModelCardPresentation } from "@/lib/model-card-presentation";

import { ModelCardIllumination } from "./model-card-illumination";

type EmblemSignature = "class" | "edition" | "family" | "generation" | "provider";

function geometryCount(markup: string): number {
  return (markup.match(/<(?:path|ellipse|circle)\b/gu) ?? []).length;
}

function signaturePath(markup: string, signature: EmblemSignature): string {
  const match = markup.match(new RegExp(
    `<g[^>]*data-emblem-signature="${signature}"[^>]*>\\s*<path d="([^"]+)"`,
    "u",
  ));
  if (match?.[1] === undefined) throw new Error(`Expected a ${signature} signature path.`);
  return match[1];
}

function render(card: ModelCardPresentation, mode: "full" | "gallery" = "full"): string {
  return renderToStaticMarkup(<ModelCardIllumination card={card} mode={mode} />);
}

function coreSignature(markup: string): string {
  return (["provider", "family", "generation", "edition"] as const)
    .map(signature => signaturePath(markup, signature))
    .join("|");
}

function cardFor(canonicalModelId: string, profileSlug?: string): ModelCardPresentation {
  const card = MODEL_CARD_PRESENTATIONS.find(candidate => (
    candidate.canonicalModelId === canonicalModelId
    && (profileSlug === undefined || candidate.profileSlug === profileSlug)
  ));
  if (card === undefined) {
    throw new Error(`Expected ${canonicalModelId}${profileSlug === undefined ? "" : `/${profileSlug}`}.`);
  }
  return card;
}

describe("model card illumination", () => {
  test("is deterministic for each profile and unique across the collection", () => {
    const first = MODEL_CARD_PRESENTATIONS[0];
    if (first === undefined) throw new Error("Expected a model-card fixture.");
    expect(render(first)).toBe(render(first));
    const renderedCards = MODEL_CARD_PRESENTATIONS.map(card => render(card));
    expect(new Set(renderedCards).size).toBe(renderedCards.length);
    expect(renderedCards.every(markup => markup.includes("data-emblem-fingerprint="))).toBe(true);
  });

  test("gives every provider a stable, structurally distinct outer court", () => {
    const courtByProvider = new Map<string, { name: string; path: string }>();
    for (const card of MODEL_CARD_PRESENTATIONS) {
      const markup = render(card);
      const name = markup.match(/data-illumination-motif="([^"]+)"/u)?.[1];
      if (name === undefined) throw new Error("Expected a named provider court.");
      const value = { name, path: signaturePath(markup, "provider") };
      const previous = courtByProvider.get(card.providerId);
      if (previous === undefined) courtByProvider.set(card.providerId, value);
      else expect(value).toEqual(previous);
    }
    expect(new Set([...courtByProvider.values()].map(value => value.name)).size)
      .toBe(courtByProvider.size);
    expect(new Set([...courtByProvider.values()].map(value => value.path)).size)
      .toBe(courtByProvider.size);
  });

  test("gives every current family one dominant, shared lineage seal", () => {
    const pathByFamily = new Map<string, string>();
    for (const card of MODEL_CARD_PRESENTATIONS) {
      const path = signaturePath(render(card), "family");
      const previous = pathByFamily.get(card.emblemIdentity.familyId);
      if (previous === undefined) pathByFamily.set(card.emblemIdentity.familyId, path);
      else expect(path).toBe(previous);
    }
    expect(pathByFamily.size).toBe(12);
    expect(new Set(pathByFamily.values()).size).toBe(pathByFamily.size);
  });

  test("keeps a model core byte-identical across profiles", () => {
    const byModel = Map.groupBy(
      MODEL_CARD_PRESENTATIONS,
      card => card.canonicalModelId,
    );
    for (const cards of byModel.values()) {
      if (cards.length < 2) continue;
      const signatures = cards.map(card => coreSignature(render(card)));
      expect(new Set(signatures).size).toBe(1);
    }
  });

  test("makes every catalog model structurally unique before color and logo", () => {
    const firstProfileByModel = new Map<string, ModelCardPresentation>();
    for (const card of MODEL_CARD_PRESENTATIONS) {
      if (!firstProfileByModel.has(card.canonicalModelId)) {
        firstProfileByModel.set(card.canonicalModelId, card);
      }
    }
    const signatures = [...firstProfileByModel.values()].map(card => coreSignature(render(card)));
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  test("preserves family resemblance while generation and edition marks mutate", () => {
    const opus48 = render(cardFor("anthropic/claude-opus-4.8", "low"));
    const opus5 = render(cardFor("anthropic/claude-opus-5", "low"));
    expect(signaturePath(opus48, "family")).toBe(signaturePath(opus5, "family"));
    expect(signaturePath(opus48, "generation")).not.toBe(signaturePath(opus5, "generation"));

    const gptEditions = ["luna", "sol", "terra"].map(edition => (
      render(cardFor(`openai/gpt-5.6-${edition}`, "low"))
    ));
    expect(new Set(gptEditions.map(markup => signaturePath(markup, "family"))).size).toBe(1);
    expect(new Set(gptEditions.map(markup => signaturePath(markup, "generation"))).size).toBe(1);
    expect(new Set(gptEditions.map(markup => signaturePath(markup, "edition"))).size).toBe(3);

    const qwenMax = render(cardFor("alibaba/qwen3.8-max"));
    const fableMax = render(cardFor("anthropic/claude-fable-5"));
    expect(signaturePath(qwenMax, "provider")).not.toBe(signaturePath(fableMax, "provider"));
    expect(signaturePath(qwenMax, "family")).not.toBe(signaturePath(fableMax, "family"));
  });

  test("uses four teachable secondary-ink coronas", () => {
    const families = ["base", "fast", "thinking", "elevated"] as const;
    const markups = families.map(accentFamily => {
      const card = MODEL_CARD_PRESENTATIONS.find(candidate => candidate.accentFamily === accentFamily);
      if (card === undefined) throw new Error(`Expected a ${accentFamily} fixture.`);
      return render(card);
    });
    expect(new Set(markups.map(markup => signaturePath(markup, "class"))).size).toBe(4);
    for (const [index, accentFamily] of families.entries()) {
      expect(markups[index]).toContain(`data-illumination-accent="${accentFamily}"`);
    }
  });

  test("uses a lighter gallery pass without losing semantic signatures", () => {
    const fixture = MODEL_CARD_PRESENTATIONS.find(card => card.illuminationDensity === 5);
    if (fixture === undefined) throw new Error("Expected a density 5 fixture.");
    const full = render(fixture);
    const gallery = render(fixture, "gallery");
    for (const signature of ["provider", "family", "generation", "edition", "class"] as const) {
      expect(signaturePath(gallery, signature)).toBe(signaturePath(full, signature));
    }
    expect(gallery).not.toContain('data-emblem-signature="scribe"');
    expect(geometryCount(gallery)).toBeLessThan(geometryCount(full));
    expect(geometryCount(gallery)).toBeLessThanOrEqual(24);
  });

  test("adds visibly more geometry at every profile density", () => {
    for (const mode of ["full", "gallery"] as const) {
      const geometryCounts = [1, 2, 3, 4, 5].map((density) => {
        const card = MODEL_CARD_PRESENTATIONS.find(candidate => (
          candidate.illuminationDensity === density
        ));
        if (card === undefined) throw new Error(`Expected a density ${density} fixture.`);
        return geometryCount(render(card, mode));
      });
      expect(geometryCounts).toEqual([...geometryCounts].sort((left, right) => left - right));
      expect(new Set(geometryCounts).size).toBe(geometryCounts.length);
    }
  });
});
