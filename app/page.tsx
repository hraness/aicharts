import { JsonLd } from "@/components/catalog/json-ld";
import { ReleaseExplorer } from "@/components/release-explorer";
import { dataset, SITE_URL } from "@/lib/catalog";

export default function HomePage() {
  return (
    <>
      <ReleaseExplorer dataset={dataset} />
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
                "Terminal-Bench scores, cost per task and API prices for AI model releases from OpenAI, Anthropic and Google.",
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
