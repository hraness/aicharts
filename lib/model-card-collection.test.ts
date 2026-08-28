import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import codingAgentData from "@/data/coding-agents.json";

import {
  MODEL_CARD_LISTINGS,
  MODEL_CARD_PRESENTATIONS,
  MODEL_CARD_RENDERER_VERSION,
  MODEL_CARD_SNAPSHOT_VERSION,
  MODEL_CARD_VARIANTS,
  modelCardListings,
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
import { MODEL_RELEASE_RADAR } from "./model-release-collection";

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

describe("model-card OpenRouter listings", () => {
  test("includes durable listing bytes in the v6 image cache key", () => {
    const expected = createHash("sha256")
      .update(JSON.stringify(codingAgentData))
      .update("\0")
      .update(JSON.stringify(MODEL_RELEASE_RADAR.observedListings))
      .update("\0")
      .update(MODEL_CARD_RENDERER_VERSION)
      .digest("hex")
      .slice(0, 16);
    const benchmarkOnly = createHash("sha256")
      .update(JSON.stringify(codingAgentData))
      .update("\0")
      .update(MODEL_CARD_RENDERER_VERSION)
      .digest("hex")
      .slice(0, 16);

    expect(MODEL_CARD_RENDERER_VERSION).toBe("model-card-v6");
    expect(MODEL_CARD_SNAPSHOT_VERSION).toBe(expected);
    expect(MODEL_CARD_SNAPSHOT_VERSION).not.toBe(benchmarkOnly);
  });

  test("matches provider-owned models across conservative label differences", () => {
    const cards = [
      { model: "Opus 5 (with fallback)", path: "/models/anthropic/opus-5/max", providerId: "anthropic" },
      { model: "Opus 5", path: "/models/openai/opus-5/max", providerId: "openai" },
      { model: "GLM-5.3-Flash", path: "/models/z-ai/glm-5.3-flash/default", providerId: "z_ai" },
    ] as const;
    const listings = modelCardListings(cards, radar([
      release("anthropic/claude-opus-5", "anthropic", "Claude Opus 5", "2026-07-24T17:02:24.000Z"),
      release("z-ai/glm-5.3-flash", "z_ai", "GLM 5.3 Flash", "2026-08-26T13:59:01.000Z"),
    ]));

    expect(listings.get(cards[0].path)).toEqual({
      id: "anthropic/claude-opus-5",
      source: "OpenRouter",
      sourceAddedAt: "2026-07-24T17:02:24.000Z",
    });
    expect(listings.get(cards[1].path)).toBeNull();
    expect(listings.get(cards[2].path)).toEqual({
      id: "z-ai/glm-5.3-flash",
      source: "OpenRouter",
      sourceAddedAt: "2026-08-26T13:59:01.000Z",
    });
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
    const listings = modelCardListings(cards, radar([], [oldListing, unrelatedListing]));

    expect(listings.get(cards[0].path)).toEqual({
      id: "z-ai/glm-5.3",
      source: "OpenRouter",
      sourceAddedAt: "2026-01-26T13:59:01.000Z",
    });
    expect(listings.get(cards[1].path)).toBeNull();
    expect(listings.size).toBe(cards.length);
  });

  test("uses the newest observed timestamp when semantic listings repeat", () => {
    const card = {
      model: "GPT-5.6 Luna",
      path: "/models/openai/gpt-5.6-luna/high",
      providerId: "openai",
    } as const;
    const listings = modelCardListings([card], radar([
      release("openai/gpt-5.6-luna-z", "openai", "GPT 5.6 Luna", "2026-08-09T09:54:24.000Z"),
      release("openai/gpt-5.6-luna", "openai", "GPT-5.6 Luna", "2026-07-09T09:54:24.000Z"),
      release("openai/gpt-5.6-luna-a", "openai", "GPT-5.6 Luna", "2026-08-09T09:54:24.000Z"),
    ]));

    expect(listings.get(card.path)).toEqual({
      id: "openai/gpt-5.6-luna-a",
      source: "OpenRouter",
      sourceAddedAt: "2026-08-09T09:54:24.000Z",
    });
  });

  test("covers every current card path while leaving unmatched versions honest", () => {
    expect(MODEL_CARD_LISTINGS.size).toBe(MODEL_CARD_VARIANTS.length);
    for (const card of MODEL_CARD_VARIANTS) {
      expect(MODEL_CARD_LISTINGS.has(card.path)).toBeTrue();
    }
    for (const card of MODEL_CARD_PRESENTATIONS) {
      expect(card.listing).toEqual(MODEL_CARD_LISTINGS.get(card.path) ?? null);
    }

    const datedOpusProfiles = MODEL_CARD_VARIANTS.filter(card => (
      card.providerId === "anthropic" && card.model === "Opus 5"
    ));
    expect(datedOpusProfiles.length).toBeGreaterThan(1);
    expect(datedOpusProfiles.every(card => (
      MODEL_CARD_LISTINGS.get(card.path)?.sourceAddedAt === "2026-07-24T17:02:24.000Z"
    ))).toBeTrue();

    const unmatchedDeepSeek = MODEL_CARD_VARIANTS.find(card => (
      card.providerId === "deepseek" && card.model === "DeepSeek V4 Pro"
    ));
    expect(unmatchedDeepSeek).toBeDefined();
    if (unmatchedDeepSeek !== undefined) {
      expect(MODEL_CARD_LISTINGS.get(unmatchedDeepSeek.path)).toBeNull();
    }
  });
});
