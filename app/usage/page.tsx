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
  description: "Track tokens, models, cost, and speed across your coding agents and AI clients, measured on your own machine and listed with the sources behind each total.",
}, { canonicalPath: "/usage" });

const steps = [
  ["01", "Build the collector", "Build the aicharts CLI from the AI Charts GitHub repository with Rust. It reads token counts from your clients' local files. A few clients, such as Cursor and Warp, need a refresh step first."],
  ["02", "Connect your account", "On a Mac, run aicharts enroll and approve the pairing in your browser. Each enrolled Mac reports to one account."],
  ["03", "Publish on a schedule", "Set up a launchd job that runs aicharts autosubmit. Each run refreshes your clients and uploads their latest totals, so your dashboard stays current without manual exports."],
] as const;

const metrics = [
  ["Tokens", "Token types", "Input, cache read, cache write, output, and reasoning tokens are counted separately."],
  ["Cost", "Reported vs retail", "Provider-reported spend beside an estimate at public prices from the models.dev catalog, with the difference between them."],
  ["Speed", "Tokens per second", "Measured over the request durations that clients record, per model and per day. This is not the model's inference speed."],
  ["Cache", "Cache reads", "The share of input tokens served from cache, so you can see where prompt caching helps."],
  ["Coverage", "Source coverage", "Each report lists every client it checked and whether it had data, was empty, was not found, or could not be read in full, so missing sources stay visible."],
  ["Clients", "55 sources", "Codex, Claude Code, Cursor, Devin, OpenCode, Warp, and the other supported sources, reported together. Run aicharts stats --list-clients for the full list."],
] as const;

export default async function UsagePage() {
  const configuration = await usagePageConfiguration();
  return <>
    <SiteHeader current="/usage" />
    <main tabIndex={-1} className="usage-home" id="main-content">
      <section className="usage-hero" aria-labelledby="usage-title">
        <div className="usage-hero__copy">
          <h1 id="usage-title">See how many tokens your AI agents use</h1>
          <p className="usage-hero__lede">The AI Charts collector counts tokens, cost, and speed for each model across the coding agents on your machine. Prompts, transcripts, file paths, and provider credentials stay on your machine, and each total lists the sources it covers.</p>
          <div className="usage-hero__actions">
            {configuration.available
              ? <Link className="usage-button usage-button--primary" href="/dashboard">Open your dashboard</Link>
              : <Link className="usage-button usage-button--primary" href="/usage/details">Open a local report</Link>}
            <Link className="usage-button usage-button--quiet" href="#usage-setup">Set up tracking</Link>
            <Link className="usage-button usage-button--quiet" href="/leaderboard">Public leaderboard</Link>
          </div>
        </div>
        <aside className="usage-status" aria-label="Status">
          <span className="usage-status__dot" aria-hidden="true" />
          <div>
            <strong>In development</strong>
            <span>The collector has no packaged release yet. Build it from source. Account sync runs on macOS only.</span>
            {configuration.available ? null : <span>Your online dashboard is paused. Local reports still work.</span>}
          </div>
        </aside>
      </section>

      <section className="usage-empty" id="usage-setup" aria-labelledby="usage-setup-title">
        <div>
          <h2 id="usage-setup-title">Set up tracking in three steps</h2>
          <p>The collector runs on your machine. When it publishes, it uploads daily totals of tokens, cost, and time for each client and model, with each client&rsquo;s source coverage.</p>
          <div className="usage-metric-list" role="list">
            {steps.map(([step, title, description]) => <article className="usage-metric-row" key={step} role="listitem">
              <span className="usage-metric-row__window">{step}</span><h3>{title}</h3><p>{description}</p>
            </article>)}
          </div>
          <div className="usage-terminal" aria-label="Collector setup commands"><code>aicharts enroll --state-dir &quot;$HOME/.aicharts/state&quot;</code><span>then approve in browser</span></div>
          <div className="usage-inline-links">
            <Link className="usage-inline-link" href="https://github.com/hraness/aicharts/blob/main/docs/usage-local.md#build-and-run">Build instructions</Link>
            <Link className="usage-inline-link" href="https://github.com/hraness/aicharts/blob/main/docs/usage-autosubmit.md">Scheduled publication guide</Link>
          </div>
        </div>
      </section>

      <section className="usage-metric-band" aria-labelledby="usage-metrics-title">
        <div className="usage-section-heading"><h2 id="usage-metrics-title">What the dashboard shows</h2></div>
        <div className="usage-metric-list">
          {metrics.map(([window, title, description]) => <article className="usage-metric-row" key={title}>
            <span className="usage-metric-row__window">{window}</span><h3>{title}</h3><p>{description}</p>
          </article>)}
        </div>
      </section>

      <section className="usage-empty" aria-labelledby="usage-local-title">
        <div>
          <h2 id="usage-local-title">Start with a local report</h2>
          <p>No account needed. The collector writes a report file with token counts, known costs, and source coverage. The detailed reports page reads that file in your browser tab and does not upload it.</p>
          <div className="usage-terminal" aria-label="Local-only report example"><code>aicharts stats --home &quot;$HOME&quot; --all --json &gt; usage-report.json</code><span>local only</span></div>
          <Link className="usage-inline-link" href="/usage/details">Open a report</Link>
        </div>
      </section>

      <section className="usage-trust" aria-labelledby="usage-trust-title">
        <div><h2 id="usage-trust-title">What the numbers mean</h2><p>A total counts only what each client records in its local files, and it lists the sources it covers. It isn&rsquo;t a bill or a productivity score, and a counted request may have come from an agent rather than a person.</p></div>
        <ul><li>Source coverage shown</li><li>No transcript uploads</li><li>Public ranking only if you opt in</li></ul>
      </section>
      <ChartPageFooter />
    </main>
  </>;
}
