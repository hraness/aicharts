import { JsonLd } from "@/components/catalog/json-ld";
import { ReleaseExplorer } from "@/components/release-explorer";
import { BENCHMARK_SOURCES, withBenchmarkSnapshots } from "@/lib/benchmark-snapshots";
import { dataset, SITE_URL } from "@/lib/catalog";

const explorerDataset = withBenchmarkSnapshots(dataset);

export default function HomePage() {
  return (
    <>
      <ReleaseExplorer dataset={explorerDataset} benchmarkSources={BENCHMARK_SOURCES} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebSite",
              "@id": `${SITE_URL}/#website`,
              url: SITE_URL,
              name: "aicharts",
              description:
                "Compare the cost of reasoning effort on Argo-Bench, GameBench 2, Roboflow and IronBee, with Terminal-Bench and Epoch AI results for Anthropic, OpenAI and Google models.",
              publisher: { "@id": "https://hraness.com/#organization" },
            },
            {
              "@type": "Organization",
              "@id": "https://hraness.com/#organization",
              name: "Hraness",
              url: "https://hraness.com",
            },
          ],
        }}
      />
    </>
  );
}
