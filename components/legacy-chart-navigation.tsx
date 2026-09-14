"use client";

import { useEffect } from "react";
import { legacyChartDestination } from "@/lib/chart-navigation";

/** Fragments never reach the server; retain old bookmarked chart anchors after hydration. */
export function LegacyChartNavigation() {
  useEffect(() => {
    function followLegacyLink() {
      const destination = legacyChartDestination(window.location.pathname, window.location.search, window.location.hash);
      if (destination !== null) window.location.replace(destination);
    }
    followLegacyLink();
    window.addEventListener("hashchange", followLegacyLink);
    window.addEventListener("popstate", followLegacyLink);
    return () => {
      window.removeEventListener("hashchange", followLegacyLink);
      window.removeEventListener("popstate", followLegacyLink);
    };
  }, []);
  return null;
}
