import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { LocalHardware } from "@/components/local-hardware";
import { LocalQuality } from "@/components/local-quality";
import { workloads } from "@/lib/local-quality";
import { pageMetadata } from "@/journal/content";
import "./local.css";

export const metadata = pageMetadata(
  "Local AI benchmarks by device and workload",
  "Compare published speeds and memory measurements on your hardware, then explore model quality by task and evaluation.",
  "/local",
);

export default function LocalBenchmarksPage() {
  const first = workloads[0]!;
  return <article className="catalog-page">
    <Breadcrumbs trail={[{ name: "Local benchmarks", href: "/local" }]} />
    <header className="page-head"><h1>Local AI benchmarks</h1></header>
    <nav className="local-section-links" aria-label="Explore local AI">
      <a href="#quality">Model quality</a>
      <a href="#hardware">Device speeds and memory</a>
      <a href="/local/models">Find downloadable models</a>
    </nav>
    <LocalQuality workload={first} metric={first} />
    <LocalHardware />
    <p><a href="/api/local">Download benchmarks and sources (JSON)</a></p>
  </article>;
}
