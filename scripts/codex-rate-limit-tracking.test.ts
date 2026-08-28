import { access, chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  type CodexRateLimitAuthContext,
  type CodexRateLimitReadResult,
  parseCodexRateLimitResponse,
  readCodexRateLimits,
  updateCodexRateLimitLedger,
} from "./codex-rate-limit-tracking";

const accountA = `hmac-sha256:v1:${"A".repeat(43)}`;
const accountB = `hmac-sha256:v1:${"B".repeat(43)}`;
const keyId = `sha256:v1:${"K".repeat(43)}`;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
    force: true,
    recursive: true,
  })));
});

function protocolBucket(options: Readonly<{
  limitId?: string | null;
  planType?: string;
}> = {}) {
  return {
    credits: null,
    individualLimit: null,
    limitId: options.limitId === undefined ? "codex" : options.limitId,
    limitName: null,
    planType: options.planType ?? "pro",
    primary: { resetsAt: 2_000_000_000, usedPercent: 34, windowDurationMins: 300 },
    rateLimitReachedType: null,
    secondary: null,
    spendControlReached: null,
  };
}

function readResult(options: Readonly<{
  availableResetCreditCount?: number | null;
  resetsAt: number;
  usedPercent: number;
  windowDurationMins?: number;
}>): CodexRateLimitReadResult {
  return {
    availableResetCreditCount: options.availableResetCreditCount ?? 0,
    buckets: [{
      limitId: "codex",
      planType: "pro",
      primary: {
        resetsAt: options.resetsAt,
        usedPercent: options.usedPercent,
        windowDurationMins: options.windowDurationMins ?? 300,
      },
      secondary: null,
    }],
  };
}

async function fakeAppServer(source: string): Promise<Readonly<{
  authContext: CodexRateLimitAuthContext;
  environment: NodeJS.ProcessEnv;
  isolatedHomePath: string;
  markerPath: string;
  pidPath: string;
}>> {
  const root = await mkdtemp(path.join(tmpdir(), "aicharts-rate-limit-reader-test-"));
  temporaryRoots.push(root);
  const executable = path.join(root, "fake-codex");
  const isolatedHomePath = path.join(root, "isolated-home-path");
  const markerPath = path.join(root, "rate-limit-requested");
  const pidPath = path.join(root, "pid");
  await writeFile(executable, `#!${process.execPath}\nimport { writeFileSync as writeAichartsMarker } from "node:fs";\nwriteAichartsMarker(process.env.AICHARTS_FAKE_ISOLATED_HOME_PATH, process.env.CODEX_HOME ?? "");\n${source}\n`, {
    encoding: "utf8",
    mode: 0o500,
  });
  await chmod(executable, 0o500);
  return {
    authContext: {
      authJsonBytes: Buffer.from(JSON.stringify({
        auth_mode: "chatgpt",
        tokens: { account_id: "reader-fixture-private-account" },
      })),
      temporaryParent: root,
    },
    environment: {
      ...process.env,
      AICHARTS_CODEX_APP_SERVER_EXECUTABLE: executable,
      AICHARTS_FAKE_ISOLATED_HOME_PATH: isolatedHomePath,
      AICHARTS_FAKE_MARKER_PATH: markerPath,
      AICHARTS_FAKE_PID_PATH: pidPath,
      HOME: root,
    },
    isolatedHomePath,
    markerPath,
    pidPath,
  };
}

async function expectRecordedProcessGone(pidPath: string): Promise<void> {
  const pid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
  expect(Number.isSafeInteger(pid)).toBe(true);
  expect(() => process.kill(pid, 0)).toThrow();
}

async function expectIsolatedHomeGone(isolatedHomePath: string): Promise<void> {
  const isolatedHome = await readFile(isolatedHomePath, "utf8");
  expect(path.isAbsolute(isolatedHome)).toBe(true);
  await expect(access(isolatedHome)).rejects.toThrow();
}

