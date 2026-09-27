import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test } from "vitest";
import { CONTRIBUTION_MAX_IMMUTABLE_BYTES, type ContributionAuthority } from "../../../lib/usage/contributions";
import { ContributionState, CONTRIBUTION_MAX_METADATA_BYTES } from "../src/contributions-state";
import { ContributionProjectionState, CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES, contributionStorageBudget,
  CONTRIBUTION_STORAGE_WARNING_DENOMINATOR, CONTRIBUTION_STORAGE_WARNING_NUMERATOR } from "../src/contribution-projection-state";

/** Storage-budget (plan 6.5) evidence: the account status reply carries the
 * cumulative lifetime position against every immutable/derived ceiling and
 * warns once seven eighths of a ceiling is charged. */
const hex = (value: number, width = 64) => value.toString(16).padStart(width, "0");
const DEVICE = hex(3);
let serial = 7_000, account = "";
const NOW = 1_000_000;
const scope = () => ({ accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION });
const authority = (): ContributionAuthority => ({ ...scope(), deviceId: DEVICE, active: true, observedAtMs: NOW, allowAccountTombstone: true });
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(`budget-synthetic-${serial}`);
const warnAt = (ceiling: number) => Math.ceil(ceiling * CONTRIBUTION_STORAGE_WARNING_NUMERATOR / CONTRIBUTION_STORAGE_WARNING_DENOMINATOR);
const run = <T>(callback: (storage: DurableObjectStorage) => T): Promise<T> => runInDurableObject(stub(), (_instance, context) => callback(context.storage));
async function fresh(): Promise<void> {
  await run(storage => {
    const state = new ContributionState(storage); state.initialize(account, env.USAGE_ENROLLMENT_GENERATION);
    state.activateFresh({ schemaVersion: 3, ...scope(), deviceId: DEVICE, operationId: hex(serial), expectedRevision: 0, mode: "fresh-empty" }, authority(), () => true);
    new ContributionProjectionState(storage).initialize(account, env.USAGE_ENROLLMENT_GENERATION);
  });
}
beforeEach(async () => { serial += 1; account = `acct_${hex(serial, 32)}`; await fresh(); });
afterEach(async () => { await abortAllDurableObjects(); await reset(); });

test("a freshly activated account reports only its activation metadata charge, every ceiling and no warning", async () => {
  const status = await run(storage => new ContributionProjectionState(storage).status(NOW));
  const activation = await run(storage => new ContributionState(storage).control().metadataBytes);
  expect(activation).toBe(8_192);
  expect(status.budget).toEqual({
    derivedImmutableBytes: 0, derivedImmutableCeilingBytes: CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES,
    canonicalImmutableBytes: 0, canonicalImmutableCeilingBytes: CONTRIBUTION_MAX_IMMUTABLE_BYTES,
    canonicalMetadataBytes: activation, canonicalMetadataCeilingBytes: CONTRIBUTION_MAX_METADATA_BYTES,
    remainingBytes: { derivedImmutable: CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES, canonicalImmutable: CONTRIBUTION_MAX_IMMUTABLE_BYTES,
      canonicalMetadata: CONTRIBUTION_MAX_METADATA_BYTES - activation },
    warnings: [] });
  expect(status.immutableBytes).toBe(0);
});

test("each ceiling warns exactly at seven eighths and never one byte earlier", async () => {
  const cases = [
    [CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES, "derived_immutable_near_ceiling", (bytes: number) => contributionStorageBudget(bytes, 0, 0)],
    [CONTRIBUTION_MAX_IMMUTABLE_BYTES, "canonical_immutable_near_ceiling", (bytes: number) => contributionStorageBudget(0, bytes, 0)],
    [CONTRIBUTION_MAX_METADATA_BYTES, "canonical_metadata_near_ceiling", (bytes: number) => contributionStorageBudget(0, 0, bytes)],
  ] as const;
  for (const [ceiling, warning, budget] of cases) {
    expect(budget(warnAt(ceiling) - 1).warnings).toEqual([]);
    expect(budget(warnAt(ceiling)).warnings).toEqual([warning]);
    expect(budget(ceiling).warnings).toEqual([warning]);
  }
  expect(contributionStorageBudget(CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES, CONTRIBUTION_MAX_IMMUTABLE_BYTES, CONTRIBUTION_MAX_METADATA_BYTES).warnings)
    .toEqual(["derived_immutable_near_ceiling", "canonical_immutable_near_ceiling", "canonical_metadata_near_ceiling"]);
  expect(() => contributionStorageBudget(CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES + 1, 0, 0)).toThrow();
  expect(() => contributionStorageBudget(0, -1, 0)).toThrow();
  expect(() => contributionStorageBudget(0, 0, 1.5)).toThrow();
});

test("the status reply reflects charged canonical and derived bytes from the control rows", async () => {
  const derived = warnAt(CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES), canonical = warnAt(CONTRIBUTION_MAX_IMMUTABLE_BYTES) - 1, metadata = 4_096;
  const status = await run(storage => {
    storage.sql.exec("UPDATE usage_contribution_projection_control SET immutable_bytes=? WHERE id=1", derived);
    storage.sql.exec("UPDATE usage_contribution_control SET immutable_bytes=?, metadata_bytes=? WHERE id=1", canonical, metadata);
    return new ContributionProjectionState(storage).status(NOW);
  });
  expect(status.immutableBytes).toBe(derived);
  expect(status.budget).toMatchObject({ derivedImmutableBytes: derived, canonicalImmutableBytes: canonical, canonicalMetadataBytes: metadata,
    remainingBytes: { derivedImmutable: CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES - derived, canonicalImmutable: CONTRIBUTION_MAX_IMMUTABLE_BYTES - canonical,
      canonicalMetadata: CONTRIBUTION_MAX_METADATA_BYTES - metadata }, warnings: ["derived_immutable_near_ceiling"] });
  const later = await run(storage => {
    storage.sql.exec("UPDATE usage_contribution_control SET immutable_bytes=? WHERE id=1", canonical + 1);
    return new ContributionProjectionState(storage).status(NOW);
  });
  expect(later.budget.warnings).toEqual(["derived_immutable_near_ceiling", "canonical_immutable_near_ceiling"]);
});

test("a control row charged past a ceiling is refused as storage_invalid, never reported", async () => {
  await expect(run(storage => {
    storage.sql.exec("UPDATE usage_contribution_projection_control SET immutable_bytes=? WHERE id=1", CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES + 1);
    return new ContributionProjectionState(storage).status(NOW);
  })).rejects.toMatchObject({ code: "storage_invalid" });
});
