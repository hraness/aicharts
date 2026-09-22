import { createPublicSiteMetadata } from "@hraness/web-discovery";
import Link from "next/link";

import { ChartPageFooter } from "@/components/chart-navigation";
import { SiteHeader } from "@/components/site-header";
import { searchSite } from "@/app/site";
import { usagePageConfiguration } from "@/lib/usage/private-days-page";

import "@/styles/usage.css";

export const metadata = createPublicSiteMetadata({
  ...searchSite,
  title: "AI usage tracking | AI Charts",
  description: "Track tokens, models, costs, and speed across coding agents and AI clients — measured on your own machine, with source coverage attached to every number.",
}, { canonicalPath: "/usage" });

const steps = [
  ["01", "Install the collector", "The aicharts CLI reads numeric usage from local client sources. Prompts, source paths, and provider credentials never leave your machine."],
  ["02", "Connect your account", "Enroll a device and approve the pairing in your browser. One verified account receives the numeric reports; every device can be revoked."],
  ["03", "Publish on a schedule", "A launchd job refreshes each client and submits a bounded snapshot. Your dashboard stays current without manual exports."],
] as const;

const metrics = [
  ["Tokens", "Exact splits", "Input, cache read, cache write, output, and reasoning tokens counted separately — never folded into one blended number."],
  ["Cost", "Reported vs retail", "Provider-reported spend beside a public-price estimate computed from the models.dev catalog, with the delta made explicit."],
  ["Speed", "Measured velocity", "Tokens per second while a client was reporting, per model and per day — labeled as observed throughput, not inference speed."],
  ["Cache", "Efficiency share", "The share of input served from cache, so prompt-caching improvements show up where they actually land."],
  ["Coverage", "Source ledger", "Every report lists which clients were checked, found, empty, or absent — missing sources stay visible instead of silent."],
  ["Clients", "55 sources", "Codex, Claude Code, Cursor, Devin, OpenCode, Warp, and the rest of the registry — one ledger across all of them."],
] as const;

export default async function UsagePage() {
  const configuration = await usagePageConfiguration();
  return <>
    <SiteHeader current="/usage" />
    <main className="usage-home" id="main-content">
      <section className="usage-hero" aria-labelledby="usage-title">
        <div className="usage-hero__copy">
          <h1 id="usage-title">See what your AI agents actually use</h1>
          <p className="usage-hero__lede">AI Charts measures tokens, models, cost, and speed across the coding agents on your machine — exact numbers with their source coverage attached, never a transcript.</p>
          <div className="usage-hero__actions">
            {configuration.available
              ? <Link className="usage-button usage-button--primary" href="/dashboard">Open your dashboard</Link>
              : <Link className="usage-button usage-button--primary" href="/usage/details">Open a local report</Link>}
            <Link className="usage-button usage-button--quiet" href="#usage-setup">Set up tracking</Link>
            <Link className="usage-button usage-button--quiet" href="/leaderboard">Public leaderboard</Link>
          </div>
        </div>
        <aside className="usage-status" aria-label="Connection status">
          <span className="usage-status__dot" aria-hidden="true" />
          {configuration.available
            ? <div><strong>Tracking enabled</strong><span>Sign in on your dashboard to view your account.</span></div>
            : <div><strong>Local mode</strong><span>Private reads are paused; local reports still work.</span></div>}
        </aside>
      </section>

      <section className="usage-empty" id="usage-setup" aria-labelledby="usage-setup-title">
        <div>
          <h2 id="usage-setup-title">Set up tracking in three steps</h2>
          <p>The collector runs on your machine and reports only numeric measurements. Enrollment, pairing, and each scheduled publish are explicit, reversible steps.</p>
          <div className="usage-metric-list" role="list">
            {steps.map(([step, title, description]) => <article className="usage-metric-row" key={step} role="listitem">
              <span className="usage-metric-row__window">{step}</span><h3>{title}</h3><p>{description}</p>
            </article>)}
          </div>
          <div className="usage-terminal" aria-label="Collector setup commands"><code>aicharts enroll --state-dir &quot;$HOME/.aicharts/state&quot;</code><span>then approve in browser</span></div>
          <Link className="usage-inline-link" href="https://github.com/hraness/aicharts/blob/main/docs/usage-autosubmit.md">Scheduled publication guide</Link>
        </div>
      </section>

      <section className="usage-metric-band" aria-labelledby="usage-metrics-title">
        <div className="usage-section-heading"><h2 id="usage-metrics-title">What the dashboard shows</h2><span>Coverage stays attached</span></div>
        <div className="usage-metric-list">
          {metrics.map(([window, title, description]) => <article className="usage-metric-row" key={title}>
            <span className="usage-metric-row__window">{window}</span><h3>{title}</h3><p>{description}</p>
          </article>)}
        </div>
      </section>

      <section className="usage-empty" aria-labelledby="usage-local-title">
        <div>
          <h2 id="usage-local-title">Start with a local report</h2>
          <p>No account needed. The collector creates numeric reports with tokens, known costs, and source coverage — the file is read entirely inside your browser.</p>
          <div className="usage-terminal" aria-label="Local-only report example"><code>aicharts stats --home &quot;$HOME&quot; --all --json &gt; usage-report.json</code><span>local only</span></div>
          <Link className="usage-inline-link" href="/usage/details">Open a report in Detailed reports</Link>
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
