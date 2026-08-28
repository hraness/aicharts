import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  acquireRecorderLock,
  observeParsedAuth,
  recordCodexAccount,
  recorderPaths,
} from "./record-codex-account";

const temporaryRoots: string[] = [];
const recorder = path.join(import.meta.dir, "record-codex-account.ts");
const recordedRateLimits = {
  availableResetCreditCount: 0,
  bucketCount: 1,
  detectedResets: [],
  kind: "recorded",
  windowCount: 1,
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
    force: true,
    recursive: true,
  })));
});

async function fixture(): Promise<Readonly<{
  authSourcePath: string;
  environment: NodeJS.ProcessEnv;
  home: string;
  isolatedHomePath: string;
  paths: ReturnType<typeof recorderPaths>;
  root: string;
}>> {
  const root = await mkdtemp(path.join(tmpdir(), "aicharts-account-recorder-test-"));
  temporaryRoots.push(root);
  const home = path.join(root, "home");
  const xdgState = path.join(root, "state");
  const fakeCodex = path.join(root, "fake-codex");
  const authSourcePath = path.join(root, "auth-source");
  const isolatedHomePath = path.join(root, "isolated-home-path");
  await mkdir(path.join(home, ".codex"), { recursive: true });
  await writeFile(fakeCodex, `#!${process.execPath}
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
if (process.env.AICHARTS_ASSERT_AUTH_CONTEXT === "1") {
  const expectedArgs = ["-c", "cli_auth_credentials_store=\\\"file\\\"", "app-server", "--stdio"];
  const externalAuthKeys = [
    "CODEX_ACCESS_TOKEN",
    "CODEX_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_FEDERATION_RULE_ID",
    "OPENAI_IDENTITY_TOKEN_FILE",
    "OPENAI_WORKLOAD_IDENTITY_CONTEXT",
  ];
  const dotenvPath = path.join(process.env.CODEX_HOME, ".env");
  if (existsSync(dotenvPath)) {
    for (const rawLine of readFileSync(dotenvPath, "utf8").split(/\\r?\\n/u)) {
      const equals = rawLine.indexOf("=");
      if (equals <= 0) continue;
      const key = rawLine.slice(0, equals).trim();
      const value = rawLine.slice(equals + 1).trim();
      if (!key.toUpperCase().startsWith("CODEX_")) process.env[key] = value;
    }
  }
  const workloadSelected = process.env.OPENAI_FEDERATION_RULE_ID !== undefined
    || process.env.OPENAI_IDENTITY_TOKEN_FILE !== undefined;
  const authBytes = readFileSync(path.join(process.env.CODEX_HOME, "auth.json"));
  writeFileSync(
    process.env.AICHARTS_FAKE_AUTH_SOURCE_PATH,
    workloadSelected ? "workload" : createHash("sha256").update(authBytes).digest("hex"),
  );
  writeFileSync(process.env.AICHARTS_FAKE_ISOLATED_HOME_PATH, process.env.CODEX_HOME);
  if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expectedArgs)
    || process.env.CODEX_HOME === process.env.AICHARTS_EXPECTED_REAL_CODEX_HOME
    || existsSync(dotenvPath)
    || externalAuthKeys.some(key => process.env[key] !== undefined)) process.exit(70);
}
const lines = createInterface({ input: process.stdin });
lines.on("line", line => {
  const message = JSON.parse(line);
  if (message.id === 1) {
    process.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\\n");
  }
  if (message.id === 2) {
    process.stdout.write(JSON.stringify({ id: 2, result: { requirements: null } }) + "\\n");
  }
  if (message.id === 3) {
    const bucket = {
      limitId: "codex",
      limitName: null,
      primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 2_000_000_000 },
      secondary: null,
      credits: { hasCredits: false, unlimited: false, balance: "0" },
      individualLimit: null,
      planType: "pro",
      rateLimitReachedType: null,
      spendControlReached: null,
    };
    process.stdout.write(JSON.stringify({
      id: 3,
      result: {
        rateLimits: bucket,
        rateLimitsByLimitId: { codex: bucket },
        rateLimitResetCredits: { availableCount: 0, credits: [] },
      },
    }) + "\\n");
  }
});
`, { encoding: "utf8", mode: 0o500 });
  await chmod(fakeCodex, 0o500);
  const environment = {
    ...process.env,
    AICHARTS_CODEX_APP_SERVER_EXECUTABLE: fakeCodex,
    AICHARTS_FAKE_AUTH_SOURCE_PATH: authSourcePath,
    AICHARTS_FAKE_ISOLATED_HOME_PATH: isolatedHomePath,
    HOME: home,
    XDG_STATE_HOME: xdgState,
  };
  return {
    authSourcePath,
    environment,
    home,
    isolatedHomePath,
    paths: recorderPaths(environment),
    root,
  };
}

