import { describe, expect, test } from "bun:test";

import {
  calculateApiEquivalentUsd,
  calculateObservedProPlanUpperBoundMultiple,
  formatObservedAccountCount,
  formatObservedProPlanUpperBoundMultiple,
  formatSampledCoverageLowerBound,
  formatSubsidyRateUsd,
  formatSubsidyTokens,
  formatSubsidyUsd,
  GPT_SUBSIDY_DESCRIPTION,
  GPT_SUBSIDY_SUB_ONE_PERCENT_COVERAGE_SENTINEL,
  GPT_SUBSIDY_TITLE,
  latestGptSubsidyObservation,
  parseGptSubsidySnapshot,
} from "./gpt-subsidy-data";
import { assertProperty, fc } from "./property-test";

const pricing = {
  basis: "per-model-api-retail",
  manifest: {
    name: "AI Charts OpenAI rate manifest",
    schemaVersion: 1,
    sha256: "a".repeat(64),
    frozenAt: "2026-08-25T00:00:00Z",
    sourceUrl: "https://github.com/hraness/aicharts/blob/main/data/gpt-subsidy-pricing.json",
  },
  proxyModelIds: ["codex-auto-review"],
  referenceModel: {
    name: "GPT-5.6 Sol",
    uncachedInputPerMillionUsd: 4,
    cachedInputPerMillionUsd: 0.4,
    outputPerMillionUsd: 20,
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.6-sol",
  },
} as const;

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function observation({
  cachedInput,
  date,
  output,
  uncachedInput,
}: Readonly<{
  cachedInput: number;
  date: string;
  output: number;
  uncachedInput: number;
}>) {
  const tokens = {
    uncachedInput,
    cachedInput,
    output,
    total: uncachedInput + cachedInput + output,
  };
  const trailingSevenDayApiEquivalentUsd = calculateApiEquivalentUsd(
    tokens,
    pricing.referenceModel,
  );
  return {
    id: `trailing-7d-${date}`,
    observedAt: `${date}T23:59:59.999Z`,
    periodStartedAt: `${addDays(date, -6)}T00:00:00.000Z`,
    periodEndsAt: `${date}T23:59:59.999Z`,
    status: "settled",
    tokens,
    trailingSevenDayApiEquivalentUsd,
    accountAttribution: {
      status: "unavailable",
      distinctObservedAccounts: null,
      coverage: 0,
    },
    subscriptionAdjustedMultiple: null,
  } as const;
}

const summaryTokens = {
  uncachedInput: 11_250_000,
  cachedInput: 340_000_000,
  output: 11_500_000,
  total: 362_750_000,
} as const;
const summaryUsd = calculateApiEquivalentUsd(
  summaryTokens,
  pricing.referenceModel,
);

export const validGptSubsidySnapshot = {
  schemaVersion: 2,
  title: GPT_SUBSIDY_TITLE,
  generatedAt: "2026-08-25T16:00:00.000Z",
  currency: "USD",
  plan: {
    name: "ChatGPT Pro",
    monthlyPriceUsd: 200,
    advertisedUsageMultiplier: 20,
    observedAt: "2026-08-25T00:00:00Z",
    sourceUrl: "https://help.openai.com/en/articles/9793128",
  },
  pricing,
  observations: Array.from({ length: 31 }, (_, index) => observation({
    cachedInput: 40_000_000 + index * 1_000_000,
    date: addDays("2026-07-25", index),
    output: 1_500_000 + index * 100_000,
    uncachedInput: 1_250_000 + index * 100_000,
  })),
  periodSummary: {
    startedAt: "2026-07-25T00:00:00.000Z",
    endedAt: "2026-08-24T23:59:59.999Z",
    days: 31,
    tokens: summaryTokens,
    apiEquivalentUsd: summaryUsd,
  },
  accountPlanComparison: {
    periodStartedAt: "2026-07-25T00:00:00.000Z",
    periodEndedAt: "2026-08-24T23:59:59.999Z",
    accountAttribution: {
      status: "unavailable",
      distinctObservedAccounts: null,
      coverage: 0,
    },
    observedProPlanComparison: {
      status: "unavailable",
      distinctVerifiedProAccountsLowerBound: null,
      normalizedPlanValueUsd: null,
      apiEquivalentMultipleUpperBound: null,
    },
    firstSampledAt: null,
    measurement: {
      name: "AI Charts GPT subsidy account-attribution manifest",
      schemaVersion: 1,
      kind: "aicharts-gpt-subsidy-account-attribution",
      revision: "2026-09-04.2",
      sha256: "c".repeat(64),
      frozenAt: "2026-09-04T00:00:00Z",
      sourceUrl:
        "https://github.com/hraness/aicharts/blob/main/data/gpt-subsidy-attribution-measurement.json",
    },
  },
  methodology: {
    deduplication: "tokscale-global-event-identity",
    measurement: {
      name: "AI Charts GPT subsidy measurement manifest",
      schemaVersion: 1,
      kind: "aicharts-gpt-subsidy-measurement",
      revision: "2026-08-25.1",
      sha256: "b".repeat(64),
      frozenAt: "2026-08-25T00:00:00Z",
      sourceUrl:
        "https://github.com/hraness/aicharts/blob/main/data/gpt-subsidy-measurement.json",
    },
    formula: "monthly API-equivalent value divided by $200",
    disclaimer:
      "This is one user's local API-retail-equivalent value, not an audited or representative subsidy.",
    sourceUrls: ["https://github.com/junhoyeo/tokscale"],
  },
} as const;

