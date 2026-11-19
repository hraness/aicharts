import { describe, expect, test } from "bun:test";
import {
  buildCatalog,
  catalog,
  EFFORT_STEPS,
  effortStepRows,
  findSuccessor,
  frontierSegments,
  orderPair,
  publishedEffortSteps,
} from "./catalog";
import { effortHubCopy, effortStepCopy, listNames, modelCopy, pairCopy } from "./copy";
import { formatDelta, formatPrice, formatRatio } from "./format";
import type { EffortPoint, EffortSlug, ModelRelease, ProviderId, ReleaseDataset } from "./types";

const LEVELS: Readonly<Record<EffortSlug, number>> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

function effort(
  slug: string,
  effortSlug: EffortSlug,
  score: number,
  cost: number,
  isDefaultEffort = false,
): EffortPoint {
  return {
    id: `${slug}-${effortSlug}`,
    slug: `${slug}-${effortSlug}`,
    effortSlug,
    effortLabel: effortSlug,
    shortTag: effortSlug,
    effortLevel: LEVELS[effortSlug],
    isDefaultEffort,
    scores: { coding: score, terminalBench4: score, frontierCode2: score, intelligence: score },
    costUsdPerTask: { total: cost, input: cost / 2, output: cost / 2, reasoning: 0, cacheRead: 0 },
    tokensPerTask: { total: cost * 10_000, reasoning: 0, answer: cost * 10_000 },
    speedTokPerSec: null,
    cliEval: null,
  };
}

function release(
  slug: string,
  name: string,
  provider: ProviderId,
  releaseDate: string,
  supersededOn: string | null,
  efforts: [EffortSlug, number, number][],
): ModelRelease {
  return {
    slug,
    name,
    provider,
    releaseDate,
    deprecated: supersededOn !== null,
    supersededOn,
    pricing: { inputPer1M: 2, outputPer1M: 10, cachedInputPer1M: 0.2, contextWindowTokens: 400_000 },
    summary: "",
    announcementUrl: "https://example.com",
    benchmarkUrl: "https://example.com",
    harborEval: null,
    efforts: efforts.map(([level, score, cost], i) => effort(slug, level, score, cost, i === 1)),
  };
}

// Two OpenAI lines (the old one replaced on the new one's launch day) and an
// Anthropic model that overlapped both.
const OLD_SOL = release("gpt-9-sol", "GPT-9 Sol", "openai", "2027-01-10", "2027-03-01", [
  ["low", 40, 0.35],
  ["medium", 48, 0.8],
  ["high", 52, 1.5],
]);
const NEW_SOL = release("gpt-9-1-sol", "GPT-9.1 Sol", "openai", "2027-03-01", null, [
  ["low", 50, 0.3],
  ["medium", 58, 0.7],
  ["high", 61, 1.4],
]);
const OPUS = release("claude-opus-9", "Claude Opus 9", "anthropic", "2027-02-01", null, [
  ["low", 45, 0.25],
  ["medium", 56, 0.9],
  ["high", 64, 2.5],
]);
const FIXTURE: ReleaseDataset = {
  schemaVersion: 1,
  updatedAt: "2027-03-05T00:00:00.000Z",
  snapshotDate: "2027-03-05",
  sources: [],
  releases: [NEW_SOL, OPUS, OLD_SOL],
};

describe("catalog fixture", () => {
  const cat = buildCatalog(FIXTURE);

  test("finds the release that replaced a superseded one", () => {
    expect(findSuccessor(OLD_SOL, FIXTURE.releases)?.slug).toBe("gpt-9-1-sol");
    expect(findSuccessor(NEW_SOL, FIXTURE.releases)).toBeNull();
    expect(cat.predecessorOf(NEW_SOL)?.slug).toBe("gpt-9-sol");
  });

  test("pairs releases that were current together, plus upgrades", () => {
    expect(cat.pairs.map((p) => [p.slug, p.relation, p.current])).toEqual([
      ["gpt-9-1-sol-vs-claude-opus-9", "cross-lab", true],
      ["gpt-9-1-sol-vs-gpt-9-sol", "upgrade", false],
      ["claude-opus-9-vs-gpt-9-sol", "cross-lab", false],
    ]);
    expect(cat.findPair("gpt-9-1-sol-vs-gpt-9-sol")?.reverseSlug).toBe("gpt-9-sol-vs-gpt-9-1-sol");
    expect(cat.pairsFor(NEW_SOL).map((p) => p.relation)).toEqual(["upgrade", "cross-lab"]);
  });

  test("splits a pair's shared cost frontier into runs by release", () => {
    const runs = frontierSegments(NEW_SOL, OPUS);
    // Opus Low is the cheapest point, Sol leads the middle, Opus High tops it.
    expect(runs.map((r) => [r.release.slug, r.efforts.map((e) => e.effortSlug)])).toEqual([
      ["claude-opus-9", ["low"]],
      ["gpt-9-1-sol", ["low", "medium", "high"]],
      ["claude-opus-9", ["high"]],
    ]);
    // GPT-9.1 Sol is cheaper and better at every setting than GPT-9 Sol.
    expect(frontierSegments(NEW_SOL, OLD_SOL).map((r) => r.release.slug)).toEqual(["gpt-9-1-sol"]);
  });

  test("publishes an effort step only with three measured releases", () => {
    expect(publishedEffortSteps(FIXTURE.releases).map((s) => s.slug).sort()).toEqual([
      "high-vs-medium",
      "medium-vs-low",
    ]);
    const rows = effortStepRows(EFFORT_STEPS.find((s) => s.slug === "high-vs-medium")!, FIXTURE.releases);
    expect(rows.map((r) => r.release.slug)).toEqual(["claude-opus-9", "gpt-9-sol", "gpt-9-1-sol"]);
    expect(rows[0]!.costRatio).toBeCloseTo(2.5 / 0.9);
  });
});

