import { expect, test } from "bun:test";
import costs from "../../costs.json";
import {
  decodeUsageLifecycleHttpRequest, decodeUsageLifecycleHttpResponse, encodeUsageLifecycleHttpRequest, encodeUsageLifecycleHttpResponse,
  LIFECYCLE_ERASE_STEPS, LIFECYCLE_EXPORT_CONTRACT, LIFECYCLE_EXPORT_EXCLUDED, LIFECYCLE_EXPORT_SECTIONS, LIFECYCLE_RECLAMATION_CONTRACT,
  LIFECYCLE_STATUS_CONTRACT, lifecycleReplyMatches, parseLifecycleExportPage, parseLifecycleStatus, parseReclamationLedger,
  parseUsageLifecycleOperation, parseUsageLifecycleRequest, parseUsageLifecycleResult, USAGE_LIFECYCLE_OPERATIONS,
  USAGE_LIFECYCLE_REQUEST_BYTES, USAGE_LIFECYCLE_RESPONSE_BYTES, type LifecycleExportPageV1, type LifecycleStatusV1,
} from "./lifecycle-contract";

const accountId = `acct_${"a".repeat(32)}`, generation = "b".repeat(64), device = "c".repeat(64), other = "d".repeat(64), token = "e".repeat(64);
const session = { schemaVersion: 1 as const, accountId, sessionExpiresAtMs: 1_800_000_000_000 };
const status: LifecycleStatusV1 = { schemaVersion: 1, kind: "status", contract: LIFECYCLE_STATUS_CONTRACT, accountId, generation, phase: "active",
  stateRevision: 3, devices: { active: 1, revoked: 1 }, erasure: null, transfers: [], publishing: { consent: false, publicHandle: null, member: null, waitlist: null, waitlistKnown: false } };
const page: LifecycleExportPageV1 = { schemaVersion: 1, kind: "export", contract: LIFECYCLE_EXPORT_CONTRACT, accountId, generation, exportedAtMs: 1_800_000_000_000,
  stateRevision: 3, admissionRevision: 2, section: "usage_admission_heads", items: [{ surface: "usage_admission_heads", key: "0", value: { occurrence_id: { bytesHex: "00" }, n: 1 } }],
  cursor: "usage_admission_heads:64", excluded: [{ surface: "worker:pairing_state", reason: "not account-owned" }] };

test("every operation parses exactly once, with no extra or missing fields", () => {
  const operations: Record<string, unknown>[] = [{ operation: "status" }, { operation: "export", cursor: null }, { operation: "export", cursor: "usage_stats_days:128" },
    { operation: "devices" }, { operation: "revoke_device", deviceId: device }, { operation: "erase_request" }, { operation: "erase_confirm", token },
    { operation: "transfer_request", client: "codex", fromDeviceId: device, toDeviceId: other }, { operation: "transfer_grant", transferId: token },
    { operation: "transfer_complete", transferId: token }];
  const seen = new Set<string>();
  for (const operation of operations) {
    const parsed: unknown = parseUsageLifecycleOperation(operation);
    expect(parsed).toEqual(operation);
    seen.add((parsed as { operation: string }).operation);
    const request = parseUsageLifecycleRequest({ ...session, ...operation });
    expect(request as unknown).toEqual({ ...session, ...operation });
    expect(parseUsageLifecycleRequest({ ...session, ...operation, extra: 1 })).toBeNull();
    expect(parseUsageLifecycleRequest({ ...operation, schemaVersion: 1, accountId })).toBeNull();
    const bytes = encodeUsageLifecycleHttpRequest(request)!;
    expect(bytes.byteLength).toBeLessThanOrEqual(USAGE_LIFECYCLE_REQUEST_BYTES);
    expect(decodeUsageLifecycleHttpRequest(bytes)).toEqual(request);
  }
  expect([...seen].sort()).toEqual([...USAGE_LIFECYCLE_OPERATIONS].sort());
  for (const bad of [{ operation: "export" }, { operation: "export", cursor: "" }, { operation: "export", cursor: "x".repeat(97) }, { operation: "export", cursor: "a b" },
    { operation: "revoke_device", deviceId: device.toUpperCase() }, { operation: "erase_confirm", token: token.slice(1) },
    { operation: "transfer_request", client: "other", fromDeviceId: device, toDeviceId: other },
    { operation: "transfer_request", client: "codex", fromDeviceId: device, toDeviceId: device }, { operation: "unknown" },
    { operation: "status", get cursor() { return null; } }, Object.create({ operation: "status" }), null, "status", []]) expect(parseUsageLifecycleOperation(bad)).toBeNull();
  expect(decodeUsageLifecycleHttpRequest(new TextEncoder().encode(JSON.stringify({ ...session, operation: "status" }) + " "))).toBeNull();
});

