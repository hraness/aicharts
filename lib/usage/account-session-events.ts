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

export type UsageAccountLifecycleEvent = "visible" | "restored";
const lifecycleListeners = new Set<Readonly<{ listener: (event: UsageAccountLifecycleEvent) => void }>>();
function notifyLifecycle(event: UsageAccountLifecycleEvent): void {
  for (const { listener } of [...lifecycleListeners]) {
    try { listener(event); } catch { /* One view cannot prevent sibling revalidation. */ }
  }
}
/** "visible" asks for a background revalidation of views that stay on screen;
 * "restored" follows a suspension that already cleared every private view. */
export function subscribeUsageAccountLifecycle(listener: (event: UsageAccountLifecycleEvent) => void): () => void {
  const subscription = Object.freeze({ listener });
  lifecycleListeners.add(subscription);
  return () => { lifecycleListeners.delete(subscription); };
}

let lifecycleUsers = 0;
let stopLifecycle: (() => void) | undefined;
/** One shared browser listener set. Suspension (pagehide, or a restore from the
 * back-forward cache) clears every private view and requires fresh authority;
 * the restored page then reads again by itself. Merely hiding, showing or
 * refocusing a live document keeps what is on screen and revalidates it in the
 * background, so switching tabs never turns a working view into an error. */
export function retainUsageAccountLifecycle(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  lifecycleUsers++;
  if (lifecycleUsers === 1) {
    const target = window, page = document;
    const suspended = () => invalidateUsageAccountGeneration("lifecycle");
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      invalidateUsageAccountGeneration("lifecycle"); notifyLifecycle("restored");
    };
    const visible = () => { if (page.visibilityState !== "hidden") notifyLifecycle("visible"); };
    target.addEventListener("pagehide", suspended);
    target.addEventListener("pageshow", restored);
    target.addEventListener("focus", visible);
    page.addEventListener("visibilitychange", visible);
    const stopSignOut = subscribeUsageAccountSignOut(() => {});
    stopLifecycle = () => {
      target.removeEventListener("pagehide", suspended);
      target.removeEventListener("pageshow", restored);
      target.removeEventListener("focus", visible);
      page.removeEventListener("visibilitychange", visible);
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
