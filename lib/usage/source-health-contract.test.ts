import { expect, test } from "bun:test";
import { parseImportHealth, parseSourceHealthSummary, SOURCE_HEALTH_BYTES, SOURCE_HEALTH_METRICS } from "./source-health-contract";
import { parseStatsUpload } from "./stats-http-contract";

const fixture = async (name: string) => (await Bun.file(new URL(`../../fixtures/usage/${name}`, import.meta.url)).text()).trim();
const summary = JSON.parse(await fixture("source-health-v1.json")) as Record<string, unknown> & { metrics: Record<string, unknown>; lastAttempt: Record<string, unknown> };
const upload = JSON.parse(await fixture("stats-upload-v2.json")) as Record<string, unknown>;

test("the shared source-health fixture round-trips byte for byte with the native emitter", async () => {
  const text = await fixture("source-health-v1.json");
  expect(JSON.stringify(parseSourceHealthSummary(JSON.parse(text)))).toBe(text);
  expect(new Bun.CryptoHasher("sha256").update(text).digest("hex")).toBe(await fixture("source-health-v1.sha256"));
  expect(SOURCE_HEALTH_METRICS).toHaveLength(30);
  expect([...SOURCE_HEALTH_METRICS].sort()).toEqual([...SOURCE_HEALTH_METRICS]);
  expect(Object.keys(summary.metrics)).toEqual([...SOURCE_HEALTH_METRICS]);
});
test("metrics carry exact integers, explicit nulls and bounded status text only", () => {
  expect(parseSourceHealthSummary(summary, "codex")).not.toBeNull();
  expect(parseSourceHealthSummary(summary, "claude")).toBeNull();
  const withMetric = (id: string, value: unknown) => parseSourceHealthSummary({ ...summary, metrics: { ...summary.metrics, [id]: value } });
  expect(withMetric("scan-bytes", 1.5)).toBeNull();
  expect(withMetric("scan-bytes", -1)).toBeNull();
  expect(withMetric("scan-bytes", "40000")).toBeNull();
  expect(withMetric("scan-bytes", 2 ** 53)).toBeNull();
  expect(withMetric("scan-bytes", null)).not.toBeNull();
  expect(withMetric("data-through-watermark", -1)).not.toBeNull();
  expect(withMetric("collector-version-status", "")).toBeNull();
  expect(withMetric("collector-version-status", "/Users/private\n")).toBeNull();
  expect(withMetric("collector-version-status", "x".repeat(129))).toBeNull();
  expect(withMetric("no-change-work", { files: 1, parsedBytes: 1, reusedFiles: 0, verifiedBytes: 0, path: "/private" })).toBeNull();
  expect(withMetric("no-change-work", { files: null, parsedBytes: null, reusedFiles: 0, verifiedBytes: 0 })).not.toBeNull();
  expect(withMetric("pricing-record-coverage", { denominator: 0, numerator: 0 })).toBeNull();
  expect(withMetric("pricing-record-coverage", { denominator: 4, numerator: 3 })).not.toBeNull();
  expect(withMetric("pricing-record-coverage", 0.75)).toBeNull();
  const fewer = Object.fromEntries(Object.entries(summary.metrics).filter(([id]) => id !== "scan-bytes"));
  expect(parseSourceHealthSummary({ ...summary, metrics: fewer })).toBeNull();
  expect(parseSourceHealthSummary({ ...summary, metrics: { ...summary.metrics, "private-path": "/Users/x" } })).toBeNull();
  expect(parseSourceHealthSummary({ ...summary, profile: "source-health-v2" })).toBeNull();
  expect(parseSourceHealthSummary({ ...summary, client: "9router" })).not.toBeNull();
  expect(parseSourceHealthSummary({ ...summary, client: "unknown" })).toBeNull();
  expect(parseSourceHealthSummary({ ...summary, secret: 1 })).toBeNull();
  const padded = { ...summary, metrics: { ...summary.metrics, "collector-version-status": "y".repeat(128) } };
  expect(parseSourceHealthSummary(padded)).not.toBeNull();
  expect(JSON.stringify(summary).length).toBeLessThanOrEqual(SOURCE_HEALTH_BYTES);
});
test("a failed attempt stays observable beside retained good evidence and never replaces it", () => {
  const good = summary.lastAttempt.health as Record<string, unknown>;
  const failed = { ...good, outcome: "failed", files: null, logicalBytes: null, parsedBytes: null, verifiedBytes: 0, reusedFiles: 0, records: null,
    deferredTailFiles: null, schemaMismatchRecords: null, clampedRecords: null, fallbackRecords: null, estimatedRecords: null,
    eventMinMs: null, eventMaxMs: null, codes: ["source_failed", "schema_coverage_limited"] };
  expect(parseImportHealth(failed)).not.toBeNull();
  const attempt = { startedAtMs: 1_789_862_305_000, completedAtMs: 1_789_862_305_100, health: failed };
  const parsed = parseSourceHealthSummary({ ...summary, lastAttempt: attempt });
  expect(parsed?.lastAttempt?.health.outcome).toBe("failed");
  expect(parsed?.lastGood?.health.outcome).toBe("complete");
  expect(parseSourceHealthSummary({ ...summary, lastGood: attempt })).toBeNull();
  expect(parseSourceHealthSummary({ ...summary, lastAttempt: null, lastGood: null, lastPublication: null })).not.toBeNull();
  expect(parseSourceHealthSummary({ ...summary, lastPublication: { ...(summary.lastPublication as object), outcome: "lost" } })).toBeNull();
  expect(parseSourceHealthSummary({ ...summary, lastAttempt: { ...attempt, completedAtMs: attempt.startedAtMs - 1 } })).toBeNull();
});
test("import health mirrors the native invariants: codes match counters and missingness is explicit", () => {
  const health = summary.lastAttempt.health as Record<string, unknown>;
  expect(parseImportHealth(health)).not.toBeNull();
  for (const fields of [{ clampedRecords: 0 }, { codes: ["clamped", "estimated", "fallback"] }, { schemaMismatchRecords: null },
    { deferredTailFiles: 1 }, { outcome: "partial" }, { files: 1 }, { estimatedRecords: 121 }, { eventMinMs: null }, { records: 0 },
    { parserGeneration: "aicharts-x" }, { qualificationId: "other" }, { codes: ["clamped", "clamped", "estimated"] }, { verifiedBytes: -0 },
    { path: "/Users/private" }]) {
    expect(parseImportHealth({ ...health, ...fields })).toBeNull();
  }
  expect(parseImportHealth({ ...health, schemaMismatchRecords: null, codes: ["clamped", "estimated", "schema_coverage_limited"] })).not.toBeNull();
});
test("uploads carry an optional health summary bound to the published client", () => {
  const source = (upload.report as { sources: { client: string }[] }).sources[0].client;
  expect(parseStatsUpload(upload)).not.toBeNull();
  expect(JSON.stringify(parseStatsUpload(upload))).not.toContain("health");
  const bound = { ...summary, client: source };
  const parsed = parseStatsUpload({ ...upload, health: bound });
  expect(parsed?.health?.client).toBe(source);
  expect(JSON.stringify(parsed)).toBe(`${JSON.stringify(upload).slice(0, -1)},"health":${JSON.stringify(bound)}}`);
  expect(parseStatsUpload({ ...upload, health: null })).toBeNull();
  expect(parseStatsUpload({ ...upload, health: { ...bound, client: source === "codex" ? "claude" : "codex" } })).toBeNull();
  expect(parseStatsUpload({ ...upload, health: { ...bound, metrics: { ...bound.metrics, "scan-bytes": 0.5 } } })).toBeNull();
});
