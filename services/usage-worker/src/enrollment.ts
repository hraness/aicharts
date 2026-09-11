import { DurableObject } from "cloudflare:workers";
import { createHash } from "node:crypto";
import {
  enrollmentAccount, enrollmentAccountName, enrollmentHex, enrollmentRandom,
  enrollmentSnapshot, enrollmentTime, parseEnrollmentProof, parseEnrollmentReservation,
  type EnrollmentProof, type EnrollmentReservation,
} from "./enrollment-contract";
import {
  ensureNamespaceAnchor, enrollmentStorageCall, readNamespaceAnchor, sameNamespaceAnchor, type NamespaceAnchor,
} from "./namespace-anchor";

export type EnrollmentError = "invalid_input" | "unavailable" | "unauthorized" | "not_reserved" | "not_enrolled"
  | "expired" | "conflict" | "recovery_required" | "revoked" | "storage_invalid" | "storage_unavailable" | "clock_regressed" | "limit";
export type EnrollmentResult<T> = { ok: true; value: T } | { ok: false; error: EnrollmentError };
export type EnrollmentReceipt = Readonly<{
  schemaVersion: 1; accountId: string; intentId: string; reservationId: string;
  deviceId: string; enrolledAtMs: number; namespaceVersion: 1;
}>;
export type EnrollmentView = Readonly<{ receipt: EnrollmentReceipt; deviceState: "active" | "revoked" }>;
type Device = { reservation: EnrollmentReservation; deviceId: string; enrolledAtMs: number; revokedAtMs: number | null };
type GenesisCompletion = { mode: "original" | "fresh-recovery"; intentId: string; reservationId: string; completedAtMs: number };
type State = {
  accountId: string; generation: string; observedAtMs: number; phase: "pending" | "active";
  anchor: NamespaceAnchor; devices: Device[]; genesisCompletion: GenesisCompletion | null;
};
type Operation = { proof: EnrollmentProof; grant: EnrollmentReservation; generation: string; observed: number };
export const MAX_ENROLLED_DEVICES = 128; // Includes revoked receipts; never evict identity to reclaim a slot.
const MAX_PAYLOAD = 131_072;
const SCHEMA_SQL = "CREATE TABLE account_enrollment (id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 0), payload TEXT CHECK (payload IS NULL OR length(payload) <= 131072))";
const ok = <T>(value: T): EnrollmentResult<T> => ({ ok: true, value });
const err = (error: EnrollmentError): EnrollmentResult<never> => ({ ok: false, error });

function deviceIdFor(grant: EnrollmentReservation): string {
  return createHash("sha256").update(["aicharts:enrollment:v1", "device", grant.accountId, grant.intentId, grant.reservationId].join("\0")).digest("hex");
}

function sameGrant(left: EnrollmentReservation, right: EnrollmentReservation): boolean {
  return left.schemaVersion === right.schemaVersion && left.intentId === right.intentId && left.accountId === right.accountId
    && left.reservationId === right.reservationId && left.pollCommitment === right.pollCommitment
    && left.uploadCommitment === right.uploadCommitment && left.recoveryGeneration === right.recoveryGeneration
    && left.reservedAtMs === right.reservedAtMs && left.expiresAtMs === right.expiresAtMs;
}

