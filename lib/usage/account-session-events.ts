import { subscribeSuiteOidcBrowserSignOut } from "@hraness/suite-accounts/browser-session";

// No account or session values are retained. Same-tab invalidation and the SDK's
// exact cross-tab notification share one synchronous cleanup boundary.
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | undefined;
export function clearUsageAccountViews(): void {
  for (const listener of listeners) {
    try { listener(); } catch { /* One view cannot prevent sibling cleanup. */ }
  }
}
export function subscribeUsageAccountSignOut(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    try { unsubscribe = subscribeSuiteOidcBrowserSignOut(clearUsageAccountViews); }
    catch { /* A browser without channel access still clears this tab. */ }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { unsubscribe?.(); unsubscribe = undefined; }
  };
}
