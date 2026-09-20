import { createPublicSiteMetadata } from "@hraness/web-discovery";
import Link from "next/link";

import { ChartPageFooter } from "@/components/chart-navigation";
import { SiteHeader } from "@/components/site-header";
import { searchSite } from "@/app/site";
import { DailyUsageDashboard } from "@/components/usage/daily-dashboard";
import { StatsDashboard } from "@/components/usage/stats-dashboard";
import { LeaderboardConsentControl } from "@/components/usage/leaderboard-consent";
import { UsageAccountControl } from "@/components/usage/account-control";
import { usagePublicReadAvailable } from "@/lib/usage/auth-server";
import { usagePageConfiguration } from "@/lib/usage/private-days-page";
import { privateStatsEnabled } from "@/lib/usage/stats-page";

import "@/styles/usage.css";
import "@/styles/usage-dashboard.css";
import "@/styles/usage-leaderboard.css";
import "@/styles/usage-stats.css";
import "@/styles/usage-account.css";

export const metadata = createPublicSiteMetadata({
  ...searchSite,
  title: "AI usage analytics | AI Charts",
  description: "Inspect tokens, models, costs, and source coverage across coding agents and AI clients with private numeric usage reports.",
}, { canonicalPath: "/usage" });

const metrics = [
  ["Tokens", "Session totals", "Inspect input, output, and cache tokens from local numeric observations."],
  ["Models", "Model mix", "See which models appear in your records, with request and response attribution kept distinct."],
  ["Timing", "Measured time", "Inspect inference, waits, and concurrency when instrumented timing is available. Historical timing stays unknown."],
] as const;

export default async function UsagePage() {
  const configuration = await usagePageConfiguration();
  if (configuration.available) return <>
    <SiteHeader current="/usage" />
    <main className="usage-home usage-home--stats" id="main-content">
      <nav className="usage-stats-nav" aria-label="Usage views"><Link href="/usage" aria-current="page">Account overview</Link><Link href="/usage/details">Detailed reports</Link><Link href="/usage/sessions">Sessions</Link><Link href="/leaderboard">Leaderboard</Link></nav>
      <UsageAccountControl />
      {privateStatsEnabled() ? <StatsDashboard todayUtcDay={configuration.todayUtcDay} remoteEnabled startWithAccount fallback={<DailyUsageDashboard todayUtcDay={configuration.todayUtcDay} />} />
        : <DailyUsageDashboard key={configuration.todayUtcDay} todayUtcDay={configuration.todayUtcDay} />}
      {!usagePublicReadAvailable() && <p className="usage-publishing-notice">Public rankings are paused. You can still review or withdraw your publishing consent below.</p>}
      <LeaderboardConsentControl />
      <p><Link className="usage-inline-link" href="/usage/sessions">Inspect local sessions and model mix</Link></p>
      <ChartPageFooter />
    </main>
  </>;
  return <>
    <SiteHeader current="/usage" />
    <main className="usage-home" id="main-content">
      <section className="usage-hero" aria-labelledby="usage-title">
        <div className="usage-hero__copy">
          <h1 id="usage-title">Your AI usage</h1>
          <p className="usage-hero__lede">Compare usage across coding agents and AI clients, with exact token totals, model breakdowns, and clear source coverage.</p>
          <div className="usage-hero__actions">
            <Link className="usage-button usage-button--primary" href="/usage/details">Explore detailed usage</Link>
            <Link className="usage-button usage-button--quiet" href="/usage/sessions">Inspect session usage</Link>
            <Link className="usage-button usage-button--quiet" href="/leaderboard">Public leaderboard</Link>
          </div>
        </div>
        <aside className="usage-status" aria-label="Connection status">
          <span className="usage-status__dot" aria-hidden="true" />
          <div><strong>Local mode</strong><span>Your private dashboard is unavailable.</span></div>
        </aside>
      </section>

      <section className="usage-empty" aria-labelledby="usage-empty-title">
        <div>
          <h2 id="usage-empty-title">Start with a local report</h2>
          <p>The collector creates numeric reports with tokens, known costs, and source coverage. Prompts, source paths, and credentials stay out of the report. Open it in Detailed reports to explore your usage.</p>
          <div className="usage-terminal" aria-label="Local-only report example"><code>aicharts stats --home &quot;$HOME&quot; --all --json &gt; usage-report.json</code><span>local only</span></div>
          <Link className="usage-inline-link" href="https://github.com/hraness/aicharts/blob/main/docs/usage-details.md">Create a detailed usage report</Link>
        </div>
      </section>

      <section className="usage-metric-band" aria-labelledby="usage-metrics-title">
        <div className="usage-section-heading"><h2 id="usage-metrics-title">Available in usage reports</h2><span>Coverage stays attached</span></div>
        <div className="usage-metric-list">
          {metrics.map(([window, title, description]) => <article className="usage-metric-row" key={title}>
            <span className="usage-metric-row__window">{window}</span><h3>{title}</h3><p>{description}</p>
          </article>)}
        </div>
      </section>

      <section className="usage-trust" aria-labelledby="usage-trust-title">
        <div><h2 id="usage-trust-title">Understand the coverage</h2><p>Nothing here is a bill, a productivity score, or proof of a human prompt. Numeric measurements remain partial until their source coverage is qualified.</p></div>
        <ul><li>Source coverage shown</li><li>No transcript uploads</li><li>Explicit public consent</li><li>Reversible enrollment</li></ul>
      </section>
      <ChartPageFooter />
    </main>
  </>;
}
