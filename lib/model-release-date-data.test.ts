import { describe, expect, test } from "bun:test";

import modelReleaseDateData from "@/data/model-release-dates.json";

import { MODEL_CARD_CATALOG } from "./model-card-data";
import {
  MODEL_RELEASE_DATES,
  modelReleaseDateForCanonicalId,
  parseModelReleaseDates,
} from "./model-release-date-data";

function checkedFixture() {
  const first = modelReleaseDateData[0];
  if (first === undefined) throw new Error("Expected checked release-date fixtures.");
  return first;
}

describe("official model release dates", () => {
  test("strictly parses one checked record for every curated model identity", () => {
    const parsed = parseModelReleaseDates(modelReleaseDateData);
    expect(parsed.ok).toBe(true);
    expect(MODEL_RELEASE_DATES.length).toBe(MODEL_CARD_CATALOG.length);
    expect(new Set(MODEL_RELEASE_DATES.map(entry => entry.canonicalModelId))).toEqual(
      new Set(MODEL_CARD_CATALOG.map(entry => entry.canonicalModelId)),
    );
    expect(MODEL_RELEASE_DATES.every(entry => entry.status === "verified")).toBe(true);
  });

  test("resolves a model-level fact shared by all of its card profiles", () => {
    expect(modelReleaseDateForCanonicalId("openai/gpt-5.6-sol")).toMatchObject({
      releasedOn: "2026-07-09",
      stage: "general-availability",
      status: "verified",
    });
    expect(modelReleaseDateForCanonicalId("unlisted/example")).toBeUndefined();
    expect(modelReleaseDateForCanonicalId("cognition/swe-1.7")).toMatchObject({
      appliesTo: { kind: "base-model", model: "SWE-1.7" },
      releasedOn: "2026-07-08",
      status: "verified",
    });
  });

  test("pins the four reviewed September releases to provider-owned evidence", () => {
    expect(modelReleaseDateForCanonicalId("anthropic/claude-fable-5.1")).toMatchObject({
      basis: "announcement",
      releasedOn: "2026-09-01",
      stage: "general-availability",
      sources: [{ url: "https://www.anthropic.com/claude-fable-and-mythos-5-1" }],
      status: "verified",
    });
    expect(modelReleaseDateForCanonicalId("google/gemini-3.8-flash")).toMatchObject({
      basis: "model-index",
      releasedOn: "2026-09-02",
      stage: "public-release",
      sources: [{ url: "https://ai.google.dev/gemini-api/docs/deprecations" }],
      status: "verified",
    });
    expect(modelReleaseDateForCanonicalId("meta/muse-spark-1.3")).toMatchObject({
      releasedOn: "2026-09-02",
      stage: "public-release",
      sources: [{ url: "https://research.meta.ai/blog/introducing-muse-spark-1-3" }],
      status: "verified",
    });
    expect(modelReleaseDateForCanonicalId("openai/gpt-6-astra")).toMatchObject({
      releasedOn: "2026-09-03",
      stage: "public-release",
      sources: [{ url: "https://openai.com/index/gpt-6-astra/" }],
      status: "verified",
    });
  });

  test("rejects timestamps, impossible dates, and post-verification dates", () => {
    const fixture = checkedFixture();
    expect(parseModelReleaseDates([{
      ...fixture,
      releasedOn: "2026-06-01T00:00:00.000Z",
    }]).ok).toBe(false);
    expect(parseModelReleaseDates([{
      ...fixture,
      releasedOn: "2026-02-30",
    }]).ok).toBe(false);
    expect(parseModelReleaseDates([{
      ...fixture,
      releasedOn: "2026-09-01",
    }]).ok).toBe(false);
  });

  test("rejects marketplace evidence, duplicate identities, and undocumented fields", () => {
    const fixture = checkedFixture();
    expect(parseModelReleaseDates([{
      ...fixture,
      sources: [{
        title: "OpenRouter listing",
        url: "https://openrouter.ai/qwen/qwen3.7-plus",
      }],
    }]).ok).toBe(false);
    expect(parseModelReleaseDates([fixture, fixture]).ok).toBe(false);
    expect(parseModelReleaseDates([{
      ...fixture,
      marketplaceListedAt: "2026-06-03T13:03:03.000Z",
    }]).ok).toBe(false);
  });

  test("fails malformed URLs and provider-mismatched evidence without throwing", () => {
    const fixture = checkedFixture();
    const malformed = () => parseModelReleaseDates([{
      ...fixture,
      sources: [{ title: "Malformed source", url: "not-a-url" }],
    }]);
    expect(malformed).not.toThrow();
    expect(malformed().ok).toBe(false);
    expect(parseModelReleaseDates([{
      ...fixture,
      canonicalModelId: "anthropic/claude-fable-5",
    }]).ok).toBe(false);
  });

  test("allows an honest pending record but forbids it from claiming a date", () => {
    const pending = {
      canonicalModelId: "alibaba/qwen3.7-plus",
      reason: "No exact first-party publication day found after checking provider sources.",
      researchedOn: "2026-08-29",
      status: "pending",
    } as const;
    expect(parseModelReleaseDates([pending]).ok).toBe(true);
    expect(parseModelReleaseDates([{
      ...pending,
      releasedOn: "2026-06-01",
    }]).ok).toBe(false);
    expect(parseModelReleaseDates([{
      ...pending,
      canonicalModelId: "openai/not-cataloged",
    }]).ok).toBe(false);
  });
});