test("replies are exact, kind-bound and byte-bounded on both sides of the wire", () => {
  expect(parseLifecycleStatus(status)).toEqual(status);
  expect(parseLifecycleExportPage(page)).toEqual(page);
  const results: unknown[] = [{ ok: true, value: status }, { ok: true, value: page }, { ok: false, error: "account_erased" },
    { ok: true, value: { schemaVersion: 1, kind: "devices", devices: [{ deviceId: device, enrolledAtMs: 1, revokedAtMs: 2, state: "revoked" }] } },
    { ok: true, value: { schemaVersion: 1, kind: "erase_request", token, requestedAtMs: 5, requestExpiresAtMs: 6 } },
    { ok: true, value: { schemaVersion: 1, kind: "erase_progress", erasure: { phase: "confirmed", step: 2, stepCount: LIFECYCLE_ERASE_STEPS, requestedAtMs: 1, requestExpiresAtMs: 2, confirmedAtMs: 3, completedAtMs: null, sealed: false } } },
    { ok: true, value: { schemaVersion: 1, kind: "transfer", transfer: { transferId: token, client: "codex", fromDeviceId: device, toDeviceId: other, phase: "granted",
      requestedAtMs: 1, grantedAtMs: 2, completedAtMs: null, expiresAtMs: 9, expectedRevision: 4, ownershipRevision: null, refusal: null } } }];
  for (const result of results) {
    expect(parseUsageLifecycleResult(result) as unknown).toEqual(result);
    const bytes = encodeUsageLifecycleHttpResponse(result)!;
    expect(bytes.byteLength).toBeLessThanOrEqual(USAGE_LIFECYCLE_RESPONSE_BYTES);
    expect(decodeUsageLifecycleHttpResponse(bytes) as unknown).toEqual(result);
  }
  for (const bad of [{ ok: true, value: { ...status, phase: "erased" } }, { ok: true, value: { ...status, publishing: { ...status.publishing, waitlist: { position: 1, total: 1 } } } },
    { ok: true, value: { ...page, items: [{ surface: "x", key: "1", value: { get a() { return 1; } } }] } },
    { ok: true, value: { ...page, items: [{ surface: "x", key: "1", value: Number.NaN }] } }, { ok: false, error: "toString" },
    { ok: true, value: { schemaVersion: 1, kind: "erase_progress", erasure: { phase: "erased", step: 5, stepCount: LIFECYCLE_ERASE_STEPS, requestedAtMs: 1, requestExpiresAtMs: 2, confirmedAtMs: 3, completedAtMs: 4, sealed: true } } },
    { ok: true, value: { schemaVersion: 1, kind: "status" } }, { ok: true }, { ok: true, value: null }]) expect(parseUsageLifecycleResult(bad)).toBeNull();
  expect(lifecycleReplyMatches("status", status)).toBe(true);
  expect(lifecycleReplyMatches("export", status)).toBe(false);
  expect(lifecycleReplyMatches("transfer_grant", { schemaVersion: 1, kind: "transfer", transfer: { transferId: token, client: "codex", fromDeviceId: device, toDeviceId: other,
    phase: "requested", requestedAtMs: 1, grantedAtMs: null, completedAtMs: null, expiresAtMs: 2, expectedRevision: null, ownershipRevision: null, refusal: null } })).toBe(true);
  const ledger = { schemaVersion: 1 as const, contract: LIFECYCLE_RECLAMATION_CONTRACT, accountId, generation, recordedAtMs: 1,
    entries: [{ bucket: "STAGING" as const, surface: "r2:canonical-contribution-bodies", prefix: `usage-contributions/v3/${accountId}/`, objects: 2, note: "heads" }] };
  expect(parseReclamationLedger(ledger) as unknown).toEqual(ledger);
  expect(parseReclamationLedger({ ...ledger, entries: [{ ...ledger.entries[0], bucket: "OTHER" }] })).toBeNull();
});

test("export sections and exclusions cover every account-scoped surface in costs.json", () => {
  const surfaces = (costs as { surfaces: Record<string, { owner?: string }> }).surfaces;
  const inventory = Object.keys(surfaces).filter(name => name.startsWith("worker:") || name.startsWith("r2:"));
  const excluded = new Set(LIFECYCLE_EXPORT_EXCLUDED.map(entry => entry.surface.split("#")[0]));
  const exported = new Set(LIFECYCLE_EXPORT_SECTIONS.map(section => `worker:${section}`));
  const missing = inventory.filter(name => !excluded.has(name) && !exported.has(name));
  expect(missing).toEqual([]);
  for (const name of [...excluded, ...exported]) if (name !== "worker:lifecycle") expect(inventory).toContain(name);
  expect(new Set(LIFECYCLE_EXPORT_SECTIONS).size).toBe(LIFECYCLE_EXPORT_SECTIONS.length);
});
