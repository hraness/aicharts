"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Existing shared chart links continue to reveal their destination. */
export function AdvancedCharts({ children }: Readonly<{ children: ReactNode }>) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const reveal = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.has("benchmark") || params.has("compare") || ["#intelligence-index", "#chart", "#model-updates"].includes(window.location.hash)) {
        if (ref.current) ref.current.open = true;
      }
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  return <details className="atlas-advanced" id="advanced-charts" ref={ref}><summary>Cost, speed, and token explorers<span>Explore the full Intelligence Index and coding-agent scatter plots.</span></summary>{children}</details>;
}
