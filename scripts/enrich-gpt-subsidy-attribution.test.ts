import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  attributionEnricherCliOptions,
  deriveAccountPlanComparison,
  enrichGptSubsidyAttribution,
} from "./enrich-gpt-subsidy-attribution";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const roots: string[] = [];
const keyId = `sha256:v1:${"K".repeat(43)}`;
const accountOne = `hmac-sha256:v1:${"A".repeat(43)}`;
const accountTwo = `hmac-sha256:v1:${"B".repeat(43)}`;
const privateLimitId = "private-limit-marker";
const periodStartedAt = "2026-08-05T00:00:00.000Z";
const periodEndedAt = "2026-09-04T23:59:59.999Z";

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {
    force: true,
    recursive: true,
  })));
});

function accountLedger(intervals = [
  {
    accountFingerprint: accountOne,
    authMode: "chatgpt",
    planStatus: "subscription-unverified",
    startedAt: "2026-08-10T00:00:00.000Z",
    lastObservedAt: "2026-08-20T00:00:00.000Z",
  },
  {
    accountFingerprint: accountTwo,
    authMode: "chatgpt",
    planStatus: "subscription-unverified",
    startedAt: "2026-08-20T00:00:00.000Z",
    lastObservedAt: "2026-09-01T00:00:00.000Z",
  },
]) {
  return {
    version: 1,
    keyId,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    accounts: [accountOne, accountTwo].map(fingerprint => ({
      fingerprint,
      firstObservedAt: "2026-08-01T00:00:00.000Z",
      lastObservedAt: "2026-09-05T00:00:00.000Z",
    })),
    intervals,
  };
}

function bucket(planType: "plus" | "pro" | null, limitId = "codex") {
  return {
    limitId,
    planType,
    primary: {
      resetsAt: 1_788_000_000,
      usedPercent: 20,
      windowDurationMins: 300,
    },
    secondary: null,
  };
}

function rateLimitLedger() {
  return {
    version: 1,
    keyId,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    observations: [
      {
        accountFingerprint: accountOne,
        availableResetCreditCount: 1,
        buckets: [bucket("pro"), bucket("pro", privateLimitId)],
        startedAt: "2026-08-15T12:00:00.000Z",
        lastObservedAt: "2026-08-15T12:00:00.000Z",
      },
      {
        accountFingerprint: accountTwo,
        availableResetCreditCount: 0,
        buckets: [bucket("pro"), bucket("plus", privateLimitId)],
        startedAt: "2026-08-25T12:00:00.000Z",
        lastObservedAt: "2026-08-25T12:00:00.000Z",
      },
    ],
    resets: [],
  };
}

const manifest = {
  frozenAt: "2026-09-04T00:00:00Z",
  revision: "2026-09-04.2",
  sha256: "f".repeat(64),
} as const;

type PrivateFixture = Readonly<{
  accountLedgerPath: string;
  attributionManifestPath: string;
  continuityPath: string;
  dataPath: string;
  rateLimitLedgerPath: string;
  repositoryRoot: string;
  root: string;
  stateRoot: string;
}>;

function runFixtureGit(repositoryRoot: string, arguments_: readonly string[]): void {
  const result = spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`Fixture Git command failed: git ${arguments_.join(" ")}.`);
  }
}

