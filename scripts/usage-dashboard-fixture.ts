import type { Route } from "playwright-core";
import {
  encodeUsageDashboardFrame, parseUsageDashboardSearch, USAGE_DASHBOARD_MEDIA, USAGE_DASHBOARD_REFRESH_MAX_MS,
  type UsageDashboardPart, type UsageDashboardQuery,
} from "../lib/usage/dashboard-public";

/** One part exactly as its standalone endpoint would answer it. */
export type UsageDashboardFixturePart = Readonly<{ status: number; body: string | Uint8Array }>;
export type UsageDashboardFixtureReply = "authentication_required" | "unavailable"
  | Readonly<{ accountId: string; part: (part: UsageDashboardPart) => UsageDashboardFixturePart }>;

/** The browser must use the canonical read-only page contract. */
export function usageDashboardFixtureQuery(route: Route): UsageDashboardQuery {
  const request = route.request(), query = parseUsageDashboardSearch(new URL(request.url()).search);
  if (request.method() !== "GET" || request.postData() !== null || query === null || request.headers()["accept"] !== USAGE_DASHBOARD_MEDIA) {
    throw new Error("The browser must use the canonical read-only dashboard contract.");
  }
  return query;
}

/** Synthetic same-origin answer through the production frame codec, so the
 * browser admits exactly what the real route would send. The longest renewal
 * delay keeps session timers out of the synthetic run. */
export async function fulfillUsageDashboard(route: Route, query: UsageDashboardQuery, reply: UsageDashboardFixtureReply): Promise<void> {
  const frame = typeof reply === "string"
    ? encodeUsageDashboardFrame({ kind: "error", error: reply })
    : encodeUsageDashboardFrame({ kind: "ready", accountId: reply.accountId, sessionRefreshInMs: USAGE_DASHBOARD_REFRESH_MAX_MS, parts: query.parts.map(part => {
      const { status, body } = reply.part(part);
      return { part, status, bytes: typeof body === "string" ? new TextEncoder().encode(body) : Uint8Array.from(body) };
    }) });
  if (frame === null) throw new Error("A synthetic dashboard frame must pass the production codec.");
  await route.fulfill({ status: typeof reply === "string" ? (reply === "authentication_required" ? 401 : 503) : 200,
    headers: { "content-type": USAGE_DASHBOARD_MEDIA, "cache-control": "private, no-store" }, body: Buffer.from(frame) });
}

export const totalsUnavailable: UsageDashboardFixturePart = Object.freeze({ status: 503, body: '{"schemaVersion":2,"ok":false,"error":"unavailable"}' });
export const accountReady = (accountId: string): UsageDashboardFixturePart =>
  Object.freeze({ status: 200, body: JSON.stringify({ schemaVersion: 1, state: "ready", account: { accountId } }) });
