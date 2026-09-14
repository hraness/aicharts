import { createPublicSiteMetadata } from "@hraness/web-discovery";
import { BenchmarkAtlasExplorer } from "@/components/benchmark-atlas-explorer";
import { ChartPageFooter } from "@/components/chart-navigation";
import { SiteHeader } from "@/components/site-header";
import { ATLAS_DATASETS, ATLAS_ENTRIES } from "@/lib/benchmark-atlas-catalog";
import { searchSite } from "@/app/site";

import "@/styles/chart-home.css";

export const metadata = createPublicSiteMetadata({
  ...searchSite,
  title: "AI benchmark explorer | AI Charts",
  description: "Explore benchmarks for coding, reasoning, research, memory, images, video, audio, and world models. Compare configurations on the same test.",
}, { canonicalPath: "/benchmarks" });

export default function BenchmarksPage() {
  return <>
    <SiteHeader current="/benchmarks" />
    <main className="chart-home benchmarks-home" id="main-content">
      <header className="chart-page-intro"><h1>Explore benchmarks</h1><p>Choose a task, then compare models on the same test.</p><p className="chart-page-intro__coverage">{ATLAS_DATASETS.length} interactive charts · {ATLAS_ENTRIES.length} benchmarks and guides</p></header>
      <BenchmarkAtlasExplorer entries={ATLAS_ENTRIES} datasets={ATLAS_DATASETS} />
      <ChartPageFooter />
    </main>
  </>;
}