async function privateFixture(): Promise<PrivateFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "aicharts-attribution-private-"));
  roots.push(root);
  const fixtureRepositoryRoot = path.join(root, "repository");
  const stateRoot = path.join(root, "state");
  const dataPath = path.join(
    fixtureRepositoryRoot,
    "data",
    "gpt-subsidy.json",
  );
  const attributionManifestPath = path.join(
    fixtureRepositoryRoot,
    "data",
    "gpt-subsidy-attribution-measurement.json",
  );
  const accountLedgerPath = path.join(stateRoot, "account-observations.json");
  const rateLimitLedgerPath = path.join(
    stateRoot,
    "codex-rate-limit-observations.json",
  );
  const continuityPath = path.join(stateRoot, "attribution-continuity.json");
  const checkedFixturePaths = [
    "data/gpt-subsidy.json",
    "data/gpt-subsidy-attribution-measurement.json",
    "lib/gpt-subsidy-attribution-manifest.ts",
    "lib/gpt-subsidy-data.ts",
    "scripts/enrich-gpt-subsidy-attribution.ts",
    "scripts/publish-gpt-subsidy.ts",
  ] as const;
  for (const relativePath of checkedFixturePaths) {
    const target = path.join(fixtureRepositoryRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(repositoryRoot, relativePath), target);
  }
  runFixtureGit(fixtureRepositoryRoot, ["init", "--quiet"]);
  runFixtureGit(fixtureRepositoryRoot, ["add", "--all"]);
  runFixtureGit(fixtureRepositoryRoot, [
    "-c",
    "user.name=AI Charts Test",
    "-c",
    "user.email=test@aicharts.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture baseline",
  ]);

  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  await chmod(stateRoot, 0o700);
  await Promise.all([
    writeFile(accountLedgerPath, `${JSON.stringify(accountLedger())}\n`, {
      encoding: "utf8",
      mode: 0o600,
    }),
    writeFile(rateLimitLedgerPath, `${JSON.stringify(rateLimitLedger())}\n`, {
      encoding: "utf8",
      mode: 0o600,
    }),
  ]);
  await Promise.all([
    chmod(accountLedgerPath, 0o600),
    chmod(rateLimitLedgerPath, 0o600),
  ]);
  return {
    accountLedgerPath,
    attributionManifestPath,
    continuityPath,
    dataPath,
    rateLimitLedgerPath,
    repositoryRoot: fixtureRepositoryRoot,
    root,
    stateRoot,
  };
}

async function enrichFixture(fixture: PrivateFixture) {
  const outcome = await enrichGptSubsidyAttribution({
    accountLedgerPath: fixture.accountLedgerPath,
    attributionManifestPath: fixture.attributionManifestPath,
    continuityPath: fixture.continuityPath,
    dataPath: fixture.dataPath,
    rateLimitLedgerPath: fixture.rateLimitLedgerPath,
    repositoryRoot: fixture.repositoryRoot,
  });
  if (outcome.kind === "updated") {
    runFixtureGit(fixture.repositoryRoot, ["add", "data/gpt-subsidy.json"]);
    runFixtureGit(fixture.repositoryRoot, [
      "-c",
      "user.name=AI Charts Test",
      "-c",
      "user.email=test@aicharts.invalid",
      "commit",
      "--quiet",
      "-m",
      "publish sampled attribution",
    ]);
  }
  return outcome;
}

