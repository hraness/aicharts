import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as fc from "fast-check";
import { sumTokenBuckets, updateGptSubsidy, validateSubsidyLedger } from "./update-gpt-subsidy";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const roots: string[] = [];
const now = "2026-08-25T15:00:00.000Z";
const end = "2026-08-25T00:00:00.000Z";
const start = "2026-07-19T00:00:00.000Z";
const DAY = 24 * 60 * 60 * 1_000;
const pricingManifestSource = `${JSON.stringify({
  schemaVersion: 1,
  kind: "aicharts-openai-rate-manifest",
  currency: "USD",
  unit: "per-million-tokens",
  frozenAt: "2026-08-25T00:00:00Z",
  normalizationPolicy: "Test fixture prices map exact recorded model IDs.",
  models: [
    {
      modelId: "codex-auto-review",
      pricingType: "proxy",
      sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
      rates: { input: 1, cachedInput: 0.1, cacheWrite: null, output: 5 },
      longContext: null,
      proxyModelId: "gpt-5.6-luna",
      proxyRationale: "Internal alias mapped to its checked model proxy.",
    },
    {
      modelId: "gpt-5.6-luna",
      pricingType: "official",
      sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
      rates: { input: 1, cachedInput: 0.1, cacheWrite: null, output: 5 },
      longContext: null,
    },
    {
      modelId: "gpt-5.6-sol",
      pricingType: "official",
      sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.6-sol",
      rates: { input: 4, cachedInput: 0.4, cacheWrite: null, output: 20 },
      longContext: null,
    },
  ],
})}\n`;
const pricingHash = createHash("sha256").update(pricingManifestSource).digest("hex");
const measurementManifestSource = await readFile(
  path.join(repositoryRoot, "data", "gpt-subsidy-measurement.json"),
  "utf8",
);
const measurementManifest = JSON.parse(measurementManifestSource) as {
  frozenAt: string;
  kind: "aicharts-gpt-subsidy-measurement";
  revision: string;
};
const measurementHash = createHash("sha256").update(measurementManifestSource).digest("hex");
const expectedMeasurement = {
  frozenAt: measurementManifest.frozenAt,
  kind: measurementManifest.kind,
  revision: measurementManifest.revision,
  sha256: measurementHash,
};
const expectedPricing = {
  frozenAt: "2026-08-25T00:00:00Z",
  kind: "aicharts-openai-rate-manifest" as const,
  modelIds: new Set(["codex-auto-review", "gpt-5.6-luna", "gpt-5.6-sol"]),
  proxyModelIds: new Set(["codex-auto-review"]),
  referenceModel: {
    cachedInputPerMillionUsd: 0.4,
    name: "GPT-5.6 Sol" as const,
    outputPerMillionUsd: 20,
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.6-sol",
    uncachedInputPerMillionUsd: 4,
  },
  sourceUrls: [
    "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
    "https://developers.openai.com/api/docs/models/gpt-5.6-sol",
  ],
  sha256: pricingHash,
};
const expectedMethodologySourceUrls = [
  "https://help.openai.com/en/articles/9793128",
  "https://learn.chatgpt.com/docs/pricing",
  "https://github.com/hraness/aicharts/blob/main/data/gpt-subsidy-measurement.json",
  "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
  "https://developers.openai.com/api/docs/models/gpt-5.6-sol",
  "https://github.com/junhoyeo/tokscale/blob/0149a44329fb89865837dde40adb8cd9bc06bead/crates/tokscale-core/src/sessions/codex.rs#L98-L214",
  "https://github.com/junhoyeo/tokscale/blob/0149a44329fb89865837dde40adb8cd9bc06bead/crates/tokscale-core/src/sessions/codex.rs#L518-L675",
];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