describe("catalog on the published data", () => {
  test("every superseded release with a successor points forward in time at the same lab", () => {
    for (const r of catalog.superseded) {
      const next = catalog.successorOf(r);
      if (!next) continue;
      expect(next.provider).toBe(r.provider);
      expect(next.releaseDate > r.releaseDate).toBe(true);
    }
    for (const r of catalog.current) expect(catalog.successorOf(r)).toBeNull();
  });

  test("pair slugs are unique, newer release first, and never collide with a reverse slug", () => {
    const slugs = new Set(catalog.pairs.map((p) => p.slug));
    expect(slugs.size).toBe(catalog.pairs.length);
    for (const p of catalog.pairs) {
      expect(orderPair(p.second, p.first)).toEqual([p.first, p.second]);
      expect(p.slug).toBe(`${p.first.slug}-vs-${p.second.slug}`);
      expect(slugs.has(p.reverseSlug)).toBe(false);
      expect(p.current).toBe(!p.first.deprecated && !p.second.deprecated);
    }
    // Every two current releases get a page.
    const n = catalog.current.length;
    expect(catalog.pairs.filter((p) => p.current)).toHaveLength((n * (n - 1)) / 2);
  });

  test("published effort steps have at least three releases and never pair None with Low", () => {
    const published = publishedEffortSteps(catalog.releases);
    expect(published.length).toBeGreaterThan(0);
    for (const step of published) {
      expect(effortStepRows(step, catalog.releases).length).toBeGreaterThanOrEqual(3);
    }
    expect(EFFORT_STEPS.some((s) => s.lower === "none")).toBe(false);
  });

  test("frontier stars only go to current releases", () => {
    for (const benchmark of ["coding", "terminalBench4", "frontierCode2", "intelligence"] as const) {
      const stars = catalog.liveFrontier(benchmark);
      expect(stars.size).toBeGreaterThan(0);
      for (const slug of stars.keys()) expect(catalog.find(slug)?.deprecated).toBe(false);
    }
  });

  test("generated copy never prints a missing value", () => {
    const texts: string[] = [];
    for (const r of catalog.releases) {
      const copy = modelCopy(r);
      texts.push(copy.description, copy.lead, copy.standing, ...copy.steps.map((s) => s.text));
      texts.push(...copy.questions.flatMap((q) => [q.q, q.a]));
    }
    for (const p of catalog.pairs) {
      const copy = pairCopy(p);
      texts.push(copy.description, copy.lead, copy.budget);
      texts.push(...copy.choose.flatMap((c) => c.reasons));
      texts.push(...copy.questions.flatMap((q) => [q.q, q.a]));
    }
    for (const step of publishedEffortSteps(catalog.releases)) {
      const copy = effortStepCopy(step);
      texts.push(copy.title, copy.description, copy.lead, ...copy.byLab.map((l) => l.text));
      texts.push(...copy.questions.flatMap((q) => [q.q, q.a]));
    }
    const hub = effortHubCopy();
    texts.push(hub.description, hub.lead, ...hub.questions.flatMap((q) => [q.q, q.a]));

    for (const text of texts) {
      expect(text).not.toMatch(/undefined|NaN|Infinity|null|\[object/);
      expect(text.trim().length).toBeGreaterThan(0);
    }
    for (const r of catalog.releases) {
      expect(modelCopy(r).description.length).toBeLessThanOrEqual(170);
    }
  });
});

describe("formatting", () => {
  test("formatPrice keeps whole dollars bare and cents to two or three places", () => {
    expect(formatPrice(3)).toBe("$3");
    expect(formatPrice(0.1)).toBe("$0.10");
    expect(formatPrice(1.25)).toBe("$1.25");
    expect(formatPrice(0.075)).toBe("$0.075");
  });

  test("formatDelta signs changes with a true minus", () => {
    expect(formatDelta(3.14)).toBe("+3.1");
    expect(formatDelta(-0.44)).toBe("−0.4");
    expect(formatDelta(0)).toBe("0.0");
  });

  test("formatRatio rounds by size", () => {
    expect(formatRatio(12.4)).toBe("12×");
    expect(formatRatio(2.44)).toBe("2.4×");
    expect(formatRatio(1.321)).toBe("1.32×");
  });

  test("listNames joins with commas and a final and", () => {
    expect(listNames(["A"])).toBe("A");
    expect(listNames(["A", "B"])).toBe("A and B");
    expect(listNames(["A", "B", "C"])).toBe("A, B and C");
  });
});
