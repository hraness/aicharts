import type { Metadata } from "next";
import Link from "next/link";

import { ChartPageFooter } from "@/components/chart-navigation";
import { SiteHeader } from "@/components/site-header";
import { DailyUsageDashboard } from "@/components/usage/daily-dashboard";
import { StatsDashboard } from "@/components/usage/stats-dashboard";
import { LeaderboardConsentControl } from "@/components/usage/leaderboard-consent";
import { UsageAccountControl } from "@/components/usage/account-control";
import { UsageTotalsPanel } from "@/components/usage/totals-panel";
import { usagePublicReadAvailable } from "@/lib/usage/auth-server";
import { usagePageConfiguration } from "@/lib/usage/private-days-page";
import { privateStatsEnabled } from "@/lib/usage/stats-page";

import "@/styles/usage.css";
import "@/styles/usage-dashboard.css";
import "@/styles/usage-leaderboard.css";
import "@/styles/usage-stats.css";
import "@/styles/usage-account.css";

export const metadata: Metadata = {
  title: "Usage dashboard | AI Charts",
  description: "Your private AI usage dashboard: tokens, models, costs, and source coverage across coding agents and AI clients.",
  robots: { index: false, follow: true },
  alternates: { canonical: "https://aicharts.io/dashboard" },
};

export default async function DashboardPage() {
  const configuration = await usagePageConfiguration();
  return <>
    <SiteHeader current="/dashboard" />
    <main tabIndex={-1} className="usage-home usage-home--stats" id="main-content">
      <nav className="usage-stats-nav" aria-label="Usage views"><Link href="/dashboard" aria-current="page">Account overview</Link><Link href="/usage/details">Detailed reports</Link><Link href="/usage/sessions">Sessions</Link><Link href="/leaderboard">Leaderboard</Link></nav>
      {configuration.available ? <>
        <UsageAccountControl returnTo="/dashboard" />
        {privateStatsEnabled() && <UsageTotalsPanel returnTo="/dashboard" />}
        {privateStatsEnabled() ? <StatsDashboard todayUtcDay={configuration.todayUtcDay} remoteEnabled startWithAccount returnTo="/dashboard" fallback={<DailyUsageDashboard todayUtcDay={configuration.todayUtcDay} returnTo="/dashboard" />} />
          : <DailyUsageDashboard key={configuration.todayUtcDay} todayUtcDay={configuration.todayUtcDay} returnTo="/dashboard" />}
        {!usagePublicReadAvailable() && <p className="usage-publishing-notice">Public rankings are paused. You can still review or withdraw your publishing consent below.</p>}
        <LeaderboardConsentControl returnTo="/dashboard" />
        <p><Link className="usage-inline-link" href="/usage/sessions">Inspect local sessions and model mix</Link></p>
      </> : <section className="usage-empty" aria-labelledby="dashboard-unavailable-title">
        <div>
          <h2 id="dashboard-unavailable-title">Your dashboard is unavailable right now</h2>
          <p>Private usage reads are paused; your saved measurements are unchanged. Local reports still open in this browser without an account.</p>
          <div className="usage-hero__actions">
            <Link className="usage-button usage-button--primary" href="/usage/details">Open a local report</Link>
            <Link className="usage-button usage-button--quiet" href="/usage">About usage tracking</Link>
          </div>
        </div>
      </section>}
      <ChartPageFooter />
    </main>
  </>;
}