async function writeAuth(
  home: string,
  value: unknown,
  mode = 0o600,
): Promise<void> {
  await writeCodexHomeAuth(path.join(home, ".codex"), value, mode);
}

async function writeCodexHomeAuth(
  codexHome: string,
  value: unknown,
  mode = 0o600,
): Promise<void> {
  await mkdir(codexHome, { recursive: true });
  const authPath = path.join(codexHome, "auth.json");
  await writeFile(authPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode });
  await chmod(authPath, mode);
}

function run(environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [recorder], {
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
}

async function expectCapturedFileAuth(
  subject: Awaited<ReturnType<typeof fixture>>,
  codexHome: string,
): Promise<void> {
  const expectedDigest = createHash("sha256")
    .update(await readFile(path.join(codexHome, "auth.json")))
    .digest("hex");
  expect(await readFile(subject.authSourcePath, "utf8")).toBe(expectedDigest);
  const isolatedHome = await readFile(subject.isolatedHomePath, "utf8");
  expect(isolatedHome).not.toBe(codexHome);
  await expect(access(isolatedHome)).rejects.toThrow();
}

async function allFileContents(root: string): Promise<string> {
  const contents: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) contents.push(await readFile(target, "utf8"));
    }
  }
  await visit(root);
  return contents.join("\n");
}

