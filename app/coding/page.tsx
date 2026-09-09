import { createPublicSiteMetadata } from "@hraness/web-discovery";
import { Suspense } from "react";
import Link from "next/link";
import codingAgentData from "@/data/coding-agents.json";
import { ChartNavigation, ChartPageFooter } from "@/components/chart-navigation";
import { CodingAgentExplorer } from "@/components/coding-agent-explorer";
import { RouteLoadingState } from "@/components/route-state";
import { SiteHeader } from "@/components/site-header";
import { MODEL_CARD_VARIANTS } from "@/lib/model-card-collection";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import { searchSite, site } from "@/app/site";

import "@/styles/chart-home.css";

export const metadata = createPublicSiteMetadata({
  ...searchSite,
  title: "Coding agent comparisons | AI Charts",
  description: "Compare coding-agent configurations by benchmark performance, task cost, time, and token use. Inspect the setup behind each result.",
}, { canonicalPath: "/coding" });

export default function CodingPage() {
  const parsed = parseCodingAgentSnapshot(codingAgentData);
  if (!parsed.ok) throw new Error(`Checked coding-agent snapshot is invalid: ${parsed.error.message}`, { cause: parsed.error });
  const modelCardPaths = Object.fromEntries(MODEL_CARD_VARIANTS.flatMap(variant => variant.observations.map(observation => [observation.id, variant.path] as const)));
  return <>
    <SiteHeader current="/coding" />
    <main className="chart-home coding-home" id="main-content">
      <header className="chart-page-intro"><h1>Coding agent comparisons</h1><p>Performance, cost, and time for the full model-and-agent setup.</p></header>
      <ChartNavigation current="/coding" />
      <Suspense fallback={<RouteLoadingState />}>
        <CodingAgentExplorer brand={{ domain: site.domain }} modelCardPaths={modelCardPaths} snapshot={parsed.value} />
      </Suspense>
      <section className="coding-benchmark-links" aria-label="More coding benchmarks">
        <h2>Other ways to measure coding</h2>
        <Link href="/benchmarks?atlas=terminal-bench-4&task=coding#explore">Terminal-Bench 4 <span>General terminal work ↗</span></Link>
        <Link href="/benchmarks?atlas=terminal-bench-science&task=science#explore">Terminal-Bench-Science <span>Scientific coding ↗</span></Link>
      </section>
      <ChartPageFooter />
    </main>
  </>;
}
