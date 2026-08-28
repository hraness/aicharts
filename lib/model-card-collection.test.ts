import { describe, expect, test } from "bun:test";

import {
  MODEL_CARD_RELEASE_DATES,
  MODEL_CARD_VARIANTS,
  modelCardReleaseDates,
} from "./model-card-collection";
import {
  MODEL_RELEASE_LIMIT,
  MODEL_RELEASE_SOURCE_URL,
  MODEL_RELEASE_WINDOW_DAYS,
  modelReleaseProviderIds,
  type ModelRelease,
  type ModelReleaseListing,
  type ModelReleaseRadar,
} from "./model-release-data";

const retrievedAt = "2026-08-28T00:00:00.000Z";

function release(
  id: string,
  providerId: ModelRelease["providerId"],
  model: string,
  sourceAddedAt: string,
  status: ModelRelease["status"] = "benchmarked",
): ModelRelease {
  return {
    capabilities: {
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsTools: true,
    },
    canonicalSlug: id,
    id,
    model,
    modelUrl: `https://openrouter.ai/${id}`,
    providerId,
    providerName: providerId,
    sourceAddedAt,
    status,
  };
}

function listing(value: ModelRelease): ModelReleaseListing {
  return {
    id: value.id,
    model: value.model,
    providerId: value.providerId,
    sourceAddedAt: value.sourceAddedAt,
  };
}

function radar(
  releases: readonly ModelRelease[],
  observedListings: readonly ModelReleaseListing[] = releases.map(listing),
): ModelReleaseRadar {
  return {
    schemaVersion: 2,
    source: {
      method: "models-api",
      name: "OpenRouter",
      retrievedAt,
      timestampMeaning: "source-added-at",
      url: MODEL_RELEASE_SOURCE_URL,
    },
    policy: {
      limit: MODEL_RELEASE_LIMIT,
      providers: [...modelReleaseProviderIds],
      publication: "discovery-only",
      requires: ["text-output", "tools"],
      windowDays: MODEL_RELEASE_WINDOW_DAYS,
    },
    observedListings: [...observedListings],
    releases: [...releases],
  };
}

describe("model-card release dates", () => {
  test("matches provider-owned models across conservative label differences", () => {
    const cards = [
      { model: "Opus 5 (with fallback)", path: "/models/anthropic/opus-5/max", providerId: "anthropic" },
      { model: "Opus 5", path: "/models/openai/opus-5/max", providerId: "openai" },
      { model: "GLM-5.3-Flash", path: "/models/z-ai/glm-5.3-flash/default", providerId: "z_ai" },
    ] as const;
    const dates = modelCardReleaseDates(cards, radar([
      release("anthropic/claude-opus-5", "anthropic", "Claude Opus 5", "2026-07-24T17:02:24.000Z"),
      release("z-ai/glm-5.3-flash", "z_ai", "GLM 5.3 Flash", "2026-08-26T13:59:01.000Z"),
    ]));

    expect(dates.get(cards[0].path)).toBe("2026-07-24T17:02:24.000Z");
    expect(dates.get(cards[1].path)).toBeNull();
    expect(dates.get(cards[2].path)).toBe("2026-08-26T13:59:01.000Z");
  });

  test("keeps old source observations after their current radar rows disappear", () => {
    const cards = [
      { model: "GLM-5.3", path: "/models/z-ai/glm-5.3/default", providerId: "z_ai" },
      { model: "Opus 5", path: "/models/anthropic/opus-5/max", providerId: "anthropic" },
    ] as const;
    const oldListing = listing(release(
      "z-ai/glm-5.3",
      "z_ai",
      "GLM 5.3",
      "2026-01-26T13:59:01.000Z",
      "awaiting-benchmark",
    ));
    const unrelatedListing = listing(release(
      "google/unrelated",
      "google",
      "Unrelated Future Model",
      "2026-01-25T13:59:01.000Z",
      "awaiting-benchmark",
    ));
    const dates = modelCardReleaseDates(cards, radar([], [oldListing, unrelatedListing]));

    expect(dates.get(cards[0].path)).toBe("2026-01-26T13:59:01.000Z");
    expect(dates.get(cards[1].path)).toBeNull();
    expect(dates.size).toBe(cards.length);
  });

  test("uses the newest observed timestamp when semantic listings repeat", () => {
    const card = {
      model: "GPT-5.6 Luna",
      path: "/models/openai/gpt-5.6-luna/high",
      providerId: "openai",
    } as const;
    const dates = modelCardReleaseDates([card], radar([
      release("openai/gpt-5.6-luna-new", "openai", "GPT 5.6 Luna", "2026-08-09T09:54:24.000Z"),
      release("openai/gpt-5.6-luna", "openai", "GPT-5.6 Luna", "2026-07-09T09:54:24.000Z"),
    ]));

    expect(dates.get(card.path)).toBe("2026-08-09T09:54:24.000Z");
  });

  test("covers every current card path while leaving unmatched versions honest", () => {
    expect(MODEL_CARD_RELEASE_DATES.size).toBe(MODEL_CARD_VARIANTS.length);
    for (const card of MODEL_CARD_VARIANTS) {
      expect(MODEL_CARD_RELEASE_DATES.has(card.path)).toBeTrue();
    }

    const datedOpusProfiles = MODEL_CARD_VARIANTS.filter(card => (
      card.providerId === "anthropic" && card.model === "Opus 5"
    ));
    expect(datedOpusProfiles.length).toBeGreaterThan(1);
    expect(datedOpusProfiles.every(card => (
      MODEL_CARD_RELEASE_DATES.get(card.path) === "2026-07-24T17:02:24.000Z"
    ))).toBeTrue();

    const unmatchedDeepSeek = MODEL_CARD_VARIANTS.find(card => (
      card.providerId === "deepseek" && card.model === "DeepSeek V4 Pro"
    ));
    expect(unmatchedDeepSeek).toBeDefined();
    if (unmatchedDeepSeek !== undefined) {
      expect(MODEL_CARD_RELEASE_DATES.get(unmatchedDeepSeek.path)).toBeNull();
    }
  });
});