async function waitForPathRemoval(target: string, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(target);
    } catch {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await expect(access(target)).rejects.toThrow();
}

describe("Codex rate-limit response boundary", () => {
  test("retains only bounded quota fields and discards reset-credit identifiers and copy", () => {
    const opaqueCreditId = "opaque-credit-identifier-that-must-not-persist";
    const backendTitle = "backend-title-that-must-not-persist";
    const backendDescription = "backend-description-that-must-not-persist";
    const privateBalance = "private-credit-balance-that-must-not-persist";
    const bucket = {
      credits: { balance: privateBalance, hasCredits: true, unlimited: false },
      individualLimit: null,
      limitId: "codex",
      limitName: "Codex",
      planType: "pro",
      primary: { resetsAt: 2_000_000_000, usedPercent: 34, windowDurationMins: 300 },
      rateLimitReachedType: null,
      secondary: { resetsAt: 2_000_500_000, usedPercent: 67, windowDurationMins: 10_080 },
      spendControlReached: false,
    };
    const parsed = parseCodexRateLimitResponse({
      rateLimits: bucket,
      rateLimitsByLimitId: { codex: bucket },
      rateLimitResetCredits: {
        availableCount: 1,
        credits: [{
          description: backendDescription,
          expiresAt: 2_100_000_000,
          grantedAt: 2_000_000_000,
          id: opaqueCreditId,
          resetType: "codexRateLimits",
          status: "available",
          title: backendTitle,
        }],
      },
    });

    expect(parsed).toEqual({
      availableResetCreditCount: 1,
      buckets: [{
        limitId: "codex",
        planType: "pro",
        primary: { resetsAt: 2_000_000_000, usedPercent: 34, windowDurationMins: 300 },
        secondary: { resetsAt: 2_000_500_000, usedPercent: 67, windowDurationMins: 10_080 },
      }],
    });
    const serialized = JSON.stringify(parsed);
    for (const discarded of [
      opaqueCreditId,
      backendTitle,
      backendDescription,
      privateBalance,
    ]) expect(serialized).not.toContain(discarded);
  });

  test("rejects unknown fields and invalid percentages", () => {
    expect(() => parseCodexRateLimitResponse({
      accountEmail: "must-not-cross-boundary@example.test",
      rateLimits: {},
    })).toThrow("privacy/shape check");
    expect(() => parseCodexRateLimitResponse({
      rateLimits: {
        limitId: "codex",
        planType: "pro",
        primary: { resetsAt: 2_000_000_000, usedPercent: 101, windowDurationMins: 300 },
        secondary: null,
      },
    })).toThrow("privacy/shape check");
  });

  test("accepts every current official plan value without retaining spend control", () => {
    for (const planType of [
      "self_serve_business_prolite",
      "ent26",
      "enterprise_cbp_automation",
      "edu_plus",
      "edu_pro",
    ] as const) {
      const parsed = parseCodexRateLimitResponse({
        rateLimits: protocolBucket({ planType }),
        rateLimitsByLimitId: null,
      });
      expect(parsed.buckets[0]!.planType).toBe(planType);
      expect(JSON.stringify(parsed)).not.toContain("spendControlReached");
    }
  });

  test("assigns a stable internal ID to a nullable legacy single bucket", () => {
    for (const limitId of [null, undefined]) {
      const bucket = protocolBucket({ limitId });
      if (limitId === undefined) delete (bucket as { limitId?: string | null }).limitId;
      expect(parseCodexRateLimitResponse({ rateLimits: bucket })).toEqual({
        availableResetCreditCount: null,
        buckets: [expect.objectContaining({ limitId: "codex" })],
      });
    }
  });

  test("sorts mixed-case and punctuation IDs by explicit code-unit order", () => {
    const rateLimitsByLimitId = Object.fromEntries(["a", "_", "Z", "A"].map(limitId => [
      limitId,
      protocolBucket({ limitId: null }),
    ]));
    const parsed = parseCodexRateLimitResponse({
      rateLimits: protocolBucket({ limitId: null }),
      rateLimitsByLimitId,
    });
    expect(parsed.buckets.map(bucket => bucket.limitId)).toEqual(["A", "Z", "_", "a"]);
  });
});