type TokenBuckets = ReturnType<typeof tokens>;
type Observation = {
  id: string;
  observedAt: string;
  periodStartedAt: string;
  periodEndsAt: string;
  status: "settled" | "live";
  tokens: TokenBuckets;
  trailingSevenDayApiEquivalentUsd: number;
  monthlyApiEquivalentUsd: number;
  planPriceMultiple: number;
};
type FixtureData = {
  observations: Observation[];
  [key: string]: unknown;
};

function addDays(value: string | Date, amount: number): Date {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date;
}

function dateOnly(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

function tokens(value: number): { uncachedInput: number; cachedInput: number; output: number; total: number } {
  return { uncachedInput: value, cachedInput: value * 2, output: value * 3, total: value * 6 };
}

function observation(date: string, value = 1, status: "settled" | "live" = "settled"): Observation {
  const weekly = value + 0.25;
  const monthly = weekly * 4;
  return {
    id: `trailing-7d-${date}`,
    observedAt: `${date}T23:59:59.999Z`,
    periodStartedAt: `${dateOnly(addDays(`${date}T00:00:00.000Z`, -6))}T00:00:00.000Z`,
    periodEndsAt: `${date}T23:59:59.999Z`,
    status,
    tokens: tokens(value),
    trailingSevenDayApiEquivalentUsd: weekly,
    monthlyApiEquivalentUsd: monthly,
    planPriceMultiple: monthly / 200,
  };
}

function baseData(observations: Observation[] = []): FixtureData {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-24T12:00:00.000Z",
    plan: {
      name: "ChatGPT Pro",
      monthlyPriceUsd: 200,
      advertisedUsageMultiplier: 20,
    },
    pricing: {
      basis: "per-model-api-retail",
      manifest: {
        name: "AI Charts OpenAI rate manifest",
        schemaVersion: 1,
        sha256: pricingHash,
        frozenAt: "2026-08-25T00:00:00Z",
        sourceUrl: "https://github.com/hraness/aicharts/blob/main/data/gpt-subsidy-pricing.json",
      },
      proxyModelIds: ["codex-auto-review"],
    },
    methodology: {
      measurement: {
        name: "AI Charts GPT subsidy measurement manifest",
        schemaVersion: 1,
        kind: measurementManifest.kind,
        revision: measurementManifest.revision,
        sha256: measurementHash,
        frozenAt: measurementManifest.frozenAt,
        sourceUrl: "https://github.com/hraness/aicharts/blob/main/data/gpt-subsidy-measurement.json",
      },
      weeksPerMonth: 99,
      formula: "Use current Tokscale catalog pricing.",
      disclaimer: "Stale methodology that must never be republished.",
      sourceUrls: ["https://example.com/stale"],
    },
    observations,
    currentAllowanceEstimate: { stale: "mixed-account projection must be removed" },
  };
}

async function fixture(data = baseData()) {
  const root = await mkdtemp(path.join(tmpdir(), "aicharts-subsidy-"));
  roots.push(root);
  const dataPath = path.join(root, "gpt-subsidy.json");
  const pricingPath = path.join(root, "gpt-subsidy-pricing.json");
  const measurementPath = path.join(root, "gpt-subsidy-measurement.json");
  await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await writeFile(pricingPath, pricingManifestSource, "utf8");
  await writeFile(measurementPath, measurementManifestSource, "utf8");
  return { dataPath, measurementPath, pricingPath };
}

