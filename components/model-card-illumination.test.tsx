import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MODEL_CARD_PRESENTATIONS } from "@/lib/model-card-collection";
import type { ModelCardPresentation } from "@/lib/model-card-presentation";

import {
  ModelCardIllumination,
  type ModelCardIlluminationFinish,
} from "./model-card-illumination";

type EmblemSignature = "class" | "edition" | "family" | "generation" | "profile" | "provider" | "role";

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

function attributedPath(markup: string, attribute: string, value: string): string {
  const elements = markup.match(/<path\b[^>]*>/gu) ?? [];
  const element = elements.find(candidate => candidate.includes(`${attribute}="${value}"`));
  const path = element?.match(/\bd="([^"]+)"/u)?.[1];
  if (path === undefined) throw new Error(`Expected ${attribute}=${value} path.`);
  return path;
}

function geometrySignature(markup: string): string {
  return (markup.match(/<(?:path|ellipse|circle)\b[^>]*>/gu) ?? []).map(element => (
    element.replace(/\s(?:data-[^=]+|class|style|aria-hidden|focusable)="[^"]*"/gu, "")
  )).join("|");
}

function holographicPhaseSignature(markup: string): string {
  const gradients = markup.match(
    /<(?:linearGradient|radialGradient)\b[\s\S]*?<\/(?:linearGradient|radialGradient)>/gu,
  ) ?? [];
  return gradients.map(gradient => (
    gradient.replace(/\s(?:id|stop-color)="[^"]+"/gu, "")
  )).join("|");
}

