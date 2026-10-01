"use client";
import { useEffect } from "react";
import { captureAnalyticsEvent, pageNotFoundEvent } from "@/lib/analytics";
export function NotFoundAnalytics() {
  useEffect(() => { captureAnalyticsEvent(pageNotFoundEvent(window.location.pathname, document.referrer)); }, []);
  return null;
}