async function readFixture(dataPath: string): Promise<FixtureData & {
  plan: { observedAt: string; sourceUrl: string };
  pricing: {
    manifest: { sha256: string; frozenAt: string };
    proxyModelIds: string[];
  };
  methodology: {
    weeksPerMonth: number;
    deduplication: string;
    measurement: {
      frozenAt: string;
      revision: string;
      sha256: string;
    };
    formula: string;
    disclaimer: string;
    sourceUrls: string[];
  };
  periodSummary: { startedAt: string; endedAt: string; days: number; tokens: TokenBuckets; apiEquivalentUsd: number };
}> {
  return JSON.parse(await readFile(dataPath, "utf8")) as FixtureData & {
    plan: { observedAt: string; sourceUrl: string };
    pricing: {
      manifest: { sha256: string; frozenAt: string };
      proxyModelIds: string[];
    };
    methodology: {
      weeksPerMonth: number;
      deduplication: string;
      measurement: {
        frozenAt: string;
        revision: string;
        sha256: string;
      };
      formula: string;
      disclaimer: string;
      sourceUrls: string[];
    };
    periodSummary: { startedAt: string; endedAt: string; days: number; tokens: TokenBuckets; apiEquivalentUsd: number };
  };
}

function ledger(rangeStart = start, rangeEnd = end) {
  const length = (Date.parse(rangeEnd) - Date.parse(rangeStart)) / DAY;
  if (!Number.isInteger(length) || length < 0) throw new TypeError("fixture ledger range must use UTC days");
  return {
    schemaVersion: 1 as const,
    parser: {
      name: "tokscale" as const,
      version: "4.13.0" as const,
      commit: "0149a44329fb89865837dde40adb8cd9bc06bead" as const,
    },
    deduplication: "tokscale-global-event-identity" as const,
    measurementBasis: expectedMeasurement,
    range: { startInclusive: rangeStart, endExclusive: rangeEnd },
    pricingCoverage: {
      status: "complete" as const,
      basis: {
        kind: "aicharts-openai-rate-manifest" as const,
        sha256: pricingHash,
        frozenAt: "2026-08-25T00:00:00Z",
      },
      modelIds: ["codex-auto-review", "gpt-5.6-sol"],
      proxyModelIds: ["codex-auto-review"],
      unpricedModelIds: [] as [],
    },
    days: Array.from({ length }, (_, index) => ({
      date: dateOnly(addDays(rangeStart, index)),
      complete: true,
      tokens: tokens(index + 1),
      apiEquivalentUsd: index + 0.25,
    })),
  };
}

function expectSettledDailyGeometry(observations: readonly Observation[]): void {
  observations.forEach((point, index) => {
    const date = point.observedAt.slice(0, 10);
    expect(point.status).toBe("settled");
    expect(point.id).toBe(`trailing-7d-${date}`);
    expect(point.observedAt).toBe(`${date}T23:59:59.999Z`);
    expect(point.periodEndsAt).toBe(point.observedAt);
    expect(point.periodStartedAt).toBe(`${dateOnly(addDays(`${date}T00:00:00.000Z`, -6))}T00:00:00.000Z`);
    expect(Date.parse(point.periodEndsAt) - Date.parse(point.periodStartedAt) + 1).toBe(7 * DAY);
    if (index > 0) {
      expect(Date.parse(point.observedAt) - Date.parse(observations[index - 1]!.observedAt)).toBe(DAY);
    }
  });
}