describe("GPT subsidy snapshot", () => {
  test("states the local-log and sampled-account scope in search and social copy", () => {
    expect(GPT_SUBSIDY_DESCRIPTION).toContain(
      "one user's available local Codex logs",
    );
    expect(GPT_SUBSIDY_DESCRIPTION).toContain("sampled lower-bound count");
    expect(GPT_SUBSIDY_DESCRIPTION).toContain("provider-reported Pro status");
  });

  test("parses adjacent settled history and returns its latest point", () => {
    const parsed = parseGptSubsidySnapshot(validGptSubsidySnapshot);
    expect(parsed.ok).toBeTrue();
    if (!parsed.ok) return;
    expect(latestGptSubsidyObservation(parsed.value).id)
      .toBe("trailing-7d-2026-08-24");
  });

  test("prices uncached input, cached input, and output without overlap", () => {
    expect(calculateApiEquivalentUsd({
      uncachedInput: 1_000_000,
      cachedInput: 10_000_000,
      output: 100_000,
    }, pricing.referenceModel)).toBe(10);
  });

  test("computes and formats a verified-account comparison as an explicit upper bound", () => {
    const comparison = calculateObservedProPlanUpperBoundMultiple(
      62_352.961639570145,
      200,
      4,
    );

    expect(comparison).toBeCloseTo(77.9412020495);
    expect(formatObservedProPlanUpperBoundMultiple(comparison)).toBe("≤78×");
    expect(() => calculateObservedProPlanUpperBoundMultiple(-1, 200, 4))
      .toThrow(RangeError);
    expect(() => calculateObservedProPlanUpperBoundMultiple(1, 0, 4))
      .toThrow(RangeError);
    expect(() => calculateObservedProPlanUpperBoundMultiple(1, 200, 0))
      .toThrow(RangeError);
  });

  test("property: observed-plan comparisons are finite, nonnegative, and scale linearly", () => {
    assertProperty(fc.property(
      fc.double({ min: 0, max: 1_000_000_000, noNaN: true }),
      fc.double({ min: 0.01, max: 1_000_000, noNaN: true }),
      fc.integer({ min: 1, max: 100 }),
      fc.double({ min: 0.01, max: 100, noNaN: true }),
      (apiEquivalentUsd, planPriceUsd, accountCount, scale) => {
        const comparison = calculateObservedProPlanUpperBoundMultiple(
          apiEquivalentUsd,
          planPriceUsd,
          accountCount,
        );
        const scaled = calculateObservedProPlanUpperBoundMultiple(
          apiEquivalentUsd * scale,
          planPriceUsd,
          accountCount,
        );
        const displayedUpperBound = Number(
          formatObservedProPlanUpperBoundMultiple(comparison)
            .slice(1, -1).replaceAll(",", ""),
        );

        expect(Number.isFinite(comparison)).toBeTrue();
        expect(comparison).toBeGreaterThanOrEqual(0);
        const expectedScaled = comparison * scale;
        expect(Math.abs(scaled - expectedScaled)).toBeLessThanOrEqual(
          Math.max(1e-9, Math.abs(expectedScaled) * 1e-12),
        );
        expect(displayedUpperBound).toBeGreaterThanOrEqual(comparison);
      },
    ));
  });

  test("models account coverage without inventing subscription evidence", () => {
    for (const accountAttribution of [
      {
        status: "partial",
        distinctObservedAccounts: 2,
        coverage: 0.5,
      },
      {
        status: "partial",
        distinctObservedAccounts: 3,
        coverage: 0.99,
      },
      {
        status: "partial",
        distinctObservedAccounts: 1,
        coverage: GPT_SUBSIDY_SUB_ONE_PERCENT_COVERAGE_SENTINEL,
      },
    ] as const) {
      const parsed = parseGptSubsidySnapshot({
        ...validGptSubsidySnapshot,
        accountPlanComparison: {
          ...validGptSubsidySnapshot.accountPlanComparison,
          firstSampledAt: "2026-08-25T16:00:00.000Z",
        },
        observations: validGptSubsidySnapshot.observations.map((point, index) =>
          index === 0 ? { ...point, accountAttribution } : point),
      });
      expect(parsed.ok).toBeTrue();
    }

    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      accountPlanComparison: {
        ...validGptSubsidySnapshot.accountPlanComparison,
        firstSampledAt: "2026-08-25T16:00:00.000Z",
      },
    }).ok).toBeFalse();

    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      observations: validGptSubsidySnapshot.observations.map((point, index) =>
        index === 0
          ? {
            ...point,
            accountAttribution: {
              status: "partial",
              distinctObservedAccounts: 1,
              coverage: 0.25,
            },
          }
          : point),
    }).ok).toBeFalse();

    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      accountPlanComparison: {
        ...validGptSubsidySnapshot.accountPlanComparison,
        firstSampledAt: "2026-08-25T16:00:00.000Z",
      },
      observations: validGptSubsidySnapshot.observations.map((point, index) =>
        index === 0
          ? {
            ...point,
            accountAttribution: {
              status: "complete",
              distinctObservedAccounts: 1,
              coverage: 1,
            },
          }
          : point),
    }).ok).toBeFalse();

    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      observations: validGptSubsidySnapshot.observations.map((point, index) =>
        index === 0
          ? {
              ...point,
              accountAttribution: {
                status: "unavailable",
                distinctObservedAccounts: 1,
                coverage: 0,
              },
            }
          : point),
    }).ok).toBeFalse();

    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      observations: validGptSubsidySnapshot.observations.map((point, index) =>
        index === 0 ? { ...point, subscriptionAdjustedMultiple: 307.1 } : point),
    }).ok).toBeFalse();
  });

  test("formats only privacy-quantized sampled coverage", () => {
    expect(formatSampledCoverageLowerBound(
      GPT_SUBSIDY_SUB_ONE_PERCENT_COVERAGE_SENTINEL,
    )).toBe("<1%");
    expect(formatSampledCoverageLowerBound(0.42)).toBe("at least 42%");
    expect(() => formatSampledCoverageLowerBound(0.421)).toThrow(
      "whole-percentage lower bound",
    );
    expect(() => formatSampledCoverageLowerBound(1)).toThrow(
      "whole-percentage lower bound",
    );
  });

  test("binds the summary upper bound to sampled coverage and verified Pro accounts", () => {
    const verifiedCount = 3;
    const normalizedPlanValueUsd = verifiedCount
      * validGptSubsidySnapshot.plan.monthlyPriceUsd;
    const sampled = {
      ...validGptSubsidySnapshot,
      accountPlanComparison: {
        ...validGptSubsidySnapshot.accountPlanComparison,
        accountAttribution: {
          status: "partial",
          distinctObservedAccounts: 4,
          coverage: 0.62,
        },
        observedProPlanComparison: {
          status: "sampled",
          distinctVerifiedProAccountsLowerBound: verifiedCount,
          normalizedPlanValueUsd,
          apiEquivalentMultipleUpperBound:
            validGptSubsidySnapshot.periodSummary.apiEquivalentUsd
            / normalizedPlanValueUsd,
        },
        firstSampledAt: "2026-08-25T16:00:00.000Z",
      },
    } as const;
    expect(parseGptSubsidySnapshot(sampled).ok).toBeTrue();
    expect(parseGptSubsidySnapshot({
      ...sampled,
      accountPlanComparison: {
        ...sampled.accountPlanComparison,
        observedProPlanComparison: {
          ...sampled.accountPlanComparison.observedProPlanComparison,
          distinctVerifiedProAccountsLowerBound: 5,
        },
      },
    }).ok).toBeFalse();
    expect(parseGptSubsidySnapshot({
      ...sampled,
      accountPlanComparison: {
        ...sampled.accountPlanComparison,
        observedProPlanComparison: {
          ...sampled.accountPlanComparison.observedProPlanComparison,
          apiEquivalentMultipleUpperBound: 1,
        },
      },
    }).ok).toBeFalse();
    expect(parseGptSubsidySnapshot({
      ...sampled,
      accountPlanComparison: {
        ...sampled.accountPlanComparison,
        periodStartedAt: "2026-07-26T00:00:00.000Z",
      },
    }).ok).toBeFalse();
    expect(parseGptSubsidySnapshot({
      ...sampled,
      accountPlanComparison: {
        ...sampled.accountPlanComparison,
        firstSampledAt: "2026-09-06T00:00:00.000Z",
      },
    }).ok).toBeFalse();
  });

  test("preserves per-model manifest values instead of repricing aggregate tokens", () => {
    const [first, second] = validGptSubsidySnapshot.observations;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    const trailingSevenDayApiEquivalentUsd = first.trailingSevenDayApiEquivalentUsd + 25;
    const summaryApiEquivalentUsd = validGptSubsidySnapshot.periodSummary.apiEquivalentUsd + 50;
    const parsed = parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      observations: validGptSubsidySnapshot.observations.map((point, index) => (
        index === 0
          ? {
              ...first,
              trailingSevenDayApiEquivalentUsd,
            }
          : point
      )),
      periodSummary: {
        ...validGptSubsidySnapshot.periodSummary,
        apiEquivalentUsd: summaryApiEquivalentUsd,
      },
    });
    expect(parsed.ok).toBeTrue();
  });

  test("rejects unknown fields and incoherent derived values", () => {
    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      undocumented: true,
    }).ok).toBeFalse();

    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      observations: validGptSubsidySnapshot.observations.map((point, index) =>
        index === 0
          ? { ...point, tokens: { ...point.tokens, total: point.tokens.total + 1 } }
          : point),
    }).ok).toBeFalse();

    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      observations: validGptSubsidySnapshot.observations.map((point, index) =>
        index === 0
          ? {
              ...point,
              tokens: {
                uncachedInput: Number.MAX_SAFE_INTEGER + 1,
                cachedInput: 0,
                output: 0,
                total: Number.MAX_SAFE_INTEGER + 1,
              },
            }
          : point),
    }).ok).toBeFalse();

    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      observations: validGptSubsidySnapshot.observations.slice(1),
    }).ok).toBeFalse();

    const zeroValuePoint = {
      ...validGptSubsidySnapshot.observations[0],
      tokens: { uncachedInput: 1, cachedInput: 0, output: 0, total: 1 },
      trailingSevenDayApiEquivalentUsd: 0,
    };
    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      observations: validGptSubsidySnapshot.observations.map((point, index) =>
        index === 0 ? zeroValuePoint : point),
    }).ok).toBeFalse();

    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      periodSummary: {
        ...validGptSubsidySnapshot.periodSummary,
        tokens: { uncachedInput: 0, cachedInput: 0, output: 0, total: 0 },
      },
    }).ok).toBeFalse();

    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      generatedAt: "2026-08-26T16:00:00.000Z",
    }).ok).toBeFalse();
  });

  test("rejects duplicates, gaps, malformed windows, and live observations", () => {
    const [first, second] = validGptSubsidySnapshot.observations;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      observations: validGptSubsidySnapshot.observations.map((point, index) =>
        index === 1 ? { ...point, id: first.id } : point),
    }).ok).toBeFalse();
    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      observations: validGptSubsidySnapshot.observations.toReversed(),
    }).ok).toBeFalse();
    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      observations: validGptSubsidySnapshot.observations.map((point, index) =>
        index === 1 ? { ...point, observedAt: "2026-08-26T23:59:59.999Z" } : point),
    }).ok).toBeFalse();
    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      observations: validGptSubsidySnapshot.observations.map((point, index) =>
        index === 0 ? { ...point, periodStartedAt: "2026-08-18T00:00:00.000Z" } : point),
    }).ok).toBeFalse();
    expect(parseGptSubsidySnapshot({
      ...validGptSubsidySnapshot,
      observations: validGptSubsidySnapshot.observations.map((point, index) =>
        index === 0 ? { ...point, status: "live" } : point),
    }).ok).toBeFalse();
  });

  test("formats the public summary values consistently", () => {
    expect(formatSubsidyUsd(8_051.1)).toBe("$8,051");
    expect(formatSubsidyRateUsd(0.4)).toBe("$0.40");
    expect(formatSubsidyRateUsd(20)).toBe("$20.00");
    expect(formatSubsidyTokens(3_413_874_344)).toBe("3.4B");
    expect(formatObservedAccountCount({
      status: "unavailable",
      distinctObservedAccounts: null,
      coverage: 0,
    })).toBe("Not yet available");
    expect(formatObservedAccountCount({
      status: "partial",
      distinctObservedAccounts: 1,
      coverage: 0.25,
    })).toBe("1+ account");
    expect(formatObservedAccountCount({
      status: "partial",
      distinctObservedAccounts: 8,
      coverage: 0.25,
    })).toBe("8+ accounts");
  });
});
