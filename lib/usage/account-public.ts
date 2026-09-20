import { privateDaysSnapshot } from "./private-days-http-contract";

export const USAGE_ACCOUNT_PATH = "/api/usage/account";
export const USAGE_ACCOUNT_URL = `https://aicharts.io${USAGE_ACCOUNT_PATH}`;
export const USAGE_ACCOUNT_BYTES = 512;
export const USAGE_ACCOUNT_MEDIA = "application/json; charset=utf-8";
export type UsageAccountError = "authentication_required" | "unavailable" | "invalid_request" | "request_rejected" | "method_not_allowed";
export type UsageAccountReply = Readonly<{ schemaVersion: 1; state: "ready"; account: Readonly<{ accountId: string }> }>
  | Readonly<{ schemaVersion: 1; error: Readonly<{ code: UsageAccountError }> }>;
const statuses = { authentication_required: 401, unavailable: 503, invalid_request: 400, request_rejected: 403, method_not_allowed: 405 } as const;
export const usageAccountId = (value: unknown): value is string => typeof value === "string" && value.length === 37 && /^acct_[a-f0-9]{32}$/u.test(value);
export const usageAccountStatus = (value: UsageAccountReply) => "error" in value ? statuses[value.error.code] : 200;

/** Exact private projection. No session, profile, credential or entitlement data. */
export function parseUsageAccountReply(value: unknown): UsageAccountReply | null {
  const ready = privateDaysSnapshot(value, ["schemaVersion", "state", "account"]);
  const account = privateDaysSnapshot(ready?.account, ["accountId"]);
  if (ready?.schemaVersion === 1 && ready.state === "ready" && account && usageAccountId(account.accountId)) {
    return Object.freeze({ schemaVersion: 1, state: "ready", account: Object.freeze({ accountId: account.accountId }) });
  }
  const absent = privateDaysSnapshot(value, ["schemaVersion", "error"]);
  const error = privateDaysSnapshot(absent?.error, ["code"]);
  if (absent?.schemaVersion !== 1 || typeof error?.code !== "string" || !Object.hasOwn(statuses, error.code)) return null;
  return Object.freeze({ schemaVersion: 1, error: Object.freeze({ code: error.code as UsageAccountError }) });
}
export function decodeUsageAccountReply(bytes: Uint8Array): UsageAccountReply | null {
  if (bytes.byteLength === 0 || bytes.byteLength > USAGE_ACCOUNT_BYTES) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const reply = parseUsageAccountReply(JSON.parse(text));
    return reply !== null && JSON.stringify(reply) === text ? reply : null;
  } catch { return null; }
}
