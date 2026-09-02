"use client";

import { useEffect } from "react";

import {
  analyticsSurface,
  captureAnalyticsEvent,
  classifyAnalyticsLink,
  newsletterSignupRequestEvent,
} from "@/lib/analytics";

const mailingFormSlot = "hraness-mailing-list-signup";
const footerSlot = "hraness-site-footer";

function surfaceFor(element: Element): string {
  const declared = element.closest<HTMLElement>("[data-analytics-surface]")
    ?.dataset.analyticsSurface;
  if (declared !== undefined) return declared;
  return element.closest(`[data-slot="${footerSlot}"]`) === null
    ? analyticsSurface(undefined, window.location.pathname)
    : "global_footer";
}

function handleDocumentClick(event: MouseEvent): void {
  if (event.button !== 0 || !(event.target instanceof Element)) return;
  const anchor = event.target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  const href = anchor.getAttribute("href");
  if (href === null) return;
  const analyticsEvent = classifyAnalyticsLink({
    askAiProvider: anchor.dataset.askAiProvider,
    currentUrl: window.location.href,
    destinationId: anchor.dataset.analyticsDestinationId,
    destinationKind: anchor.dataset.analyticsDestinationKind,
    download: anchor.hasAttribute("download"),
    href,
    surface: surfaceFor(anchor),
  });
  if (analyticsEvent !== null) captureAnalyticsEvent(analyticsEvent);
}

function handleDocumentSubmit(event: SubmitEvent): void {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.dataset.slot !== mailingFormSlot) return;
  const audience = form.querySelector<HTMLInputElement>('input[name="audience"]')?.value;
  const analyticsEvent = newsletterSignupRequestEvent(audience);
  if (analyticsEvent !== null) captureAnalyticsEvent(analyticsEvent);
}

/** One delegated listener keeps server-rendered links static while covering every public anchor. */
export function AnalyticsBoundary() {
  useEffect(() => {
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("submit", handleDocumentSubmit, true);
    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
      document.removeEventListener("submit", handleDocumentSubmit, true);
    };
  }, []);

  return null;
}