describe("Codex account recorder", () => {
  test("isolates captured file auth from real CODEX_HOME workload identity", async () => {
    const subject = await fixture();
    const codexHome = path.join(subject.root, "explicit-codex-home");
    const identityTokenPath = path.join(codexHome, "identity-b-token");
    await writeAuth(subject.home, {
      auth_mode: "chatgpt",
      tokens: { account_id: "default-home-account-private" },
    });
    await writeCodexHomeAuth(codexHome, {
      auth_mode: "chatgpt",
      tokens: { account_id: "explicit-home-account-private" },
    });
    await writeFile(identityTokenPath, "identity-b-token", { mode: 0o600 });
    await writeFile(path.join(codexHome, ".env"), [
      "OPENAI_FEDERATION_RULE_ID=identity-b-federation",
      `OPENAI_IDENTITY_TOKEN_FILE=${identityTokenPath}`,
      "OPENAI_WORKLOAD_IDENTITY_CONTEXT=identity-b-context",
      "",
    ].join("\n"), { mode: 0o600 });
    const environment = {
      ...subject.environment,
      AICHARTS_ASSERT_AUTH_CONTEXT: "1",
      AICHARTS_EXPECTED_REAL_CODEX_HOME: codexHome,
      CODEX_ACCESS_TOKEN: "must-be-stripped",
      CODEX_API_KEY: "must-be-stripped",
      CODEX_HOME: codexHome,
      OPENAI_API_KEY: "must-be-stripped",
      OPENAI_FEDERATION_RULE_ID: "must-be-stripped",
      OPENAI_IDENTITY_TOKEN_FILE: "must-be-stripped",
      OPENAI_WORKLOAD_IDENTITY_CONTEXT: "must-be-stripped",
    };

    const first = run(environment);
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      changed: true,
      observedAccountFingerprintCount: 1,
      rateLimits: recordedRateLimits,
    });
    await expectCapturedFileAuth(subject, codexHome);

    await writeAuth(subject.home, {
      auth_mode: "chatgpt",
      tokens: { account_id: "changed-default-home-account-private" },
    });
    const unchanged = run(environment);
    expect(unchanged.status).toBe(0);
    expect(JSON.parse(unchanged.stdout)).toMatchObject({
      changed: false,
      observedAccountFingerprintCount: 1,
    });
    await expectCapturedFileAuth(subject, codexHome);

    await writeCodexHomeAuth(codexHome, {
      auth_mode: "chatgpt",
      tokens: { account_id: "changed-explicit-home-account-private" },
    });
    const changed = run(environment);
    expect(changed.status).toBe(0);
    expect(JSON.parse(changed.stdout)).toMatchObject({
      changed: true,
      observedAccountFingerprintCount: 2,
    });
    await expectCapturedFileAuth(subject, codexHome);
  });

  test("records distinct account intervals without printing or persisting auth data", async () => {
    const subject = await fixture();
    const firstAccount = "account-private-alpha-1234567890";
    const secondAccount = "account-private-beta-0987654321";
    const email = "private-person@example.test";
    const accessToken = "access-token-that-must-never-leak";
    await writeAuth(subject.home, {
      auth_mode: "chatgpt",
      email,
      tokens: {
        access_token: accessToken,
        account_id: firstAccount,
        id_token: "private-id-token",
        refresh_token: "private-refresh-token",
      },
    });

    const first = run(subject.environment);
    expect(first.status).toBe(0);
    const firstStatus = JSON.parse(first.stdout) as Record<string, unknown>;
    expect(firstStatus).toEqual({
      kind: "recorded",
      observedAt: expect.any(String),
      changed: true,
      observedAccountFingerprintCount: 1,
      authMode: "chatgpt",
      planStatus: "subscription-unverified",
      rateLimits: recordedRateLimits,
    });
    expect(first.stderr).toBe("");

    const refresh = run(subject.environment);
    expect(refresh.status).toBe(0);
    expect(JSON.parse(refresh.stdout)).toEqual({
      kind: "recorded",
      observedAt: expect.any(String),
      changed: false,
      observedAccountFingerprintCount: 1,
      authMode: "chatgpt",
      planStatus: "subscription-unverified",
      rateLimits: recordedRateLimits,
    });

    await writeAuth(subject.home, {
      auth_mode: "chatgpt",
      tokens: { account_id: secondAccount },
    });
    const switched = run(subject.environment);
    expect(switched.status).toBe(0);
    expect(JSON.parse(switched.stdout)).toEqual({
      kind: "recorded",
      observedAt: expect.any(String),
      changed: true,
      observedAccountFingerprintCount: 2,
      authMode: "chatgpt",
      planStatus: "subscription-unverified",
      rateLimits: recordedRateLimits,
    });

    const ledger = JSON.parse(await readFile(subject.paths.ledger, "utf8")) as {
      accounts: unknown[];
      intervals: unknown[];
    };
    expect(ledger.accounts).toHaveLength(2);
    expect(ledger.intervals).toHaveLength(2);
    const persisted = await allFileContents(subject.paths.stateRoot);
    for (const secretValue of [
      firstAccount,
      secondAccount,
      email,
      accessToken,
      "private-id-token",
      "private-refresh-token",
    ]) {
      expect(`${first.stdout}${refresh.stdout}${switched.stdout}${persisted}`)
        .not.toContain(secretValue);
    }
    expect((await stat(subject.paths.stateRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(subject.paths.secret)).mode & 0o777).toBe(0o600);
    expect((await stat(subject.paths.ledger)).mode & 0o777).toBe(0o600);
    expect((await stat(subject.paths.rateLimits)).mode & 0o777).toBe(0o600);
  });

  test("represents missing, invalid, and API-key auth without inventing an account", async () => {
    const subject = await fixture();
    const missing = run(subject.environment);
    expect(missing.status).toBe(0);
    expect(JSON.parse(missing.stdout)).toMatchObject({
      authMode: "missing",
      changed: true,
      observedAccountFingerprintCount: 0,
      planStatus: "unavailable",
    });

    await writeFile(path.join(subject.home, ".codex", "auth.json"), "{invalid", {
      encoding: "utf8",
      mode: 0o600,
    });
    const invalid = run(subject.environment);
    expect(invalid.status).toBe(0);
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      authMode: "invalid",
      changed: true,
      observedAccountFingerprintCount: 0,
      planStatus: "unavailable",
    });

    await writeAuth(subject.home, {
      OPENAI_API_KEY: "private-api-key",
      auth_mode: "api_key",
    });
    const apiKey = run(subject.environment);
    expect(apiKey.status).toBe(0);
    expect(JSON.parse(apiKey.stdout)).toMatchObject({
      authMode: "api-key",
      changed: true,
      observedAccountFingerprintCount: 0,
      planStatus: "not-applicable",
    });
    expect(await allFileContents(subject.paths.stateRoot)).not.toContain("private-api-key");
  });

  test("fails closed on broad auth permissions without leaking file contents", async () => {
    const subject = await fixture();
    const accountId = "permission-failure-account-private";
    await writeAuth(subject.home, {
      auth_mode: "chatgpt",
      tokens: { account_id: accountId, access_token: "permission-secret-token" },
    }, 0o644);
    const result = run(subject.environment);
    expect(result.status).toBe(65);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("permissions are too broad");
    expect(result.stderr).not.toContain(accountId);
    expect(result.stderr).not.toContain("permission-secret-token");
  });

  test("does not attribute a rate-limit snapshot across an account-switch race", async () => {
    const subject = await fixture();
    const firstAccount = "race-first-private-account";
    const secondAccount = "race-second-private-account";
    await writeAuth(subject.home, {
      auth_mode: "chatgpt",
      tokens: { account_id: firstAccount },
    });

    await expect(recordCodexAccount(
      subject.environment,
      new Date("2026-08-28T12:00:00.000Z"),
      async () => {
        await writeAuth(subject.home, {
          auth_mode: "chatgpt",
          tokens: { account_id: secondAccount },
        });
        return {
          observedAt: "2026-08-28T12:00:01.000Z",
          snapshot: {
            availableResetCreditCount: 0,
            buckets: [{
              limitId: "codex",
              planType: "pro",
              primary: { resetsAt: 2_000_000_000, usedPercent: 12, windowDurationMins: 300 },
              secondary: null,
            }],
          },
        };
      },
    )).rejects.toThrow("Codex account changed during the rate-limit observation.");
    await expect(access(subject.paths.rateLimits)).rejects.toThrow();
    const persisted = await allFileContents(subject.paths.stateRoot);
    expect(persisted).not.toContain(firstAccount);
    expect(persisted).not.toContain(secondAccount);
  });

  test("classifies a boundary crossed during the read using the response-time observation", async () => {
    const subject = await fixture();
    await writeAuth(subject.home, {
      auth_mode: "chatgpt",
      tokens: { account_id: "timing-boundary-private-account" },
    });
    const previousResetAt = Date.parse("2026-08-28T13:00:00.000Z") / 1_000;
    const snapshots = [
      {
        observedAt: "2026-08-28T12:59:51.000Z",
        snapshot: {
          availableResetCreditCount: 0,
          buckets: [{
            limitId: "codex",
            planType: "pro" as const,
            primary: { resetsAt: previousResetAt, usedPercent: 76, windowDurationMins: 300 },
            secondary: null,
          }],
        },
      },
      {
        observedAt: "2026-08-28T13:00:05.000Z",
        snapshot: {
          availableResetCreditCount: 0,
          buckets: [{
            limitId: "codex",
            planType: "pro" as const,
            primary: {
              resetsAt: previousResetAt + 300 * 60,
              usedPercent: 81,
              windowDurationMins: 300,
            },
            secondary: null,
          }],
        },
      },
    ];
    const reader = async () => snapshots.shift()!;

    await recordCodexAccount(
      subject.environment,
      new Date("2026-08-28T12:59:50.000Z"),
      reader,
    );
    const second = await recordCodexAccount(
      subject.environment,
      new Date("2026-08-28T12:59:59.000Z"),
      reader,
    );

    expect(second).toMatchObject({
      rateLimits: {
        detectedResets: [{
          classification: "scheduled",
          currentUsedPercent: 81,
          freshCapacityPercent: 100,
          previousUsedPercent: 76,
          restoredPercentLowerBound: 76,
          windowDurationMins: 300,
        }],
      },
    });
  });

  test("rejects corrupt or privacy-expanded ledgers instead of carrying unknown fields", async () => {
    const subject = await fixture();
    await writeAuth(subject.home, {
      auth_mode: "chatgpt",
      tokens: { account_id: "corrupt-ledger-private-account" },
    });
    expect(run(subject.environment).status).toBe(0);
    const ledger = JSON.parse(await readFile(subject.paths.ledger, "utf8")) as Record<string, unknown>;
    ledger.email = "should-never-be-retained@example.test";
    await writeFile(subject.paths.ledger, `${JSON.stringify(ledger)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    const result = run(subject.environment);
    expect(result.status).toBe(65);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Account observation ledger is invalid.\n");
    expect(result.stderr).not.toContain("should-never-be-retained@example.test");
  });

  test("fails closed when a ledger outlives its HMAC key", async () => {
    const subject = await fixture();
    await writeAuth(subject.home, {
      auth_mode: "chatgpt",
      tokens: { account_id: "missing-key-private-account" },
    });
    expect(run(subject.environment).status).toBe(0);
    await rm(subject.paths.secret);

    const result = run(subject.environment);
    expect(result.status).toBe(65);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Account HMAC secret is missing while observations exist.\n");
    await expect(access(subject.paths.secret)).rejects.toThrow();
  });

  test("fails closed when a valid replacement HMAC key does not match the ledger", async () => {
    const subject = await fixture();
    const replacement = await fixture();
    await writeAuth(subject.home, {
      auth_mode: "chatgpt",
      tokens: { account_id: "original-key-private-account" },
    });
    await writeAuth(replacement.home, {
      auth_mode: "chatgpt",
      tokens: { account_id: "replacement-key-private-account" },
    });
    expect(run(subject.environment).status).toBe(0);
    expect(run(replacement.environment).status).toBe(0);
    await writeFile(subject.paths.secret, await readFile(replacement.paths.secret), {
      mode: 0o600,
    });
    await chmod(subject.paths.secret, 0o600);

    const result = run(subject.environment);
    expect(result.status).toBe(65);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Account HMAC secret does not match the observation ledger.\n");
  });

  test("deduplicates concurrent recorder ownership", async () => {
    const subject = await fixture();
    await mkdir(subject.paths.stateRoot, { recursive: true, mode: 0o700 });
    const acquiredAt = new Date().toISOString();
    const release = await acquireRecorderLock(subject.paths.lock, acquiredAt);
    expect(release).not.toBeNull();
    const competing = await acquireRecorderLock(subject.paths.lock, acquiredAt);
    expect(competing).toBeNull();
    await release!();
    const reacquired = await acquireRecorderLock(subject.paths.lock, acquiredAt);
    expect(reacquired).not.toBeNull();
    await reacquired!();
  });

  test("keeps hourly samples and one missed run with jitter contiguous", async () => {
    const subject = await fixture();
    await writeAuth(subject.home, {
      auth_mode: "chatgpt",
      tokens: { account_id: "gap-aware-private-account" },
    });
    const first = await recordCodexAccount(
      subject.environment,
      new Date("2026-08-25T12:00:00.000Z"),
    );
    const contiguous = await recordCodexAccount(
      subject.environment,
      new Date("2026-08-25T13:00:00.000Z"),
    );
    const afterMissedRun = await recordCodexAccount(
      subject.environment,
      new Date("2026-08-25T15:30:00.000Z"),
    );
    const afterGap = await recordCodexAccount(
      subject.environment,
      new Date("2026-08-25T18:00:00.001Z"),
    );
    expect(first).toMatchObject({ changed: true, kind: "recorded" });
    expect(contiguous).toMatchObject({ changed: false, kind: "recorded" });
    expect(afterMissedRun).toMatchObject({ changed: false, kind: "recorded" });
    expect(afterGap).toMatchObject({ changed: false, kind: "recorded" });
    const ledger = JSON.parse(await readFile(subject.paths.ledger, "utf8")) as {
      intervals: Array<{
        accountFingerprint: string;
        authMode: string;
        lastObservedAt: string;
        planStatus: string;
        startedAt: string;
      }>;
    };
    expect(ledger.intervals).toEqual([
      {
        accountFingerprint: expect.any(String),
        authMode: "chatgpt",
        planStatus: "subscription-unverified",
        startedAt: "2026-08-25T12:00:00.000Z",
        lastObservedAt: "2026-08-25T15:30:00.000Z",
      },
      {
        accountFingerprint: expect.any(String),
        authMode: "chatgpt",
        planStatus: "subscription-unverified",
        startedAt: "2026-08-25T18:00:00.001Z",
        lastObservedAt: "2026-08-25T18:00:00.001Z",
      },
    ]);
  });

  test("splits same-account coverage across the five-hour overnight pause", async () => {
    const subject = await fixture();
    await writeAuth(subject.home, {
      auth_mode: "chatgpt",
      tokens: { account_id: "overnight-gap-private-account" },
    });
    await recordCodexAccount(
      subject.environment,
      new Date("2026-08-25T02:00:00.000Z"),
    );
    await recordCodexAccount(
      subject.environment,
      new Date("2026-08-25T07:00:00.000Z"),
    );
    const ledger = JSON.parse(await readFile(subject.paths.ledger, "utf8")) as {
      intervals: Array<{
        accountFingerprint: string;
        authMode: string;
        lastObservedAt: string;
        planStatus: string;
        startedAt: string;
      }>;
    };
    expect(ledger.intervals).toEqual([
      {
        accountFingerprint: expect.any(String),
        authMode: "chatgpt",
        planStatus: "subscription-unverified",
        startedAt: "2026-08-25T02:00:00.000Z",
        lastObservedAt: "2026-08-25T02:00:00.000Z",
      },
      {
        accountFingerprint: expect.any(String),
        authMode: "chatgpt",
        planStatus: "subscription-unverified",
        startedAt: "2026-08-25T07:00:00.000Z",
        lastObservedAt: "2026-08-25T07:00:00.000Z",
      },
    ]);
  });

  test("maps arbitrary parsed auth documents into a bounded nonidentifying result", () => {
    const secret = Buffer.alloc(32, 7);
    fc.assert(fc.property(fc.jsonValue(), value => {
      const observation = observeParsedAuth(value, secret);
      expect(Object.keys(observation).sort()).toEqual([
        "accountFingerprint",
        "authMode",
        "planStatus",
      ]);
      expect(["api-key", "chatgpt", "invalid", "unknown"])
        .toContain(observation.authMode);
      expect(["not-applicable", "subscription-unverified", "unavailable"])
        .toContain(observation.planStatus);
      expect(observation.accountFingerprint === null
        || /^hmac-sha256:v1:[A-Za-z0-9_-]{43}$/.test(observation.accountFingerprint))
        .toBe(true);
    }), { numRuns: 500 });
  });

  test("never returns a raw account identifier from a valid auth document", () => {
    const secret = Buffer.alloc(32, 11);
    fc.assert(fc.property(
      fc.string({ minLength: 20, maxLength: 200 }),
      fc.string({ minLength: 20, maxLength: 200 }),
      (accountId, token) => {
        const observation = observeParsedAuth({
          auth_mode: "chatgpt",
          tokens: { access_token: token, account_id: accountId },
        }, secret);
        const serialized = JSON.stringify(observation);
        expect(serialized).not.toContain(accountId);
        expect(serialized).not.toContain(token);
      },
    ), { numRuns: 500 });
  });
});

describe("Codex account recorder installer", () => {
  test("installs a runnable launcher and preserves private state on uninstall", async () => {
    const subject = await fixture();
    const binHome = path.join(subject.root, "bin-home");
    const environment = {
      ...subject.environment,
      XDG_BIN_HOME: binHome,
      XDG_DATA_HOME: path.join(subject.root, "data-home"),
    };
    const installer = path.join(import.meta.dir, "install-codex-account-recorder.sh");
    const installed = path.join(binHome, "aicharts-record-codex-account");
    const install = spawnSync("/bin/sh", [installer, "install"], {
      encoding: "utf8",
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    expect(install.status).toBe(0);
    expect(install.stderr).toBe("");
    await access(installed);

    await writeAuth(subject.home, {
      auth_mode: "chatgpt",
      tokens: { account_id: "installed-recorder-private-account" },
    });
    const recorded = spawnSync(installed, [], {
      encoding: "utf8",
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    expect(recorded.status).toBe(0);
    expect(JSON.parse(recorded.stdout)).toMatchObject({
      kind: "recorded",
      observedAccountFingerprintCount: 1,
    });
    await access(subject.paths.ledger);

    const uninstall = spawnSync("/bin/sh", [installer, "uninstall"], {
      encoding: "utf8",
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    expect(uninstall.status).toBe(0);
    await expect(access(installed)).rejects.toThrow();
    await access(subject.paths.ledger);
    expect(uninstall.stdout).toContain("Private account and rate-limit observations remain");
  });
});