describe("GPT subsidy account attribution", () => {
  test("does not expose an arbitrary production-baseline CLI override", () => {
    expect(attributionEnricherCliOptions([])).toEqual({});
    expect(() => attributionEnricherCliOptions([
      "--baseline",
      "/tmp/forged-public-baseline.json",
    ])).toThrow("Usage: enrich-gpt-subsidy-attribution.ts");
  });

  test("uses positive-duration sampled coverage and only all-bucket Pro evidence", () => {
    const result = deriveAccountPlanComparison({
      accountLedger: accountLedger(),
      apiEquivalentUsd: 72_000,
      firstSampledAt: null,
      generatedAt: "2026-09-05T00:17:00.000Z",
      manifest,
      periodEndedAt,
      periodStartedAt,
      planPriceUsd: 200,
      rateLimitLedger: rateLimitLedger(),
    });

    expect(result.accountAttribution).toMatchObject({
      status: "partial",
      distinctObservedAccounts: 2,
    });
    expect(result.accountAttribution.coverage).toBe(0.7);
    expect(result.observedProPlanComparison).toEqual({
      status: "sampled",
      distinctVerifiedProAccountsLowerBound: 1,
      normalizedPlanValueUsd: 200,
      apiEquivalentMultipleUpperBound: 360,
    });
    expect(result.firstSampledAt).toBe("2026-09-05T00:17:00.000Z");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(accountOne);
    expect(serialized).not.toContain(accountTwo);
    expect(serialized).not.toContain(keyId);
  });

  test("publishes only coarse partial coverage, including an explicit sub-one-percent category", () => {
    const minute = accountLedger([{
      accountFingerprint: accountOne,
      authMode: "chatgpt",
      planStatus: "subscription-unverified",
      startedAt: "2026-08-15T12:00:00.000Z",
      lastObservedAt: "2026-08-15T12:01:00.000Z",
    }]);
    const minuteResult = deriveAccountPlanComparison({
      accountLedger: minute,
      apiEquivalentUsd: 72_000,
      firstSampledAt: null,
      generatedAt: "2026-09-05T00:17:00.000Z",
      manifest,
      periodEndedAt,
      periodStartedAt,
      planPriceUsd: 200,
      rateLimitLedger: rateLimitLedger(),
    });
    expect(minuteResult.accountAttribution).toEqual({
      status: "partial",
      distinctObservedAccounts: 1,
      coverage: 1e-10,
    });

    const periodWide = accountLedger([{
      accountFingerprint: accountOne,
      authMode: "chatgpt",
      planStatus: "subscription-unverified",
      startedAt: periodStartedAt,
      lastObservedAt: "2026-09-05T00:00:00.000Z",
    }]);
    const periodWideResult = deriveAccountPlanComparison({
      accountLedger: periodWide,
      apiEquivalentUsd: 72_000,
      firstSampledAt: null,
      generatedAt: "2026-09-05T00:17:00.000Z",
      manifest,
      periodEndedAt,
      periodStartedAt,
      planPriceUsd: 200,
      rateLimitLedger: rateLimitLedger(),
    });
    expect(periodWideResult.accountAttribution).toEqual({
      status: "partial",
      distinctObservedAccounts: 1,
      coverage: 0.99,
    });
  });

  test("does not treat point samples, null plans, or mixed plans as coverage-backed Pro accounts", () => {
    const point = accountLedger([{
      accountFingerprint: accountOne,
      authMode: "chatgpt",
      planStatus: "subscription-unverified",
      startedAt: "2026-08-15T12:00:00.000Z",
      lastObservedAt: "2026-08-15T12:00:00.000Z",
    }]);
    const result = deriveAccountPlanComparison({
      accountLedger: point,
      apiEquivalentUsd: 72_000,
      firstSampledAt: null,
      generatedAt: "2026-09-05T00:17:00.000Z",
      manifest,
      periodEndedAt,
      periodStartedAt,
      planPriceUsd: 200,
      rateLimitLedger: rateLimitLedger(),
    });
    expect(result.accountAttribution.status).toBe("unavailable");
    expect(result.observedProPlanComparison.status).toBe("unavailable");

    const unknownPlans = rateLimitLedger();
    unknownPlans.observations[0]!.buckets = [bucket("pro"), bucket(null, "other")];
    const unknownResult = deriveAccountPlanComparison({
      accountLedger: accountLedger(),
      apiEquivalentUsd: 72_000,
      firstSampledAt: null,
      generatedAt: "2026-09-05T00:17:00.000Z",
      manifest,
      periodEndedAt,
      periodStartedAt,
      planPriceUsd: 200,
      rateLimitLedger: unknownPlans,
    });
    expect(unknownResult.accountAttribution.status).toBe("partial");
    expect(unknownResult.observedProPlanComparison.status).toBe("unavailable");
  });

  test("excludes an account when any overlapping observation reports a non-Pro plan", () => {
    const changingPlans = rateLimitLedger();
    changingPlans.observations.splice(1, 0, {
      accountFingerprint: accountOne,
      availableResetCreditCount: 1,
      buckets: [bucket("plus")],
      startedAt: "2026-08-20T12:00:00.000Z",
      lastObservedAt: "2026-08-20T12:00:00.000Z",
    });
    const result = deriveAccountPlanComparison({
      accountLedger: accountLedger(),
      apiEquivalentUsd: 72_000,
      firstSampledAt: null,
      generatedAt: "2026-09-05T00:17:00.000Z",
      manifest,
      periodEndedAt,
      periodStartedAt,
      planPriceUsd: 200,
      rateLimitLedger: changingPlans,
    });

    expect(result.accountAttribution.status).toBe("partial");
    expect(result.observedProPlanComparison.status).toBe("unavailable");
  });

  test("rejects offset-form private timestamps before lexical chronology checks", () => {
    const offsetLedger = accountLedger();
    offsetLedger.intervals[0]!.startedAt = "2026-08-09T20:00:00-04:00";

    expect(() => deriveAccountPlanComparison({
      accountLedger: offsetLedger,
      apiEquivalentUsd: 72_000,
      firstSampledAt: null,
      generatedAt: "2026-09-05T00:17:00.000Z",
      manifest,
      periodEndedAt,
      periodStartedAt,
      planPriceUsd: 200,
      rateLimitLedger: rateLimitLedger(),
    })).toThrow("canonical UTC ISO-8601");
  });

  test("fails closed when the private ledgers use different HMAC keys", () => {
    expect(() => deriveAccountPlanComparison({
      accountLedger: accountLedger(),
      apiEquivalentUsd: 72_000,
      firstSampledAt: null,
      generatedAt: "2026-09-05T00:17:00.000Z",
      manifest,
      periodEndedAt,
      periodStartedAt,
      planPriceUsd: 200,
      rateLimitLedger: {
        ...rateLimitLedger(),
        keyId: `sha256:v1:${"Z".repeat(43)}`,
      },
    })).toThrow("different HMAC keys");
  });

  test("keeps checked data unavailable before private sampling exists", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aicharts-attribution-missing-"));
    roots.push(root);
    const dataPath = path.join(root, "gpt-subsidy.json");
    await copyFile(path.join(repositoryRoot, "data", "gpt-subsidy.json"), dataPath);

    const result = await enrichGptSubsidyAttribution({
      accountLedgerPath: path.join(root, "missing-state", "accounts.json"),
      dataPath,
      rateLimitLedgerPath: path.join(root, "missing-state", "limits.json"),
      repositoryRoot,
    });
    expect(result.attributionStatus).toBe("unavailable");
    const publicBytes = await readFile(dataPath, "utf8");
    expect(publicBytes).not.toContain("hmac-sha256");
  });

  test("publishes only aggregates and refuses missing state after sampling", async () => {
    const fixture = await privateFixture();
    const result = await enrichFixture(fixture);
    expect(result.attributionStatus).toBe("partial");
    const publicBytes = await readFile(fixture.dataPath, "utf8");
    expect(publicBytes).not.toContain(accountOne);
    expect(publicBytes).not.toContain(accountTwo);
    expect(publicBytes).not.toContain(keyId);
    expect(publicBytes).not.toContain(privateLimitId);
    expect(publicBytes).toContain('"distinctVerifiedProAccountsLowerBound": 1');
    const published = JSON.parse(publicBytes) as {
      observations: Array<{
        accountAttribution: {
          status: string;
          distinctObservedAccounts: number | null;
          coverage: number;
        };
        subscriptionAdjustedMultiple: null;
      }>;
    };
    const latestObservation = published.observations.at(-1)!;
    expect(latestObservation.accountAttribution).toMatchObject({
      status: "partial",
      distinctObservedAccounts: 1,
    });
    expect(latestObservation.accountAttribution.coverage).toBe(0.42);
    expect(published.observations.some(
      observation => observation.accountAttribution.status === "complete",
    )).toBe(false);
    expect(published.observations.every(
      observation => observation.subscriptionAdjustedMultiple === null,
    )).toBe(true);

    await rm(fixture.stateRoot, { force: true, recursive: true });
    await expect(enrichFixture(fixture)).rejects.toThrow(
      "missing after sampled attribution",
    );
  });

  test("preserves sampled evidence on a same-key publisher reinstall", async () => {
    const fixture = await privateFixture();
    await enrichFixture(fixture);
    const firstPublication = await readFile(fixture.dataPath, "utf8");

    const rerun = await enrichFixture(fixture);
    expect(rerun.kind).toBe("unchanged");
    expect(await readFile(fixture.dataPath, "utf8")).toBe(firstPublication);
    expect((await stat(fixture.continuityPath)).mode & 0o777).toBe(0o600);
    const continuity = await readFile(fixture.continuityPath, "utf8");
    expect(continuity).toContain(keyId);
    expect(continuity).not.toContain(accountOne);
    expect(continuity).not.toContain(accountTwo);

  });

  test("rejects an empty same-key ledger that would erase fixed-window evidence", async () => {
    const fixture = await privateFixture();
    await enrichFixture(fixture);
    const current = JSON.parse(await readFile(fixture.dataPath, "utf8")) as {
      observations: Array<Record<string, unknown>>;
    };
    current.observations = current.observations.map(observation => ({
      ...observation,
      accountAttribution: {
        status: "unavailable",
        distinctObservedAccounts: null,
        coverage: 0,
      },
    }));
    await Promise.all([
      writeFile(fixture.dataPath, `${JSON.stringify(current, null, 2)}\n`, "utf8"),
      writeFile(
        fixture.accountLedgerPath,
        `${JSON.stringify(accountLedger([]))}\n`,
        { encoding: "utf8", mode: 0o600 },
      ),
    ]);

    await expect(enrichFixture(fixture)).rejects.toThrow(
      "Private GPT subsidy attribution state is invalid",
    );
  });

  test("rejects same-key rate-limit history shrinkage", async () => {
    const fixture = await privateFixture();
    await enrichFixture(fixture);
    await writeFile(
      fixture.rateLimitLedgerPath,
      `${JSON.stringify({ ...rateLimitLedger(), observations: [] })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );

    await expect(enrichFixture(fixture)).rejects.toThrow(
      "Private GPT subsidy attribution state is invalid",
    );
  });

  test("rejects a same-key replacement ledger with a new creation epoch", async () => {
    const fixture = await privateFixture();
    await enrichFixture(fixture);
    const replacementAccountLedger = accountLedger();
    replacementAccountLedger.createdAt = "2026-08-02T00:00:00.000Z";
    replacementAccountLedger.accounts = replacementAccountLedger.accounts.map(
      account => ({
        ...account,
        firstObservedAt: "2026-08-02T00:00:00.000Z",
      }),
    );
    const replacementRateLimitLedger = {
      ...rateLimitLedger(),
      createdAt: "2026-08-02T00:00:00.000Z",
    };
    await Promise.all([
      writeFile(
        fixture.accountLedgerPath,
        `${JSON.stringify(replacementAccountLedger)}\n`,
        { encoding: "utf8", mode: 0o600 },
      ),
      writeFile(
        fixture.rateLimitLedgerPath,
        `${JSON.stringify(replacementRateLimitLedger)}\n`,
        { encoding: "utf8", mode: 0o600 },
      ),
    ]);

    await expect(enrichFixture(fixture)).rejects.toThrow(
      "Private GPT subsidy attribution state is invalid",
    );
  });

  test("rejects loss of a same-period observed-Pro lower bound", async () => {
    const fixture = await privateFixture();
    await enrichFixture(fixture);
    const changedPlans = rateLimitLedger();
    changedPlans.observations[0]!.buckets = [
      bucket("plus"),
      bucket("plus", privateLimitId),
    ];
    await writeFile(
      fixture.rateLimitLedgerPath,
      `${JSON.stringify(changedPlans)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );

    await expect(enrichFixture(fixture)).rejects.toThrow(
      "observed-Pro comparison regressed below its published floor",
    );
  });

  test("rejects same-key history that decreases a published distinct-account floor", async () => {
    const fixture = await privateFixture();
    await enrichFixture(fixture);
    const regressed = accountLedger();
    regressed.intervals[1] = {
      ...regressed.intervals[1]!,
      accountFingerprint: accountOne,
    };
    await writeFile(
      fixture.accountLedgerPath,
      `${JSON.stringify(regressed)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );

    await expect(enrichFixture(fixture)).rejects.toThrow(
      "regressed below its published attribution floor",
    );
  });

  test("rejects a re-keyed ledger after attribution continuity is established", async () => {
    const fixture = await privateFixture();
    await enrichFixture(fixture);
    const replacementKeyId = `sha256:v1:${"Z".repeat(43)}`;
    await Promise.all([
      writeFile(
        fixture.accountLedgerPath,
        `${JSON.stringify({ ...accountLedger(), keyId: replacementKeyId })}\n`,
        { encoding: "utf8", mode: 0o600 },
      ),
      writeFile(
        fixture.rateLimitLedgerPath,
        `${JSON.stringify({ ...rateLimitLedger(), keyId: replacementKeyId })}\n`,
        { encoding: "utf8", mode: 0o600 },
      ),
    ]);

    await expect(enrichFixture(fixture)).rejects.toThrow(
      "Private GPT subsidy attribution state is invalid",
    );
  });

  test("rejects a symbolic-link private ledger without exposing its contents", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aicharts-attribution-link-"));
    roots.push(root);
    const stateRoot = path.join(root, "state");
    const target = path.join(root, "target.json");
    const accountLedgerPath = path.join(stateRoot, "account-observations.json");
    const rateLimitLedgerPath = path.join(stateRoot, "codex-rate-limit-observations.json");
    const dataPath = path.join(root, "gpt-subsidy.json");
    await mkdir(stateRoot, { mode: 0o700 });
    await writeFile(target, `${JSON.stringify(accountLedger())}\n`, { mode: 0o600 });
    await symlink(target, accountLedgerPath);
    await writeFile(rateLimitLedgerPath, `${JSON.stringify(rateLimitLedger())}\n`, {
      mode: 0o600,
    });
    await copyFile(path.join(repositoryRoot, "data", "gpt-subsidy.json"), dataPath);

    await expect(enrichGptSubsidyAttribution({
      accountLedgerPath,
      dataPath,
      rateLimitLedgerPath,
      repositoryRoot,
    })).rejects.toThrow("symbolic link");
  });
});
