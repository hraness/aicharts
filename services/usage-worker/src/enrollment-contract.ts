/** Internal-only contracts. No caller-supplied reservation is authority. */
export type EnrollmentProof = Readonly<{ intentId: string; pollSecret: string; uploadSecret: string }>;
export type EnrollmentReservation = Readonly<{
  schemaVersion: 1;
  intentId: string;
  accountId: string;
  reservationId: string;
  pollCommitment: string;
  uploadCommitment: string;
  recoveryGeneration: string;
  reservedAtMs: number;
  expiresAtMs: number;
}>;

export const enrollmentHex = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{64}$/u.test(value) && value !== "0".repeat(64);
export const enrollmentTime = (value: unknown): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
export const enrollmentAccount = (value: unknown): value is string => typeof value === "string"
  && /^acct_[0-9a-f]{32}$/u.test(value);

export function enrollmentSnapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const own = Reflect.ownKeys(descriptors);
    if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) return null;
      result[key] = descriptor.value as unknown;
    }
    return result;
  } catch { return null; }
}

export function parseEnrollmentProof(value: unknown): EnrollmentProof | null {
  const owned = enrollmentSnapshot(value, ["intentId", "pollSecret", "uploadSecret"]);
  return owned !== null && enrollmentHex(owned.intentId) && enrollmentHex(owned.pollSecret)
    && enrollmentHex(owned.uploadSecret) && owned.pollSecret !== owned.uploadSecret
    ? Object.freeze({ intentId: owned.intentId, pollSecret: owned.pollSecret, uploadSecret: owned.uploadSecret }) : null;
}

export function parseEnrollmentReservation(value: unknown): EnrollmentReservation | null {
  const owned = enrollmentSnapshot(value, ["schemaVersion", "intentId", "accountId", "reservationId", "pollCommitment",
    "uploadCommitment", "recoveryGeneration", "reservedAtMs", "expiresAtMs"]);
  if (owned === null || owned.schemaVersion !== 1 || !enrollmentHex(owned.intentId)
    || !enrollmentAccount(owned.accountId) || !enrollmentHex(owned.reservationId)
    || !enrollmentHex(owned.pollCommitment) || !enrollmentHex(owned.uploadCommitment)
    || owned.pollCommitment === owned.uploadCommitment || !enrollmentHex(owned.recoveryGeneration)
    || !enrollmentTime(owned.reservedAtMs) || !enrollmentTime(owned.expiresAtMs)
    || owned.expiresAtMs <= owned.reservedAtMs || owned.expiresAtMs - owned.reservedAtMs > 600_000) return null;
  return Object.freeze({ schemaVersion: 1, intentId: owned.intentId, accountId: owned.accountId,
    reservationId: owned.reservationId, pollCommitment: owned.pollCommitment, uploadCommitment: owned.uploadCommitment,
    recoveryGeneration: owned.recoveryGeneration, reservedAtMs: owned.reservedAtMs, expiresAtMs: owned.expiresAtMs });
}

/** Stable across recovery epochs; changing epochs must never route to a new account. */
export const enrollmentAccountName = (accountId: string): string => `account-v1:${accountId}`;

export function enrollmentRandom(): string {
  const value = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  if (!enrollmentHex(value)) throw new Error("enrollment_random_unavailable");
  return value;
}
