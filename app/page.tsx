import { createPublicSiteMetadata } from "@hraness/web-discovery";
import { Suspense } from "react";
import codingAgentData from "@/data/coding-agents.json";
import { CodingAgentExplorer } from "@/components/coding-agent-explorer";
import { HomeDocument } from "@/components/home-document";
import { HomeLeaders } from "@/components/home-leaders";
import { RouteLoadingState } from "@/components/route-state";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import { MODEL_CARD_VARIANTS } from "@/lib/model-card-collection";
import { homeDocumentModel } from "@/lib/site-markdown";

import { searchSite, site } from "./site";

export const metadata = createPublicSiteMetadata(searchSite, { canonicalPath: "/" });

export default function Home() {
  const input: unknown = codingAgentData;
  const parsed = parseCodingAgentSnapshot(input);
  if (!parsed.ok) throw new Error(`Checked coding-agent snapshot is invalid: ${parsed.error.message}`, { cause: parsed.error });
  const modelCardPaths = Object.fromEntries(MODEL_CARD_VARIANTS.flatMap(variant => (
    variant.observations.map(observation => [observation.id, variant.path] as const)
  )));
  return (
    <>
      <Suspense fallback={<RouteLoadingState />}>
        <CodingAgentExplorer
          brand={{ domain: site.domain, heading: site.domain }}
          modelCardPaths={modelCardPaths}
          snapshot={parsed.value}
        >
          <HomeLeaders snapshot={parsed.value} />
          <HomeDocument document={homeDocumentModel(parsed.value)} snapshot={parsed.value} />
        </CodingAgentExplorer>
      </Suspense>
    </>
  );
}