// legacy=true is used only by the additive constructor migration. No legacy
// shape is admitted to an operation before deriving and validating completion.
function validState(value: unknown, legacy = false): value is State {
  const state = enrollmentSnapshot(value, ["accountId", "generation", "observedAtMs", "phase", "anchor", "devices", ...(legacy ? [] : ["genesisCompletion"])]);
  if (state === null || !enrollmentAccount(state.accountId) || !enrollmentHex(state.generation) || !enrollmentTime(state.observedAtMs)
    || (state.phase !== "pending" && state.phase !== "active") || !Array.isArray(state.devices)
    || state.devices.length > MAX_ENROLLED_DEVICES || (state.phase === "pending") !== (state.devices.length === 0)) return false;
  const anchor = enrollmentSnapshot(state.anchor, ["accountId", "namespaceKey", "intentId", "reservationId", "generation", "createdAtMs"]);
  if (anchor === null || anchor.accountId !== state.accountId || anchor.generation !== state.generation
    || !enrollmentHex(anchor.namespaceKey) || !enrollmentHex(anchor.intentId) || !enrollmentHex(anchor.reservationId)
    || !enrollmentTime(anchor.createdAtMs) || anchor.createdAtMs > state.observedAtMs) return false;
  const intentIds = new Set<string>();
  const deviceIds = new Set<string>();
  for (const raw of state.devices as unknown[]) {
    const device = enrollmentSnapshot(raw, ["reservation", "deviceId", "enrolledAtMs", "revokedAtMs"]);
    if (device === null) return false;
    const grant = parseEnrollmentReservation(device.reservation);
    if (grant === null || grant.accountId !== state.accountId || grant.recoveryGeneration !== state.generation
      || device.deviceId !== deviceIdFor(grant) || deviceIds.has(device.deviceId) || intentIds.has(grant.intentId)
      || !enrollmentTime(device.enrolledAtMs) || device.enrolledAtMs < grant.reservedAtMs
      || device.enrolledAtMs < anchor.createdAtMs || device.enrolledAtMs >= grant.expiresAtMs || device.enrolledAtMs > state.observedAtMs
      || !(device.revokedAtMs === null || (enrollmentTime(device.revokedAtMs)
        && device.revokedAtMs >= device.enrolledAtMs && device.revokedAtMs <= state.observedAtMs))) return false;
    intentIds.add(grant.intentId);
    deviceIds.add(device.deviceId);
  }
  if (legacy) return state.phase === "pending" || (state.devices as Device[]).some(device =>
    device.reservation.intentId === anchor.intentId && device.reservation.reservationId === anchor.reservationId);
  if (state.phase === "pending") return state.genesisCompletion === null;
  const completion = enrollmentSnapshot(state.genesisCompletion, ["mode", "intentId", "reservationId", "completedAtMs"]);
  if (completion === null || (completion.mode !== "original" && completion.mode !== "fresh-recovery")
    || !enrollmentHex(completion.intentId) || !enrollmentHex(completion.reservationId) || !enrollmentTime(completion.completedAtMs)) return false;
  const original = completion.intentId === anchor.intentId && completion.reservationId === anchor.reservationId;
  const anchorCreatedAtMs = anchor.createdAtMs;
  if ((completion.mode === "original") !== original || (completion.mode === "fresh-recovery" && completion.intentId === anchor.intentId)) return false;
  if (completion.mode === "fresh-recovery" && (state.devices as Device[]).some(device => device.reservation.intentId === anchor.intentId)) return false;
  return (state.devices as Device[]).some(device => device.reservation.intentId === completion.intentId
    && device.reservation.reservationId === completion.reservationId && device.enrolledAtMs === completion.completedAtMs
    && (completion.mode !== "fresh-recovery" || device.reservation.reservedAtMs >= anchorCreatedAtMs));
}

function supersededGenesis(state: State, grant: EnrollmentReservation): boolean {
  return state.genesisCompletion?.mode === "fresh-recovery" && state.anchor.intentId === grant.intentId;
}

function receipt(device: Device): EnrollmentReceipt {
  return Object.freeze({ schemaVersion: 1, accountId: device.reservation.accountId, intentId: device.reservation.intentId,
    reservationId: device.reservation.reservationId, deviceId: device.deviceId, enrolledAtMs: device.enrolledAtMs, namespaceVersion: 1 });
}
function view(device: Device): EnrollmentView {
  return Object.freeze({ receipt: receipt(device), deviceState: device.revokedAtMs === null ? "active" : "revoked" });
}

// workerd adds an own Symbol.dispose to object-valued RPC replies. Admit only
// that transport field here; input proofs and nested grants stay exact DTOs.
function rpcSnapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const disposal = Object.getOwnPropertyDescriptor(value, Symbol.dispose);
    if (disposal === undefined || !("value" in disposal) || typeof disposal.value !== "function") return null;
    const owned = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === Symbol.dispose) continue;
      if (typeof key !== "string") return null;
      const descriptor = descriptors[key];
      if (!("value" in descriptor)) return null;
      owned[key] = descriptor.value as unknown;
    }
    return enrollmentSnapshot(owned, keys);
  } catch { return null; }
}

/** Only for replies from the owned Pairing RPC, including late timeout results. */
function disposeReply(value: unknown): void {
  try {
    if (value === null || typeof value !== "object") return;
    const disposal = Object.getOwnPropertyDescriptor(value, Symbol.dispose);
    if (disposal !== undefined && "value" in disposal && typeof disposal.value === "function") Reflect.apply(disposal.value, value, []);
  } catch { /* Disposal cannot widen or replace a failed authority check. */ }
}

