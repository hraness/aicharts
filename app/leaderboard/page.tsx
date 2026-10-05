import { createPublicSiteMetadata } from "@hraness/web-discovery";

import { ChartPageFooter } from "@/components/chart-navigation";
import { SiteHeader } from "@/components/site-header";
import { searchSite } from "@/app/site";
import { LeaderboardView } from "@/components/usage/leaderboard-view";
import { leaderboardPageConfiguration, readLeaderboardSnapshot } from "@/lib/usage/leaderboard-page";

import "@/styles/usage.css";
import "@/styles/usage-leaderboard.css";

/**
 * The leaderboard stays noindex until it has enough opt-in entries to be
 * useful to a visitor (docs/seo-strategy.md; reassess 2026-11-28).
 */
export const metadata = {
  ...createPublicSiteMetadata({
    ...searchSite,
    title: "AI usage leaderboard | aicharts",
    description: "An opt-in ranking of the AI tokens that accounts report from their coding agents and AI clients over 30 UTC days. Each entry shows its reporting window.",
  }, { canonicalPath: "/leaderboard" }),
  robots: { index: false, follow: true },
};

export default async function LeaderboardPage() {
  const configuration = await leaderboardPageConfiguration();
  const snapshot = configuration.available ? await readLeaderboardSnapshot() : null;
  return <>
    <SiteHeader current="/leaderboard" />
    <main data-hraness-landscape="page" tabIndex={-1} className="usage-home leaderboard-home" id="main-content">
      <LeaderboardView available={configuration.available} snapshot={snapshot} />
      <ChartPageFooter />
    </main>
  </>;
}
