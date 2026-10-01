import { RouteNotFoundPage } from "@hraness/design-kit/react";
import { createPrivateSiteMetadata } from "@hraness/web-discovery";

import { NotFoundAnalytics } from "@/components/not-found-analytics";
import { SiteHeader } from "@/components/site-header";
import { homePrimaryAction, notFoundSearchSite, site } from "./site";
import sitemap from "./sitemap";

export const metadata = createPrivateSiteMetadata(notFoundSearchSite);

const ROUTE_LABEL_LIMIT = 48;

/** The sitemap's paths, compared with a missing address for "Did you mean". */
function knownPages(): readonly Readonly<{ href: string; label: string }>[] {
  return sitemap().map(({ url }) => {
    const href = new URL(url).pathname;
    const label = href === "/" ? site.name : href;
    return {
      href,
      label: label.length <= ROUTE_LABEL_LIMIT ? label : `${label.slice(0, ROUTE_LABEL_LIMIT - 1)}…`,
    };
  });
}

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <NotFoundAnalytics />
      <div className="hraness-site-shell__content" data-analytics-surface="error_recovery" id="main-content">
        <RouteNotFoundPage
          agentIndexHref="/llms.txt"
          next={[
            {
              href: "/models",
              label: "Models",
              description: "Intelligence Index scores, cost per task, and coding-agent results for each model.",
            },
            {
              href: "/coding",
              label: "Coding agents",
              description: "Compare coding-agent setups by score, cost, time, and tokens per task.",
            },
            {
              href: "/usage",
              label: "Measure your agent",
              description: "Count your own agents’ tokens, models, and cost on your machine.",
            },
          ]}
          primaryAction={homePrimaryAction}
          routes={knownPages()}
          siteName={site.name}
        />
      </div>
    </>
  );
}