/**
 * Dormant account-owned enrollment. Proofs resolve the real PairingIntent; caller
 * account IDs or reservation DTOs never select authority. No upload API exists.
 * Restore requires a separately fenced, qualified reconciliation procedure.
 */
export class AccountEnrollment extends DurableObject<Env> {
  #healthy = true;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    try {
      ctx.storage.transactionSync(() => {
        if (this.#objects().length === 0) {
          ctx.storage.sql.exec(SCHEMA_SQL);
          ctx.storage.sql.exec("INSERT INTO account_enrollment (id, schema_version, revision, payload) VALUES (1, 2, 0, NULL)");
        }
        this.#schema();
        this.#migrate();
      });
    } catch { this.#healthy = false; }
  }

  #objects(): Record<string, SqlStorageValue>[] {
    return this.ctx.storage.sql.exec("SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' LIMIT 3").toArray();
  }
  #schema(): void {
    const objects = this.#objects();
    if (!this.#healthy || objects.length !== 1 || objects[0]?.type !== "table" || objects[0]?.name !== "account_enrollment"
      || objects[0]?.sql !== SCHEMA_SQL) throw new Error("storage_invalid");
  }
  #generation(): string | null {
    const value: unknown = this.env.USAGE_ENROLLMENT_GENERATION;
    return enrollmentHex(value) ? value : null;
  }
  #migrate(): void {
    const rows = this.ctx.storage.sql.exec("SELECT id, schema_version, revision, payload FROM account_enrollment LIMIT 2").toArray();
    const row = rows[0];
    if (rows.length !== 1 || row?.id !== 1 || (row.schema_version !== 1 && row.schema_version !== 2)
      || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision >= Number.MAX_SAFE_INTEGER) throw new Error("storage_invalid");
    if (row.schema_version === 2) return;
    let payload: string | null = null;
    if (row.payload !== null) {
      if (typeof row.payload !== "string" || row.payload.length > MAX_PAYLOAD || row.revision === 0) throw new Error("storage_invalid");
      const parsed: unknown = JSON.parse(row.payload);
      if (!validState(parsed, true) || !this.ctx.id.equals(this.env.ACCOUNT_ENROLLMENTS.idFromName(enrollmentAccountName(parsed.accountId)))) throw new Error("storage_invalid");
      const origin = parsed.devices.find(device => device.reservation.intentId === parsed.anchor.intentId && device.reservation.reservationId === parsed.anchor.reservationId);
      const migrated: State = { ...parsed, genesisCompletion: origin === undefined ? null : {
        mode: "original", intentId: origin.reservation.intentId, reservationId: origin.reservation.reservationId, completedAtMs: origin.enrolledAtMs,
      } };
      if (!validState(migrated)) throw new Error("storage_invalid");
      payload = JSON.stringify(migrated);
      if (payload.length > MAX_PAYLOAD) throw new Error("storage_invalid");
    } else if (row.revision !== 0) throw new Error("storage_invalid");
    // Preserve all receipts, the exact namespace and the operation revision. An
    // older binary fails closed on schema 2; rollback must not strip this field.
    this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version = 2, payload = ? WHERE id = 1", payload);
  }
  #transaction<T>(operation: Operation, run: (state: State | null, now: number) => { state: State | null; result: EnrollmentResult<T> }): EnrollmentResult<T> {
    try {
      return this.ctx.storage.transactionSync(() => {
        this.#schema();
        if (this.#generation() !== operation.generation) return err("recovery_required");
        const rows = this.ctx.storage.sql.exec("SELECT id, schema_version, revision, payload FROM account_enrollment LIMIT 2").toArray();
        const row = rows[0];
        if (rows.length !== 1 || row?.id !== 1 || row.schema_version !== 2 || typeof row.revision !== "number"
          || !Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision >= Number.MAX_SAFE_INTEGER) return err("storage_invalid");
        let state: State | null = null;
        if (row.payload !== null) {
          if (typeof row.payload !== "string" || row.payload.length > MAX_PAYLOAD || row.revision === 0) return err("storage_invalid");
          const parsed: unknown = JSON.parse(row.payload);
          if (!validState(parsed)) return err("storage_invalid");
          state = parsed;
          if (state.generation !== operation.generation) return err("recovery_required");
          if (!this.ctx.id.equals(this.env.ACCOUNT_ENROLLMENTS.idFromName(enrollmentAccountName(state.accountId)))) return err("storage_invalid");
        } else if (row.revision !== 0) return err("storage_invalid");
        const now = Date.now();
        if (!enrollmentTime(now) || now < operation.observed || (state !== null && now < state.observedAtMs)) return err("clock_regressed");
        operation.observed = now;
        if (state !== null) state.observedAtMs = now;
        const outcome = run(state, now);
        if (outcome.state !== null) {
          if (!validState(outcome.state)) throw new Error("storage_invalid");
          const payload = JSON.stringify(outcome.state);
          if (payload.length > MAX_PAYLOAD) throw new Error("storage_invalid");
          this.ctx.storage.sql.exec("UPDATE account_enrollment SET revision = ?, payload = ? WHERE id = 1", row.revision + 1, payload);
        }
        return outcome.result;
      });
    } catch { return err("storage_invalid"); }
  }

  #closed(operation: Operation, live: boolean): EnrollmentError | null {
    const now = Date.now();
    if (this.#generation() !== operation.generation) return "recovery_required";
    if (!enrollmentTime(now) || now < operation.observed) return "clock_regressed";
    operation.observed = now;
    return live && now >= operation.grant.expiresAtMs ? "expired" : null;
  }

  async #operation(input: unknown): Promise<EnrollmentResult<Operation>> {
    const proof = parseEnrollmentProof(input);
    if (proof === null) return err("invalid_input");
    const generation = this.#generation();
    if (generation === null) return err("recovery_required");
    const before = Date.now();
    if (!enrollmentTime(before)) return err("clock_regressed");
    const raw: unknown = await enrollmentStorageCall<unknown>(this.env.PAIRINGS.getByName(proof.intentId).readEnrollmentReservation(proof), disposeReply);
    let grant: EnrollmentReservation | null;
    try {
      const envelope = rpcSnapshot(raw, ["ok", "value"]);
      grant = envelope?.ok === true ? parseEnrollmentReservation(envelope.value) : null;
      if (grant === null) {
        const failure = rpcSnapshot(raw, ["ok", "error"]);
        if (failure?.ok === false) {
          switch (failure.error) {
            case "unauthorized": case "not_reserved": case "recovery_required": case "clock_regressed": case "storage_invalid":
              return err(failure.error);
          }
        }
        return err("storage_unavailable");
      }
    } finally { disposeReply(raw); }
    if (grant.intentId !== proof.intentId || grant.recoveryGeneration !== generation) return err("recovery_required");
    if (!this.ctx.id.equals(this.env.ACCOUNT_ENROLLMENTS.idFromName(enrollmentAccountName(grant.accountId)))) return err("unauthorized");
    const operation = { proof, grant, generation, observed: Math.max(before, grant.reservedAtMs) };
    const closed = this.#closed(operation, false);
    if (closed !== null) return err(closed);
    return ok(operation);
  }

  #existing(state: State | null, grant: EnrollmentReservation): EnrollmentResult<Device | null> {
    if (state === null) return ok(null);
    if (state.accountId !== grant.accountId) return err("unauthorized");
    const existing = state.devices.find(device => device.reservation.intentId === grant.intentId);
    return existing === undefined ? ok(null) : sameGrant(existing.reservation, grant) ? ok(existing) : err("conflict");
  }

  async enroll(input: unknown): Promise<EnrollmentResult<EnrollmentView>> {
    try {
      const resolved = await this.#operation(input);
      if (!resolved.ok) return resolved;
      const operation = resolved.value;
      const { grant, generation } = operation;
      const observed = this.#transaction(operation, state => ({ state, result: this.#existing(state, grant) }));
      if (!observed.ok) return observed;
      // Exact committed readback is non-secret and cannot reactivate a device.
      if (observed.value !== null) return ok(view(observed.value));
      let closed = this.#closed(operation, true);
      if (closed !== null) return err(closed);
      const before = this.#transaction(operation, state => ({ state, result: ok(state) }));
      if (!before.ok) return before;
      if (before.value === null) {
        const external = await readNamespaceAnchor(this.env.CONTROL, grant.accountId);
        closed = this.#closed(operation, true);
        if (closed !== null) return err(closed);
        if (external !== null) return err("recovery_required");
      }
      const prepared = this.#transaction(operation, (state, now) => {
        if (now >= grant.expiresAtMs) return { state, result: err("expired") };
        if (state === null) state = { accountId: grant.accountId, generation, observedAtMs: now, phase: "pending", devices: [], genesisCompletion: null,
          anchor: { accountId: grant.accountId, generation, namespaceKey: enrollmentRandom(), intentId: grant.intentId,
            reservationId: grant.reservationId, createdAtMs: now } };
        if (state.accountId !== grant.accountId) return { state, result: err("unauthorized") };
        if (supersededGenesis(state, grant)) return { state, result: err("recovery_required") };
        if (state.phase === "pending" && (state.anchor.intentId !== grant.intentId || state.anchor.reservationId !== grant.reservationId)) return { state, result: err("recovery_required") };
        return { state, result: ok({ anchor: Object.freeze({ ...state.anchor }), phase: state.phase }) };
      });
      if (!prepared.ok) return prepared;
      if (prepared.value.phase === "pending") {
        try {
          await ensureNamespaceAnchor(this.env.CONTROL, prepared.value.anchor, () => this.#closed(operation, true) === null);
        } catch { return err(this.#closed(operation, true) ?? "storage_unavailable"); }
      } else {
        const external = await readNamespaceAnchor(this.env.CONTROL, grant.accountId);
        if (external === null || !sameNamespaceAnchor(external, prepared.value.anchor)) return err("recovery_required");
      }
      closed = this.#closed(operation, true);
      if (closed !== null) return err(closed);
      const deviceId = deviceIdFor(grant);
      return this.#transaction<EnrollmentView>(operation, (state, now) => {
        if (state === null || !sameNamespaceAnchor(state.anchor, prepared.value.anchor)) return { state, result: err("recovery_required") };
        const existing = this.#existing(state, grant);
        if (!existing.ok) return { state, result: existing };
        if (existing.value !== null) return { state, result: ok(view(existing.value)) };
        if (supersededGenesis(state, grant)) return { state, result: err("recovery_required") };
        if (now >= grant.expiresAtMs) return { state, result: err("expired") };
        if (state.devices.length >= MAX_ENROLLED_DEVICES) return { state, result: err("limit") };
        if (state.devices.some(device => device.deviceId === deviceId)) return { state, result: err("conflict") };
        const device: Device = { reservation: grant, deviceId, enrolledAtMs: now, revokedAtMs: null };
        if (state.phase === "pending") state.genesisCompletion = { mode: "original", intentId: grant.intentId, reservationId: grant.reservationId, completedAtMs: now };
        state.devices.push(device);
        state.phase = "active";
        return { state, result: ok(view(device)) };
      });
    } catch { return err("storage_unavailable"); }
  }

  /** Explicit same-account fresh reservation may finish retained pending genesis.
   * It never adopts an orphan anchor, remints a namespace, or enrolls the expired
   * original credential. This is not a general backup/restore operation. */
  async recoverPendingEnrollment(input: unknown): Promise<EnrollmentResult<EnrollmentView>> {
    try {
      const resolved = await this.#operation(input);
      if (!resolved.ok) return resolved;
      const operation = resolved.value;
      const { grant } = operation;
      const prepared = this.#transaction<{ completed: EnrollmentView } | { anchor: NamespaceAnchor }>(operation, (state, now) => {
        if (state === null || state.accountId !== grant.accountId) return { state, result: err("recovery_required") };
        const existing = this.#existing(state, grant);
        if (!existing.ok) return { state, result: existing };
        // Exact recovery readback is non-secret, including after expiry/revocation.
        if (state.genesisCompletion?.mode === "fresh-recovery" && state.genesisCompletion.intentId === grant.intentId
          && state.genesisCompletion.reservationId === grant.reservationId && existing.value !== null) return { state, result: ok({ completed: view(existing.value) }) };
        if (now >= grant.expiresAtMs) return { state, result: err("expired") };
        if (state.phase !== "pending" || state.anchor.intentId === grant.intentId || grant.reservedAtMs < state.anchor.createdAtMs) return { state, result: err("recovery_required") };
        return { state, result: ok({ anchor: Object.freeze({ ...state.anchor }) }) };
      });
      if (!prepared.ok) return prepared;
      if ("completed" in prepared.value) return ok(prepared.value.completed);
      const original = prepared.value.anchor;
      try { await ensureNamespaceAnchor(this.env.CONTROL, original, () => this.#closed(operation, true) === null); }
      catch { return err(this.#closed(operation, true) ?? "storage_unavailable"); }
      const closed = this.#closed(operation, true);
      if (closed !== null) return err(closed);
      return this.#transaction<EnrollmentView>(operation, (state, now) => {
        if (state === null || !sameNamespaceAnchor(state.anchor, original)) return { state, result: err("recovery_required") };
        const existing = this.#existing(state, grant);
        if (!existing.ok) return { state, result: existing };
        if (state.genesisCompletion?.mode === "fresh-recovery" && state.genesisCompletion.intentId === grant.intentId
          && state.genesisCompletion.reservationId === grant.reservationId && existing.value !== null) return { state, result: ok(view(existing.value)) };
        if (now >= grant.expiresAtMs) return { state, result: err("expired") };
        if (state.phase !== "pending" || state.anchor.intentId === grant.intentId || grant.reservedAtMs < state.anchor.createdAtMs) return { state, result: err("recovery_required") };
        const device: Device = { reservation: grant, deviceId: deviceIdFor(grant), enrolledAtMs: now, revokedAtMs: null };
        state.devices.push(device);
        state.genesisCompletion = { mode: "fresh-recovery", intentId: grant.intentId, reservationId: grant.reservationId, completedAtMs: now };
        state.phase = "active";
        return { state, result: ok(view(device)) };
      });
    } catch { return err("storage_unavailable"); }
  }

  async namespaceForEnrollment(input: unknown): Promise<EnrollmentResult<Readonly<{
    schemaVersion: 1; namespaceVersion: 1; namespaceKey: string; receipt: EnrollmentReceipt;
  }>>> {
    try {
      const resolved = await this.#operation(input);
      if (!resolved.ok) return resolved;
      const operation = resolved.value;
      let closed = this.#closed(operation, true);
      if (closed !== null) return err(closed);
      const found = this.#transaction<{ anchor: NamespaceAnchor }>(operation, state => {
        const existing = this.#existing(state, operation.grant);
        if (!existing.ok) return { state, result: existing };
        if (state === null || existing.value === null) return { state, result: err("not_enrolled") };
        if (existing.value.revokedAtMs !== null) return { state, result: err("revoked") };
        return { state, result: ok({ anchor: Object.freeze({ ...state.anchor }) }) };
      });
      if (!found.ok) return found;
      const external = await readNamespaceAnchor(this.env.CONTROL, operation.grant.accountId);
      if (external === null || !sameNamespaceAnchor(external, found.value.anchor)) return err("recovery_required");
      closed = this.#closed(operation, true);
      if (closed !== null) return err(closed);
      return this.#transaction<Readonly<{ schemaVersion: 1; namespaceVersion: 1; namespaceKey: string; receipt: EnrollmentReceipt }>>(operation, (state, now) => {
        const existing = this.#existing(state, operation.grant);
        if (!existing.ok) return { state, result: existing };
        if (state === null || existing.value === null || !sameNamespaceAnchor(state.anchor, found.value.anchor)) return { state, result: err("not_enrolled") };
        if (existing.value.revokedAtMs !== null) return { state, result: err("revoked") };
        if (now >= operation.grant.expiresAtMs) return { state, result: err("expired") };
        return { state, result: ok(Object.freeze({ schemaVersion: 1 as const, namespaceVersion: 1 as const,
          namespaceKey: state.anchor.namespaceKey, receipt: receipt(existing.value) })) };
      });
    } catch { return err("storage_unavailable"); }
  }

  /** Exact original proof can revoke only its own existing device, never enroll one. */
  async revokeEnrollment(input: unknown): Promise<EnrollmentResult<EnrollmentView>> {
    try {
      const resolved = await this.#operation(input);
      if (!resolved.ok) return resolved;
      const operation = resolved.value;
      const { grant } = operation;
      return this.#transaction<EnrollmentView>(operation, (state, now) => {
        const existing = this.#existing(state, grant);
        if (!existing.ok) return { state, result: existing };
        if (existing.value === null) return { state, result: err("not_enrolled") };
        existing.value.revokedAtMs ??= now;
        return { state, result: ok(view(existing.value)) };
      });
    } catch { return err("storage_unavailable"); }
  }
}
