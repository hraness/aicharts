import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { LocalHardware } from "@/components/local-hardware";
import { LocalQuality } from "@/components/local-quality";
import { workloads } from "@/lib/local-quality";
import { pageMetadata } from "@/journal/content";
import { VisionExplorer } from "@/components/vision-explorer";
import { defaultVision,visionExperiments } from "@/lib/vision-bench";
import { visionRows } from "@/lib/vision-file";
import "./local.css";

export const metadata = pageMetadata(
  "Local AI benchmarks by device and workload",
  "Compare published speeds and memory measurements on your hardware, then explore model quality by task and evaluation.",
  "/local",
);

export default async function LocalBenchmarksPage() {
  const first = workloads[0]!;
  return <article className="catalog-page">
    <Breadcrumbs trail={[{ name: "Local benchmarks", href: "/local" }]} />
    <header className="page-head"><h1>Local AI benchmarks</h1><p>Compare model quality, see how speed changes with memory, or explore {visionExperiments.reduce((sum,test)=>sum+test.count,0).toLocaleString()} image-classification timings by hardware.</p></header>
    <nav className="local-section-links" aria-label="Explore local AI">
      <a href="#quality">Model quality</a>
      <a href="#vision-frontier">Speed–accuracy frontier</a>
      <a href="/local/devices">Browse devices</a>
      <a href="#hardware">Device speeds and memory</a>
      <a href="/local/models">Find downloadable models</a>
    </nav>
    <LocalQuality workload={first} metric={first} />
    <VisionExplorer initial={defaultVision} initialRows={await visionRows(defaultVision)}/>
    <LocalHardware />
    <p><a href="/api/local">Download benchmarks and sources (JSON)</a></p>
  </article>;
}
