import { subscribeSuiteOidcBrowserSignOut } from "@hraness/suite-accounts/browser-session";
import { invalidateUsageAccountGeneration } from "./account-generation";

// No account or session values are retained. Same-tab invalidation and the SDK's
// exact cross-tab notification share one synchronous cleanup boundary.
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | undefined;
export function clearUsageAccountViews(): void {
  invalidateUsageAccountGeneration("confirmed-signout");
  for (const listener of listeners) {
    try { listener(); } catch { /* One view cannot prevent sibling cleanup. */ }
  }
}

let lifecycleUsers = 0;
let stopLifecycle: (() => void) | undefined;
/** One shared browser listener set. Returning to a document requires fresh authority. */
export function retainUsageAccountLifecycle(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  lifecycleUsers++;
  if (lifecycleUsers === 1) {
    const target = window, page = document;
    const invalidate = () => invalidateUsageAccountGeneration("lifecycle");
    const restored = (event: PageTransitionEvent) => { if (event.persisted) invalidate(); };
    target.addEventListener("pagehide", invalidate);
    target.addEventListener("pageshow", restored);
    target.addEventListener("focus", invalidate);
    page.addEventListener("visibilitychange", invalidate);
    const stopSignOut = subscribeUsageAccountSignOut(() => {});
    stopLifecycle = () => {
      target.removeEventListener("pagehide", invalidate);
      target.removeEventListener("pageshow", restored);
      target.removeEventListener("focus", invalidate);
      page.removeEventListener("visibilitychange", invalidate);
      stopSignOut();
    };
  }
  let active = true;
  return () => {
    if (!active) return; active = false; lifecycleUsers--;
    if (lifecycleUsers === 0) { stopLifecycle?.(); stopLifecycle = undefined; }
  };
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
