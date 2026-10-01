/** Privacy-preserving exception and missing-route normalization. */

export function sanitizeAnalyticsError(value: unknown): Error {
  const allowedNames = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError"]);
  const safe = new Error("Client operation failed");
  safe.name = value instanceof Error && allowedNames.has(value.name) ? value.name : "Error";
  safe.stack = undefined;
  return safe;
}

/** Stable, content-free fingerprint: name, message, and the top two frames. */
export function analyticsErrorFingerprint(error: Error): string {
  const stackFrame = error.stack?.split("\n").slice(1, 3).join("\n") ?? "";
  const input = `${error.name}\n${error.message}\n${stackFrame}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `e_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Sliding-window budget: at most `totalLimit` per window and `perFingerprintLimit` per fingerprint. */
export class ExceptionBudget {
  readonly #totalLimit: number;
  readonly #perFingerprintLimit: number;
  readonly #windowMs: number;
  #all: number[] = [];
  #byFingerprint = new Map<string, number[]>();

  constructor(options: Readonly<{
    totalLimit: number;
    perFingerprintLimit: number;
    windowMs: number;
  }>) {
    this.#totalLimit = options.totalLimit;
    this.#perFingerprintLimit = options.perFingerprintLimit;
    this.#windowMs = options.windowMs;
  }

  allow(fingerprint: string, now = Date.now()): boolean {
    const threshold = now - this.#windowMs;
    this.#all = this.#all.filter(timestamp => timestamp > threshold);
    for (const [candidate, timestamps] of this.#byFingerprint) {
      const active = timestamps.filter(timestamp => timestamp > threshold);
      if (active.length === 0) this.#byFingerprint.delete(candidate);
      else if (active.length !== timestamps.length) this.#byFingerprint.set(candidate, active);
    }
    const matching = this.#byFingerprint.get(fingerprint) ?? [];
    if (this.#all.length >= this.#totalLimit || matching.length >= this.#perFingerprintLimit) {
      return false;
    }
    this.#all.push(now);
    matching.push(now);
    this.#byFingerprint.set(fingerprint, matching);
    return true;
  }
}

/** Browser budget from the standard: 20 per minute, 2 per fingerprint. */
export function createBrowserExceptionBudget(): ExceptionBudget {
  return new ExceptionBudget({ totalLimit: 20, perFingerprintLimit: 2, windowMs: 60_000 });
}

/** Server budget from the standard: 30 per minute, 3 per fingerprint. */
export function createServerExceptionBudget(): ExceptionBudget {
  return new ExceptionBudget({ totalLimit: 30, perFingerprintLimit: 3, windowMs: 60_000 });
}

export const REQUESTED_PATH_MAX_LENGTH = 256;

/** Normalize a missing route for `page not found`: path only, scrubbed, 256 characters max. */
export function normalizedRequestedPath(value: unknown): string {
  void value;
  // Missing paths are not public content IDs and may contain personal values.
  return "/[other]";
}

/** Referrer hostname (lowercase, no `www.`), or `$direct` when there is none. */
export function referrerHost(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "$direct";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "$direct";
    return parsed.hostname.toLowerCase().replace(/^www\./u, "") || "$direct";
  } catch {
    return "$direct";
  }
}
