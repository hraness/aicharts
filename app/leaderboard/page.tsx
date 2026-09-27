import { createPublicSiteMetadata } from "@hraness/web-discovery";

import { ChartPageFooter } from "@/components/chart-navigation";
import { SiteHeader } from "@/components/site-header";
import { searchSite } from "@/app/site";
import { LeaderboardView } from "@/components/usage/leaderboard-view";
import { leaderboardPageConfiguration, readLeaderboardSnapshot } from "@/lib/usage/leaderboard-page";

import "@/styles/usage.css";
import "@/styles/usage-leaderboard.css";

export const metadata = createPublicSiteMetadata({
  ...searchSite,
  title: "AI usage leaderboard | AI Charts",
  description: "An opt-in ranking of the AI tokens that accounts report from their coding agents and AI clients over 30 UTC days. Each entry shows its reporting window.",
}, { canonicalPath: "/leaderboard" });

export default async function LeaderboardPage() {
  const configuration = await leaderboardPageConfiguration();
  const snapshot = configuration.available ? await readLeaderboardSnapshot() : null;
  return <>
    <SiteHeader current="/leaderboard" />
    <main tabIndex={-1} className="usage-home leaderboard-home" id="main-content">
      <LeaderboardView available={configuration.available} snapshot={snapshot} />
      <ChartPageFooter />
    </main>
  </>;
}
