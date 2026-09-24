import { expect, test } from "bun:test";
import { STATS_MAX_DAY } from "./stats-contract";
import { decodeStatsHttpResponse, encodeStatsHttpResponse, parseStatsQuery, parseStatsRange, parseStatsUpload } from "./stats-http-contract";
import { parseStatsAbandonRequest, parseStatsAbandonment, parseStatsStatus } from "./stats-http-contract";

const report = { schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1, firstUtcDay: 20_000, dayCount: 1,
  generatedAtMs: 1_800_000_000_000, revision: 0, updatedAtMs: null,
  sources: [{ client: "cursor", status: "empty", tokenBasis: "unavailable", records: 0, warnings: 0, latestAtMs: null }], rows: [] };
const upload = { schemaVersion: 2, operationId: "11".repeat(32), accountId: `acct_${"22".repeat(16)}`, deviceId: "33".repeat(32),
  generation: "44".repeat(32), sequence: 1, expectedRevision: 0, mode: "replace-window", takeover: null, report };

test("takeover status accepts every retained admission count and refuses one beyond the shared bound", () => {
  const status = { schemaVersion: 2, revision: 0, nextSequence: 1, writerDeviceId: null,
    v1Revision: 4_096, headDigest: "00".repeat(32), legacyRecords: 100_001, takeoverEligible: false };
  for (const legacyRecords of [100_001, 1_000_000]) expect(parseStatsStatus({ ...status, legacyRecords })?.legacyRecords).toBe(legacyRecords);
  expect(parseStatsStatus({ ...status, legacyRecords: 1_000_001 })).toBeNull();
});
test("abandonment proofs require the complete exact predecessor and a strictly later bounded fence", () => {
  const input = { schemaVersion: 2, operationId: upload.operationId, accountId: upload.accountId, deviceId: upload.deviceId,
    generation: upload.generation, sequence: 1, expectedRevision: 0, bodyHash: "55".repeat(32) };
  expect(parseStatsAbandonRequest(input)).not.toBeNull();
  expect(parseStatsAbandonRequest({ ...input, report })).toBeNull();
  const proof = { schemaVersion: 2, outcome: "abandoned", operationId: input.operationId, bodyHash: input.bodyHash,
    sequence: 1, expectedRevision: 0, fencedAtRevision: 1 };
  expect(parseStatsAbandonment(proof)).not.toBeNull();
  for (const values of [{ fencedAtRevision: 0 }, { fencedAtRevision: 1_000_001 }, { bodyHash: "PRIVATE" }, { receipt: {} }, { sequence: 0 }]) expect(parseStatsAbandonment({ ...proof, ...values })).toBeNull();
});

test("snapshot admission distinguishes complete empty from missing or failed sources", () => {
  expect(parseStatsUpload(upload)).not.toBeNull();
  expect(parseStatsUpload({ ...upload, report: { ...report, sources: [{ ...report.sources[0], client: "9router" }] } })).toBeNull();
  for (const status of ["not_found", "incomplete", "unavailable"]) expect(parseStatsUpload({ ...upload,
    report: { ...report, sources: [{ ...report.sources[0], status }] } })).toBeNull();
  expect(parseStatsUpload({ ...upload, report: { ...report, sources: [{ ...report.sources[0], warnings: 1 }] } })).toBeNull();
  expect(parseStatsUpload({ ...upload, report: { ...report, sources: [] } })).toBeNull();
});
test("snapshot envelope requires exact identities, sequence and explicit takeover syntax", () => {
  for (const fields of [{ deviceId: "00".repeat(32) }, { sequence: 0 }, { expectedRevision: -0 }, { accountId: "foreign" },
    { takeover: { expectedV1Revision: 0, headDigest: "bad" } }, { uploadSecret: "PRIVATE_CANARY" }, { mode: undefined }, { mode: "replace" }]) {
    expect(parseStatsUpload({ ...upload, ...fields })).toBeNull();
  }
  expect(parseStatsUpload({ ...upload, takeover: { expectedV1Revision: 0, headDigest: "00".repeat(32) } })).not.toBeNull();
  expect(parseStatsUpload({ ...upload, mode: "preserve-history" })).not.toBeNull();
});
test("Warp requires one current unavailable-token snapshot and no other client may use its mode", async () => {
  const example = JSON.parse(await Bun.file(new URL("../../fixtures/usage/stats-upload-v2.json", import.meta.url)).text());
  expect(parseStatsUpload({ ...example, mode: "replace-snapshot" })).toBeNull();
  const source = { ...example.report.sources[0], client: "warp", tokenBasis: "unavailable" };
  const row = { ...example.report.rows[0], client: "warp", tokenBasis: "unavailable", timedTokens: "0", tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } };
  const snapshot = { ...example, mode: "replace-snapshot", report: { ...example.report, dayCount: 1, sources: [source], rows: [row] } };
  expect(parseStatsUpload(snapshot)).not.toBeNull();
  expect(parseStatsUpload({ ...snapshot, mode: "preserve-history" })).toBeNull();
  expect(parseStatsUpload({ ...snapshot, mode: "replace-window" })).toBeNull();
  expect(parseStatsUpload({ ...snapshot, report: { ...snapshot.report, dayCount: 2 } })).toBeNull();
  expect(parseStatsUpload({ ...snapshot, report: { ...snapshot.report, sources: [{ ...source, latestAtMs: 1 }] } })).toBeNull();
});
test("private stats correlates the exact range and never emits asserted account identifiers", () => {
  const query = parseStatsQuery({ schemaVersion: 2, accountId: upload.accountId, sessionExpiresAtMs: report.generatedAtMs + 1,
    firstUtcDay: report.firstUtcDay, dayCount: 1 });
  const bytes = encodeStatsHttpResponse(query, { ok: true, value: report }); expect(bytes).not.toBeNull();
  expect(new TextDecoder().decode(bytes!)).not.toContain(upload.accountId);
  expect(decodeStatsHttpResponse(bytes, query)).toMatchObject({ ok: true });
  expect(decodeStatsHttpResponse(bytes, { ...query, dayCount: 2 })).toBeNull();
  expect(parseStatsRange({ firstUtcDay: STATS_MAX_DAY, dayCount: 1 })).not.toBeNull();
  expect(parseStatsRange({ firstUtcDay: STATS_MAX_DAY, dayCount: 2 })).toBeNull();
});

test("native upload fixture canonical bytes and receipt body hash match the shared parser", async () => {
  for (const name of ["stats-upload-v2", "stats-upload-v2-takeover"]) {
    const text = (await Bun.file(new URL(`../../fixtures/usage/${name}.json`, import.meta.url)).text()).trim();
    const expected = (await Bun.file(new URL(`../../fixtures/usage/${name}.sha256`, import.meta.url)).text()).trim();
    expect(JSON.stringify(parseStatsUpload(JSON.parse(text)))).toBe(text);
    expect(new Bun.CryptoHasher("sha256").update(text).digest("hex")).toBe(expected);
  }
});
