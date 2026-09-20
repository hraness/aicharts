import type { Metadata } from "next";
import Link from "next/link";
import { ChartPageFooter } from "@/components/chart-navigation";
import { SiteHeader } from "@/components/site-header";
import { StatsDashboard } from "@/components/usage/stats-dashboard";
import { usagePageConfiguration } from "@/lib/usage/private-days-page";
import { privateStatsEnabled } from "@/lib/usage/stats-page";
import "@/styles/usage.css";
import "@/styles/usage-stats.css";

export const metadata: Metadata = {
  title: "Detailed usage | AI Charts",
  description: "Inspect numeric AI usage by client, model, and day with exact totals and explicit coverage.",
  robots: { index: false, follow: true },
  alternates: { canonical: "https://aicharts.io/usage/details" },
};

export default async function DetailedUsagePage() {
  const configuration = await usagePageConfiguration();
  return <><SiteHeader current="/usage" /><main className="usage-home usage-home--stats" id="main-content">
    <nav className="usage-stats-nav" aria-label="Usage views"><Link href="/usage">Account overview</Link><Link href="/usage/details" aria-current="page">Detailed reports</Link><Link href="/usage/sessions">Sessions</Link><Link href="/leaderboard">Leaderboard</Link></nav>
    <StatsDashboard todayUtcDay={configuration.todayUtcDay} remoteEnabled={privateStatsEnabled()} />
    <ChartPageFooter />
  </main></>;
}