describe("globally deduplicated rolling collector", () => {
  test("publishes 31 settled trailing-seven-day points from 37 complete UTC days", async () => {
    const paths = await fixture();
    const result = await updateGptSubsidy({ ...paths, ledger: ledger(), now: () => new Date(now) });
    const data = await readFixture(paths.dataPath);

    expect(result).toEqual({ kind: "updated", observationCount: 31 });
    expect(data.observations[0]).toMatchObject({
      id: "trailing-7d-2026-07-25",
      status: "settled",
      trailingSevenDayApiEquivalentUsd: 22.75,
    });
    expect(data.observations.at(-1)).toMatchObject({
      id: "trailing-7d-2026-08-24",
      observedAt: "2026-08-24T23:59:59.999Z",
      status: "settled",
    });
    expect(data.observations[0]?.tokens.total).toBe(6 * (1 + 2 + 3 + 4 + 5 + 6 + 7));
    expect(data.periodSummary).toMatchObject({
      startedAt: "2026-07-25T00:00:00.000Z",
      endedAt: "2026-08-24T23:59:59.999Z",
      days: 31,
      apiEquivalentUsd: 658.75,
    });
    expect(data.periodSummary.tokens.total).toBe(
      6 * Array.from({ length: 31 }, (_, index) => index + 7).reduce((sum, value) => sum + value, 0),
    );
    expect(data).not.toHaveProperty("currentAllowanceEstimate");
    expect(data.plan).toMatchObject({
      observedAt: "2026-08-25T00:00:00Z",
      sourceUrl: "https://help.openai.com/en/articles/9793128",
    });
    expect(data.pricing).toMatchObject({
      manifest: {
        sha256: pricingHash,
        frozenAt: "2026-08-25T00:00:00Z",
      },
      proxyModelIds: ["codex-auto-review"],
    });
    expect(data.observations[0]?.monthlyApiEquivalentUsd)
      .toBe(Number((22.75 * 4).toFixed(12)));
    expect(data.methodology).toMatchObject({
      weeksPerMonth: 4,
      deduplication: "tokscale-global-event-identity",
      measurement: expectedMeasurement,
    });
    expect(data.methodology.formula).toContain(
      "checked August 25, 2026 AI Charts OpenAI rate manifest",
    );
    expect(data.methodology.formula).not.toContain("current");
    expect(data.methodology.formula).toContain("multiplies that trailing-seven-day API-retail-equivalent value by exactly 4");
    expect(data.methodology.disclaimer).toContain("one user's available local Codex logs");
    expect(data.methodology.disclaimer).toContain("does not observe whether a weekly quota was exhausted or when it reset");
    expect(data.methodology.disclaimer).toContain("not four observed exhausted allocations");
    expect(data.methodology.disclaimer).toContain("API-key or otherwise API-billed usage");
    expect(data.methodology.disclaimer).toContain("purchased ChatGPT credits");
    expect(data.methodology.sourceUrls).toEqual(expectedMethodologySourceUrls);
    expectSettledDailyGeometry(data.observations);
  });

  test("is deterministic and does not rewrite identical public data", async () => {
    const paths = await fixture();
    await updateGptSubsidy({ ...paths, ledger: ledger(), now: () => new Date(now) });
    const before = await readFile(paths.dataPath, "utf8");
    expect((await updateGptSubsidy({ ...paths, ledger: ledger(), now: () => new Date(now) })).kind).toBe("unchanged");
    expect(await readFile(paths.dataPath, "utf8")).toBe(before);
  });

  test("retains every settled observation older than the recomputed overlap", async () => {
    const prefix = observation("2026-07-24", 99);
    const paths = await fixture(baseData([prefix]));
    await updateGptSubsidy({ ...paths, ledger: ledger(), now: () => new Date(now) });
    const data = await readFixture(paths.dataPath);

    expect(data.observations).toHaveLength(32);
    expect(data.observations[0]).toEqual(prefix);
    expect(data.observations.at(-1)?.id).toBe("trailing-7d-2026-08-24");
    expectSettledDailyGeometry(data.observations);
  });

  test("replaces overlapping dates, including a legacy live point, without duplicate IDs", async () => {
    const paths = await fixture();
    await updateGptSubsidy({ ...paths, ledger: ledger(), now: () => new Date(now) });
    const corrupted = await readFixture(paths.dataPath);
    const overlap = corrupted.observations[8];
    if (overlap === undefined) throw new Error("fixture needs an overlap point");
    overlap.status = "live";
    overlap.trailingSevenDayApiEquivalentUsd = 1;
    await writeFile(paths.dataPath, `${JSON.stringify(corrupted, null, 2)}\n`, "utf8");

    await updateGptSubsidy({ ...paths, ledger: ledger(), now: () => new Date(now) });
    const data = await readFixture(paths.dataPath);
    const ids = data.observations.map(({ id }) => id);
    expect(data.observations[8]?.status).toBe("settled");
    expect(data.observations[8]?.trailingSevenDayApiEquivalentUsd).not.toBe(1);
    expect(data.observations.filter(({ status }) => status === "live")).toHaveLength(0);
    expect(new Set(ids).size).toBe(ids.length);
    expectSettledDailyGeometry(data.observations);
  });

  test("repairs every historical daily gap using a dynamic bounded scan", async () => {
    const gap = "2026-06-15";
    const history = Array.from({ length: 116 }, (_, index) => dateOnly(addDays("2026-05-01T00:00:00.000Z", index)))
      .filter((date) => date !== gap)
      .map((date, index) => observation(date, index + 1));
    const rangeStart = "2026-06-09T00:00:00.000Z";
    const paths = await fixture(baseData(history));

    await updateGptSubsidy({
      ...paths,
      ledger: ledger(rangeStart, end),
      now: () => new Date(now),
    });
    const data = await readFixture(paths.dataPath);
    expect(data.observations.find(({ id }) => id === `trailing-7d-${gap}`)).toBeDefined();
    expect(data.observations[0]?.id).toBe("trailing-7d-2026-05-01");
    expect(data.observations.at(-1)?.id).toBe("trailing-7d-2026-08-24");
    expectSettledDailyGeometry(data.observations);
  });

  test("fails explicitly when a history gap exceeds the 366-day safe scan bound", async () => {
    const paths = await fixture(baseData([observation("2025-01-01")]));
    await expect(updateGptSubsidy({ ...paths, now: () => new Date(now) }))
      .rejects.toThrow("exceeding the 366-day safe scan bound");
  });

  test("rejects missing, duplicate, out-of-order, and incomplete days", () => {
    const missing = ledger();
    missing.days.splice(3, 1);
    expect(() => validateSubsidyLedger(missing, { start, end }, expectedPricing, expectedMeasurement)).toThrow("contiguous UTC days");

    const reversed = ledger();
    reversed.days.reverse();
    expect(() => validateSubsidyLedger(reversed, { start, end }, expectedPricing, expectedMeasurement)).toThrow("missing, duplicated, or out of order");

    const duplicate = ledger();
    duplicate.days[4] = duplicate.days[3]!;
    expect(() => validateSubsidyLedger(duplicate, { start, end }, expectedPricing, expectedMeasurement)).toThrow("missing, duplicated, or out of order");

    const partial = ledger();
    partial.days.at(-1)!.complete = false;
    expect(() => validateSubsidyLedger(partial, { start, end }, expectedPricing, expectedMeasurement)).toThrow("only complete UTC days");
  });

  test("rejects mutable parser identity, mutable pricing provenance, partial coverage, and zero-priced usage", () => {
    expect(() => validateSubsidyLedger({ ...ledger(), parser: { ...ledger().parser, version: "latest" } }, { start, end }, expectedPricing, expectedMeasurement)).toThrow();
    expect(() => validateSubsidyLedger({
      ...ledger(),
      measurementBasis: { ...ledger().measurementBasis, sha256: "f".repeat(64) },
    }, { start, end }, expectedPricing, expectedMeasurement)).toThrow(
      "measurement provenance differs",
    );
    expect(() => validateSubsidyLedger({
      ...ledger(),
      pricingCoverage: {
        ...ledger().pricingCoverage,
        basis: { ...ledger().pricingCoverage.basis, sha256: "mutable" },
      },
    }, { start, end }, expectedPricing, expectedMeasurement)).toThrow();
    expect(() => validateSubsidyLedger({
      ...ledger(), pricingCoverage: { ...ledger().pricingCoverage, unpricedModelIds: ["unknown"] },
    }, { start, end }, expectedPricing, expectedMeasurement)).toThrow();
    expect(() => validateSubsidyLedger({
      ...ledger(), pricingCoverage: { ...ledger().pricingCoverage, proxyModelIds: [] },
    }, { start, end }, expectedPricing, expectedMeasurement)).toThrow("proxy disclosure differs");
    const unpriced = ledger();
    unpriced.days[2] = { ...unpriced.days[2]!, apiEquivalentUsd: 0 };
    expect(() => validateSubsidyLedger(unpriced, { start, end }, expectedPricing, expectedMeasurement)).toThrow("positive manifest price");
  });

  test("requires sorted unique model coverage", () => {
    expect(() => validateSubsidyLedger({
      ...ledger(), pricingCoverage: { ...ledger().pricingCoverage, modelIds: ["gpt-5.6-sol", "codex-auto-review"] },
    }, { start, end }, expectedPricing, expectedMeasurement)).toThrow("unique and sorted");
    expect(() => validateSubsidyLedger({
      ...ledger(), pricingCoverage: { ...ledger().pricingCoverage, modelIds: ["gpt-5.6-sol", "gpt-5.6-sol"] },
    }, { start, end }, expectedPricing, expectedMeasurement)).toThrow("unique and sorted");
  });

  test("rejects an adapter whose pricing basis differs from the checked manifest", async () => {
    const paths = await fixture();
    const changedManifest = pricingManifestSource.replace(
      "Test fixture prices map exact recorded model IDs.",
      "The bytes changed even though the rates did not.",
    );
    const changedHash = createHash("sha256").update(changedManifest).digest("hex");
    const existing = baseData();
    existing.pricing = {
      basis: "per-model-api-retail",
      manifest: {
        name: "AI Charts OpenAI rate manifest",
        schemaVersion: 1,
        sha256: changedHash,
        frozenAt: "2026-08-25T00:00:00Z",
        sourceUrl: "https://github.com/hraness/aicharts/blob/main/data/gpt-subsidy-pricing.json",
      },
      proxyModelIds: ["codex-auto-review"],
    };
    await writeFile(paths.dataPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
    await writeFile(paths.pricingPath, changedManifest, "utf8");
    await expect(updateGptSubsidy({ ...paths, ledger: ledger(), now: () => new Date(now) }))
      .rejects.toThrow("pricing provenance differs from the checked rate manifest");
  });

  test("refuses to relabel retained observations when the checked pricing basis changes", async () => {
    const retained = observation("2026-07-24", 99);
    const paths = await fixture(baseData([retained]));
    const changedManifest = pricingManifestSource.replace(
      "Test fixture prices map exact recorded model IDs.",
      "A deliberate new pricing basis that requires a complete-series migration.",
    );
    const changedHash = createHash("sha256").update(changedManifest).digest("hex");
    const matchingLedger = ledger();
    matchingLedger.pricingCoverage.basis.sha256 = changedHash;
    await writeFile(paths.pricingPath, changedManifest, "utf8");

    await expect(updateGptSubsidy({
      ...paths,
      ledger: matchingLedger,
      now: () => new Date(now),
    })).rejects.toThrow("Existing GPT subsidy history uses a different checked pricing basis");
    expect((await readFixture(paths.dataPath)).observations).toEqual([retained]);
  });

  test("refuses to mix retained observations with another measurement implementation", async () => {
    const retained = observation("2026-07-24", 99);
    const existing = baseData([retained]);
    const methodology = existing.methodology as {
      measurement: { sha256: string };
    };
    methodology.measurement.sha256 = "f".repeat(64);
    const paths = await fixture(existing);

    await expect(updateGptSubsidy({
      ...paths,
      ledger: ledger(),
      now: () => new Date(now),
    })).rejects.toThrow("uses a different checked measurement basis");
    expect((await readFixture(paths.dataPath)).observations).toEqual([retained]);
  });

  test("preserves complete-series proxy disclosure after proxy usage leaves the scan", async () => {
    const existing = baseData();
    const paths = await fixture(existing);
    const noProxyLedger = ledger();
    noProxyLedger.pricingCoverage.modelIds = ["gpt-5.6-sol"];
    noProxyLedger.pricingCoverage.proxyModelIds = [];

    await updateGptSubsidy({
      ...paths,
      ledger: noProxyLedger,
      now: () => new Date(now),
    });
    expect((await readFixture(paths.dataPath)).pricing.proxyModelIds)
      .toEqual(["codex-auto-review"]);
  });
});

describe("rolling collector properties", () => {
  test("aggregates token buckets exactly", () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
      ), { maxLength: 200 }),
      (rows) => {
        const values = rows.map(([uncachedInput, cachedInput, output]) => ({
          uncachedInput,
          cachedInput,
          output,
          total: uncachedInput + cachedInput + output,
        }));
        const aggregate = sumTokenBuckets(values);
        expect(aggregate.uncachedInput).toBe(rows.reduce((sum, row) => sum + row[0], 0));
        expect(aggregate.cachedInput).toBe(rows.reduce((sum, row) => sum + row[1], 0));
        expect(aggregate.output).toBe(rows.reduce((sum, row) => sum + row[2], 0));
        expect(aggregate.total).toBe(
          aggregate.uncachedInput + aggregate.cachedInput + aggregate.output,
        );
      },
    ));
  });

  test("keeps daily adjacency and exact seven-calendar-day geometry for arbitrary UTC dates", async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 0, max: 365 }),
      async (offset) => {
        const clock = addDays("2026-01-01T12:00:00.000Z", offset);
        const closedEnd = new Date(Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate()));
        const rangeStart = addDays(closedEnd, -37).toISOString();
        const paths = await fixture();
        await updateGptSubsidy({
          ...paths,
          ledger: ledger(rangeStart, closedEnd.toISOString()),
          now: () => clock,
        });
        expectSettledDailyGeometry((await readFixture(paths.dataPath)).observations);
      },
    ), { numRuns: 20 });
  });

  test("replaces arbitrary overlaps and remains idempotent", async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 0, max: 30 }),
      fc.boolean(),
      async (index, legacyLive) => {
        const paths = await fixture();
        await updateGptSubsidy({ ...paths, ledger: ledger(), now: () => new Date(now) });
        const pristine = await readFixture(paths.dataPath);
        const expected = pristine.observations[index];
        if (expected === undefined) throw new Error("generated overlap index is out of range");
        const corrupted = structuredClone(pristine);
        const point = corrupted.observations[index]!;
        point.trailingSevenDayApiEquivalentUsd = 0;
        point.status = legacyLive ? "live" : "settled";
        await writeFile(paths.dataPath, `${JSON.stringify(corrupted, null, 2)}\n`, "utf8");

        await updateGptSubsidy({ ...paths, ledger: ledger(), now: () => new Date(now) });
        const repaired = await readFixture(paths.dataPath);
        expect(repaired.observations[index]).toEqual(expected);
        const bytes = await readFile(paths.dataPath, "utf8");
        expect((await updateGptSubsidy({ ...paths, ledger: ledger(), now: () => new Date(now) })).kind)
          .toBe("unchanged");
        expect(await readFile(paths.dataPath, "utf8")).toBe(bytes);
      },
    ), { numRuns: 15 });
  });

  test("preserves arbitrary contiguous settled prefixes byte-for-byte", async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 1, max: 60 }),
      async (length) => {
        const first = addDays("2026-07-25T00:00:00.000Z", -length);
        const prefix = Array.from({ length }, (_, index) => observation(dateOnly(addDays(first, index)), index + 50));
        const paths = await fixture(baseData(prefix));
        await updateGptSubsidy({ ...paths, ledger: ledger(), now: () => new Date(now) });
        const data = await readFixture(paths.dataPath);
        expect(data.observations.slice(0, length)).toEqual(prefix);
        expectSettledDailyGeometry(data.observations);
      },
    ), { numRuns: 20 });
  });
});