describe("Codex rate-limit app-server lifecycle", () => {
  test("removes the isolated auth home after a successful read", async () => {
    const subject = await fakeAppServer(`
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
writeFileSync(process.env.AICHARTS_FAKE_PID_PATH, String(process.pid));
createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.id === 1) process.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\\n");
  if (message.id === 2) process.stdout.write(JSON.stringify({ id: 2, result: { requirements: null } }) + "\\n");
  if (message.id === 3) {
    const bucket = {
      credits: null,
      individualLimit: null,
      limitId: "codex",
      limitName: null,
      planType: "pro",
      primary: { resetsAt: 2_000_000_000, usedPercent: 34, windowDurationMins: 300 },
      rateLimitReachedType: null,
      secondary: null,
      spendControlReached: null,
    };
    process.stdout.write(JSON.stringify({
      id: 3,
      result: { rateLimits: bucket, rateLimitsByLimitId: { codex: bucket } },
    }) + "\\n");
  }
});
`);

    await expect(readCodexRateLimits(subject.environment, subject.authContext, {
      killGraceMs: 500,
      terminationGraceMs: 100,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({
      snapshot: {
        availableResetCreditCount: null,
        buckets: [expect.objectContaining({ limitId: "codex" })],
      },
    });
    await expectRecordedProcessGone(subject.pidPath);
    await expectIsolatedHomeGone(subject.isolatedHomePath);
  });

  test("fails closed before quota read when managed requirements override file auth", async () => {
    const subject = await fakeAppServer(`
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
writeFileSync(process.env.AICHARTS_FAKE_PID_PATH, String(process.pid));
createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.id === 1) process.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\\n");
  if (message.id === 2) process.stdout.write(JSON.stringify({
    id: 2,
    result: { requirements: { cliAuthCredentialsStore: "keyring" } },
  }) + "\\n");
  if (message.id === 3) writeFileSync(process.env.AICHARTS_FAKE_MARKER_PATH, "requested");
});
`);

    await expect(readCodexRateLimits(subject.environment, subject.authContext, {
      killGraceMs: 500,
      terminationGraceMs: 100,
      timeoutMs: 1_000,
    })).rejects.toThrow("could not be attested as file-backed");
    await expect(access(subject.markerPath)).rejects.toThrow();
    await expectRecordedProcessGone(subject.pidPath);
    await expectIsolatedHomeGone(subject.isolatedHomePath);
  });

  test("reaps a reader that emits malformed output and ignores SIGTERM", async () => {
    const subject = await fakeAppServer(`
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
writeFileSync(process.env.AICHARTS_FAKE_PID_PATH, String(process.pid));
process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.id === 1) process.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\\n");
  if (message.id === 2) process.stdout.write(JSON.stringify({ id: 2, result: { requirements: null } }) + "\\n");
  if (message.id === 3) process.stdout.write("{malformed\\n");
});
`);

    await expect(readCodexRateLimits(subject.environment, subject.authContext, {
      killGraceMs: 500,
      terminationGraceMs: 25,
      timeoutMs: 1_000,
    })).rejects.toThrow("privacy/shape check");
    await expectRecordedProcessGone(subject.pidPath);
    await expectIsolatedHomeGone(subject.isolatedHomePath);
  });

  test("handles a closed stdin pipe and reaps the resistant reader", async () => {
    const subject = await fakeAppServer(`
import { closeSync, writeFileSync } from "node:fs";
writeFileSync(process.env.AICHARTS_FAKE_PID_PATH, String(process.pid));
process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
process.stdin.on("error", () => {});
process.stdin.once("data", () => {
  closeSync(0);
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\\n");
  }, 50);
});
`);

    await expect(readCodexRateLimits(subject.environment, subject.authContext, {
      killGraceMs: 500,
      terminationGraceMs: 25,
      timeoutMs: 1_000,
    })).rejects.toThrow("exited early");
    await expectRecordedProcessGone(subject.pidPath);
    await expectIsolatedHomeGone(subject.isolatedHomePath);
  });

  test("SIGKILLs and reaps a wedged reader after the bounded timeout", async () => {
    const subject = await fakeAppServer(`
import { writeFileSync } from "node:fs";
writeFileSync(process.env.AICHARTS_FAKE_PID_PATH, String(process.pid));
process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
process.stdin.resume();
`);

    await expect(readCodexRateLimits(subject.environment, subject.authContext, {
      killGraceMs: 500,
      terminationGraceMs: 25,
      timeoutMs: 500,
    })).rejects.toThrow("timed out");
    await expectRecordedProcessGone(subject.pidPath);
    await expectIsolatedHomeGone(subject.isolatedHomePath);
  });

  test("retains isolated auth until an unreaped reader later closes", async () => {
    const subject = await fakeAppServer(`
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
writeFileSync(process.env.AICHARTS_FAKE_PID_PATH, String(process.pid));
setInterval(() => {}, 1_000);
createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.id === 1) process.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\\n");
  if (message.id === 2) process.stdout.write(JSON.stringify({ id: 2, result: { requirements: null } }) + "\\n");
  if (message.id === 3) {
    const bucket = {
      credits: null,
      individualLimit: null,
      limitId: "codex",
      limitName: null,
      planType: "pro",
      primary: { resetsAt: 2_000_000_000, usedPercent: 34, windowDurationMins: 300 },
      rateLimitReachedType: null,
      secondary: null,
      spendControlReached: null,
    };
    process.stdout.write(JSON.stringify({
      id: 3,
      result: { rateLimits: bucket, rateLimitsByLimitId: { codex: bucket } },
    }) + "\\n");
  }
});
`);
    let childPid: number | undefined;
    let isolatedHome: string | undefined;

    try {
      await expect(readCodexRateLimits(subject.environment, subject.authContext, {
        killGraceMs: 25,
        reapChild: child => {
          childPid = child.pid;
          return Promise.resolve(false);
        },
        terminationGraceMs: 25,
        timeoutMs: 1_000,
      })).rejects.toThrow("could not terminate its app-server process");

      isolatedHome = await readFile(subject.isolatedHomePath, "utf8");
      expect(path.isAbsolute(isolatedHome)).toBe(true);
      expect((await stat(isolatedHome)).mode & 0o777).toBe(0o700);
      await expect(access(isolatedHome)).resolves.toBeUndefined();
      if (childPid === undefined) throw new Error("Reader PID was not captured.");
      expect(() => process.kill(childPid, 0)).not.toThrow();
    } finally {
      if (childPid !== undefined) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          // A concurrent close is sufficient for the deferred cleanup assertion.
        }
      }
    }

    if (isolatedHome === undefined) throw new Error("Isolated auth home was not captured.");
    await waitForPathRemoval(isolatedHome);
    await expectRecordedProcessGone(subject.pidPath);
  });
});

describe("Codex rate-limit reset detection", () => {
  test("detects a scheduled boundary even when usage resumes before the next sample", () => {
    const previousResetAt = Date.parse("2026-08-28T13:00:00.000Z") / 1_000;
    const first = updateCodexRateLimitLedger(
      null,
      readResult({ resetsAt: previousResetAt, usedPercent: 76 }),
      accountA,
      keyId,
      "2026-08-28T12:00:00.000Z",
    );
    const second = updateCodexRateLimitLedger(
      first.ledger,
      readResult({ resetsAt: previousResetAt + 300 * 60, usedPercent: 81 }),
      accountA,
      keyId,
      "2026-08-28T13:30:00.000Z",
    );

    expect(second.detectedResets).toEqual([expect.objectContaining({
      classification: "scheduled",
      currentUsedPercent: 81,
      freshCapacityPercent: 100,
      previousUsedPercent: 76,
      restoredPercentLowerBound: 76,
      windowDurationMins: 300,
    })]);
  });

  test("correlates an early boundary with a reset-credit inventory decrease", () => {
    const previousResetAt = Date.parse("2026-08-28T18:00:00.000Z") / 1_000;
    const first = updateCodexRateLimitLedger(
      null,
      readResult({
        availableResetCreditCount: 1,
        resetsAt: previousResetAt,
        usedPercent: 98,
      }),
      accountA,
      keyId,
      "2026-08-28T12:00:00.000Z",
    );
    const second = updateCodexRateLimitLedger(
      first.ledger,
      readResult({
        availableResetCreditCount: 0,
        resetsAt: previousResetAt + 300 * 60,
        usedPercent: 3,
      }),
      accountA,
      keyId,
      "2026-08-28T13:00:00.000Z",
    );

    expect(second.detectedResets).toEqual([expect.objectContaining({
      availableResetCreditCountAfter: 0,
      availableResetCreditCountBefore: 1,
      classification: "reset-credit-correlated",
      restoredPercentLowerBound: 98,
    })]);
  });

  test("does not mistake an account switch for a reset", () => {
    const first = updateCodexRateLimitLedger(
      null,
      readResult({ resetsAt: 2_000_000_000, usedPercent: 94 }),
      accountA,
      keyId,
      "2026-08-28T12:00:00.000Z",
    );
    const switched = updateCodexRateLimitLedger(
      first.ledger,
      readResult({ resetsAt: 2_000_018_000, usedPercent: 2 }),
      accountB,
      keyId,
      "2026-08-28T13:00:00.000Z",
    );

    expect(switched.detectedResets).toEqual([]);
  });

  test("requires evidence for an early provider reset", () => {
    const first = updateCodexRateLimitLedger(
      null,
      readResult({ resetsAt: 2_000_000_000, usedPercent: 40 }),
      accountA,
      keyId,
      "2026-08-28T12:00:00.000Z",
    );
    const unsupported = updateCodexRateLimitLedger(
      first.ledger,
      readResult({ resetsAt: 2_000_018_000, usedPercent: 41 }),
      accountA,
      keyId,
      "2026-08-28T13:00:00.000Z",
    );
    const supported = updateCodexRateLimitLedger(
      first.ledger,
      readResult({ resetsAt: 2_000_018_000, usedPercent: 4 }),
      accountA,
      keyId,
      "2026-08-28T13:00:00.000Z",
    );

    expect(unsupported.detectedResets).toEqual([]);
    expect(supported.detectedResets).toEqual([expect.objectContaining({
      classification: "provider-unscheduled",
      restoredPercentLowerBound: 40,
    })]);
  });

  test("classifies every observed post-deadline boundary as scheduled", () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 100 }),
      (previousUsedPercent, currentUsedPercent) => {
        const first = updateCodexRateLimitLedger(
          null,
          readResult({ resetsAt: 2_000_000_000, usedPercent: previousUsedPercent }),
          accountA,
          keyId,
          new Date(1_999_996_400 * 1_000).toISOString(),
        );
        const second = updateCodexRateLimitLedger(
          first.ledger,
          readResult({ resetsAt: 2_000_018_000, usedPercent: currentUsedPercent }),
          accountA,
          keyId,
          new Date(2_000_000_001 * 1_000).toISOString(),
        );
        expect(second.detectedResets).toHaveLength(1);
        expect(second.detectedResets[0]!.classification).toBe("scheduled");
        expect(second.detectedResets[0]!.restoredPercentLowerBound)
          .toBe(previousUsedPercent);
      },
    ), { numRuns: 200 });
  });
});