function render(
  card: ModelCardPresentation,
  mode: "full" | "gallery" = "full",
  finish: ModelCardIlluminationFinish = "print",
): string {
  return renderToStaticMarkup(
    <ModelCardIllumination card={card} finish={finish} mode={mode} />,
  );
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
    expect(new Set(renderedCards.map(geometrySignature)).size).toBe(renderedCards.length);
    expect(renderedCards.every(markup => markup.includes("data-emblem-fingerprint="))).toBe(true);
  });

  test("uses three ordered depth planes and conservative ImageResponse-safe SVG", () => {
    const fixture = MODEL_CARD_PRESENTATIONS[0];
    if (fixture === undefined) throw new Error("Expected a model-card fixture.");
    const markup = render(fixture);
    const depths = [...markup.matchAll(/data-ornament-depth="([^"]+)"/gu)].map(match => match[1]);
    expect(depths).toEqual(["background", "midground", "foreground"]);
    expect(markup).toContain('data-ornament-medium="deterministic-svg-engraving"');
    expect(markup).toContain('data-ornament-mark="engraving-hatch"');
    expect(markup).toContain('data-ornament-mark="calligraphic-ribbon"');
    expect(markup).toContain('data-ornament-mark="botanical-inlay"');
    expect(markup).toContain('data-ornament-mark="drypoint-ghost"');
    expect(markup).not.toMatch(/<(?:defs|filter|mask|pattern|text)\b/iu);
    expect(markup).not.toMatch(/\sid=/u);
  });

  test("adds deterministic spot foil without mutating the canonical print geometry", () => {
    const fixture = MODEL_CARD_PRESENTATIONS.find(card => card.illuminationDensity === 5);
    if (fixture === undefined) throw new Error("Expected a density 5 foil fixture.");
    const printed = render(fixture);
    const holographic = render(fixture, "full", "holographic");

    expect(holographic).toBe(render(fixture, "full", "holographic"));
    expect(holographic).toContain('data-holographic-finish="diffractive-spot-foil"');
    expect(holographic).toContain('data-holographic-coverage="5"');
    expect(holographic).toContain('data-holographic-channel-count="14"');
    expect(holographic).toContain("generation-inscription");
    expect(holographic).toContain("edition-cell");
    expect(holographic).toContain("microglint");
    expect(holographic).toMatch(/<(?:linearGradient|radialGradient)\b/u);
    expect(holographic).toContain("<use");
    expect(holographic).not.toMatch(/<(?:filter|mask|pattern|foreignObject|canvas)\b/iu);
    expect(geometryCount(holographic) - geometryCount(printed)).toBeLessThanOrEqual(3);
    for (const signature of ["provider", "family", "generation", "edition", "class"] as const) {
      expect(signaturePath(holographic, signature)).toBe(signaturePath(printed, signature));
    }
  });

  test("keeps live gradient identifiers unique and family foil fields recognizable", () => {
    const identifiers: string[] = [];
    const fieldByFamily = new Map<string, string>();
    for (const card of MODEL_CARD_PRESENTATIONS) {
      const markup = render(card, "gallery", "holographic");
      identifiers.push(...[...markup.matchAll(/\sid="([^"]+)"/gu)].map(match => match[1] ?? ""));
      const field = markup.match(/data-holographic-field="([^"]+)"/u)?.[1];
      if (field === undefined) throw new Error("Expected a holographic family field.");
      const previous = fieldByFamily.get(card.emblemIdentity.familyId);
      if (previous === undefined) fieldByFamily.set(card.emblemIdentity.familyId, field);
      else expect(field).toBe(previous);
    }
    expect(identifiers.every(identifier => identifier.length > 0)).toBe(true);
    expect(new Set(identifiers).size).toBe(identifiers.length);
    expect(fieldByFamily.size).toBe(new Set(
      MODEL_CARD_PRESENTATIONS.map(card => card.emblemIdentity.familyId),
    ).size);
    expect(new Set(fieldByFamily.values()).size).toBe(fieldByFamily.size);
  });

  test("names duplicate instances independently inside one document", () => {
    const fixture = MODEL_CARD_PRESENTATIONS.find(card => card.illuminationDensity === 5);
    if (fixture === undefined) throw new Error("Expected a holographic card fixture.");
    const markup = renderToStaticMarkup(
      <>
        <ModelCardIllumination card={fixture} finish="holographic" />
        <ModelCardIllumination card={fixture} finish="holographic" />
      </>,
    );
    const identifiers = [...markup.matchAll(/\sid="([^"]+)"/gu)]
      .map(match => match[1] ?? "");
    expect(identifiers).toHaveLength(12);
    expect(new Set(identifiers).size).toBe(identifiers.length);
    expect(markup).not.toContain('id=""');
  });

  test("adds stamped foil coverage instead of increasing motion by profile", () => {
    const channelCounts = [1, 2, 3, 4, 5].map(density => {
      const card = MODEL_CARD_PRESENTATIONS.find(candidate => (
        candidate.illuminationDensity === density
      ));
      if (card === undefined) throw new Error(`Expected a density ${density} foil fixture.`);
      const markup = render(card, "gallery", "holographic");
      const value = markup.match(/data-holographic-channel-count="(\d+)"/u)?.[1];
      if (value === undefined) throw new Error("Expected holographic channel coverage.");
      return Number.parseInt(value, 10);
    });
    expect(channelCounts).toEqual([4, 6, 8, 11, 14]);

    const cardsWithDifferentDensities = [...Map.groupBy(
      MODEL_CARD_PRESENTATIONS,
      card => card.canonicalModelId,
    ).values()].find(cards => new Set(cards.map(card => card.illuminationDensity)).size > 1);
    if (cardsWithDifferentDensities === undefined) {
      throw new Error("Expected one model with multiple foil coverage tiers.");
    }
    const [first, last] = cardsWithDifferentDensities.toSorted((left, right) => (
      left.illuminationDensity - right.illuminationDensity
    ));
    if (first === undefined || last === undefined) throw new Error("Expected foil profile fixtures.");
    expect(first.illuminationDensity).not.toBe(last.illuminationDensity);
    expect(first.seed).toBe(first.canonicalModelId);
    expect(last.seed).toBe(first.seed);
    expect(holographicPhaseSignature(render(first, "gallery", "holographic"))).toBe(
      holographicPhaseSignature(render(last, "gallery", "holographic")),
    );
  });

  test("grows a deterministic organic speck field without rearranging model identity", () => {
    const speckCounts = [1, 2, 3, 4, 5].map(density => {
      const card = MODEL_CARD_PRESENTATIONS.find(candidate => (
        candidate.illuminationDensity === density
      ));
      if (card === undefined) throw new Error(`Expected a density ${density} speck fixture.`);
      const markup = render(card, "gallery", "holographic");
      const count = markup.match(/data-speck-count="(\d+)"/u)?.[1];
      const foilCount = markup.match(/data-holographic-speck-count="(\d+)"/u)?.[1];
      if (count === undefined || foilCount === undefined) {
        throw new Error("Expected organic pigment and foil speck counts.");
      }
      expect(Number.parseInt(foilCount, 10)).toBeGreaterThan(0);
      expect(Number.parseInt(foilCount, 10)).toBeLessThan(Number.parseInt(count, 10));
      return Number.parseInt(count, 10);
    });
    expect(speckCounts).toEqual([10, 14, 19, 25, 32]);

    const cardsWithDifferentDensities = [...Map.groupBy(
      MODEL_CARD_PRESENTATIONS,
      card => card.canonicalModelId,
    ).values()].find(cards => new Set(cards.map(card => card.illuminationDensity)).size > 1);
    if (cardsWithDifferentDensities === undefined) {
      throw new Error("Expected one model with multiple speck densities.");
    }
    const sortedProfiles = cardsWithDifferentDensities.toSorted((left, right) => (
      left.illuminationDensity - right.illuminationDensity
    ));
    const lower = sortedProfiles[0];
    const higher = sortedProfiles.at(-1);
    if (lower === undefined || higher === undefined) throw new Error("Expected speck profiles.");
    const lowerPath = attributedPath(
      render(lower, "gallery"),
      "data-ornament-mark",
      "organic-speck-field",
    );
    const higherPath = attributedPath(
      render(higher, "gallery"),
      "data-ornament-mark",
      "organic-speck-field",
    );
    expect(higherPath.startsWith(lowerPath)).toBe(true);

    const firstProfileByModel = new Map<string, ModelCardPresentation>();
    for (const card of MODEL_CARD_PRESENTATIONS) {
      if (!firstProfileByModel.has(card.canonicalModelId)) {
        firstProfileByModel.set(card.canonicalModelId, card);
      }
    }
    const modelPaths = [...firstProfileByModel.values()].map(card => attributedPath(
      render(card, "gallery"),
      "data-ornament-mark",
      "organic-speck-field",
    ));
    expect(new Set(modelPaths).size).toBe(modelPaths.length);
  });

  test("gives every provider a stable, structurally distinct outer court", () => {
    const courtByProvider = new Map<string, { hand: string; name: string; path: string }>();
    for (const card of MODEL_CARD_PRESENTATIONS) {
      const markup = render(card);
      const name = markup.match(/data-illumination-motif="([^"]+)"/u)?.[1];
      if (name === undefined) throw new Error("Expected a named provider court.");
      const hand = markup.match(/data-ornament-line-hand="([^"]+)"/u)?.[1];
      if (hand === undefined) throw new Error("Expected a named provider line hand.");
      const value = { hand, name, path: signaturePath(markup, "provider") };
      const previous = courtByProvider.get(card.providerId);
      if (previous === undefined) courtByProvider.set(card.providerId, value);
      else expect(value).toEqual(previous);
    }
    expect(new Set([...courtByProvider.values()].map(value => value.name)).size)
      .toBe(courtByProvider.size);
    expect(new Set([...courtByProvider.values()].map(value => value.path)).size)
      .toBe(courtByProvider.size);
    expect(new Set([...courtByProvider.values()].map(value => value.hand)).size)
      .toBe(courtByProvider.size);
  });

  test("gives every current family one dominant, shared lineage seal", () => {
    const pathByFamily = new Map<string, string>();
    const matteByFamily = new Map<string, string>();
    for (const card of MODEL_CARD_PRESENTATIONS) {
      const markup = render(card);
      const path = signaturePath(markup, "family");
      const matte = attributedPath(markup, "data-emblem-signature", "family-matte");
      const previous = pathByFamily.get(card.emblemIdentity.familyId);
      if (previous === undefined) pathByFamily.set(card.emblemIdentity.familyId, path);
      else expect(path).toBe(previous);
      const previousMatte = matteByFamily.get(card.emblemIdentity.familyId);
      if (previousMatte === undefined) matteByFamily.set(card.emblemIdentity.familyId, matte);
      else expect(matte).toBe(previousMatte);
    }
    expect(pathByFamily.size).toBe(new Set(
      MODEL_CARD_PRESENTATIONS.map(card => card.emblemIdentity.familyId),
    ).size);
    expect(new Set(pathByFamily.values()).size).toBe(pathByFamily.size);
    expect(new Set(matteByFamily.values()).size).toBe(matteByFamily.size);
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
    expect(holographicPhaseSignature(
      render(cardFor("anthropic/claude-opus-4.8", "low"), "full", "holographic"),
    )).not.toBe(holographicPhaseSignature(
      render(cardFor("anthropic/claude-opus-5", "low"), "full", "holographic"),
    ));

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

  test("uses role as visible topology and exact profile tallies", () => {
    const roles = ["general", "speed", "reasoning", "flagship"] as const;
    const rolePaths = roles.map(role => {
      const card = MODEL_CARD_PRESENTATIONS.find(candidate => candidate.emblemIdentity.role === role);
      if (card === undefined) throw new Error(`Expected a ${role} fixture.`);
      return signaturePath(render(card), "role");
    });
    expect(new Set(rolePaths).size).toBe(roles.length);

    const none = render(cardFor("openai/gpt-5.6-luna", "none"));
    const low = render(cardFor("openai/gpt-5.6-luna", "low"));
    expect(signaturePath(none, "profile")).not.toBe(signaturePath(low, "profile"));
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
