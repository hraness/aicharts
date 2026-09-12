import { createPublicSiteMetadata } from "@hraness/web-discovery";
import Link from "next/link";

import { ChartPageFooter } from "@/components/chart-navigation";
import { SiteHeader } from "@/components/site-header";
import { searchSite } from "@/app/site";

import "@/styles/usage.css";

export const metadata = createPublicSiteMetadata({
  ...searchSite,
  title: "AI usage analytics | AI Charts",
  description: "A privacy-first home for numeric Codex and Claude Code usage measurements.",
}, { canonicalPath: "/usage" });

const metrics = [
  ["15 min", "Activity windows", "See when work happened without exposing what was said."],
  ["Daily", "Turn shape", "Runtime, tokens, and tool calls with separate coverage denominators."],
  ["Hourly", "Throughput", "Messages, tokens per second, and concurrent agents without transcript data."],
] as const;

export default function UsagePage() {
  return <>
    <SiteHeader current="/usage" />
    <main className="usage-home" id="main-content">
      <section className="usage-hero" aria-labelledby="usage-title">
        <div className="usage-hero__copy">
          <p className="usage-hero__eyebrow">AI Charts Usage</p>
          <h1 id="usage-title">Your AI work, measured without your words.</h1>
          <p className="usage-hero__lede">A local-first dashboard for Codex and Claude Code. It keeps transcripts out of the product and makes every unknown visible.</p>
          <div className="usage-hero__actions">
            <Link className="usage-button usage-button--primary" href="/data">Read the data contract <span aria-hidden="true">↗</span></Link>
            <Link className="usage-button usage-button--quiet" href="/leaderboard">See the public boundary <span aria-hidden="true">↗</span></Link>
          </div>
        </div>
        <aside className="usage-status" aria-label="Connection status">
          <span className="usage-status__dot" aria-hidden="true" />
          <div><strong>Local mode</strong><span>Remote sync is not enabled yet.</span></div>
        </aside>
      </section>

      <section className="usage-empty" aria-labelledby="usage-empty-title">
        <div className="usage-empty__index" aria-hidden="true">01</div>
        <div>
          <h2 id="usage-empty-title">Connect a reviewed local collector</h2>
          <p>The open-source CLI reads only the numeric fields needed for measurement. It does not copy session logs, prompts, tool inputs, responses, credentials, or source paths into its ledger.</p>
          <div className="usage-terminal" aria-label="Local-only setup example"><code>aicharts usage --key-file ./aicharts.key --codex ./sessions</code><span>local only</span></div>
        </div>
      </section>

      <section className="usage-metric-band" aria-labelledby="usage-metrics-title">
        <div className="usage-section-heading"><h2 id="usage-metrics-title">What the dashboard will show</h2><span>Coverage stays attached</span></div>
        <div className="usage-metric-list">
          {metrics.map(([window, title, description]) => <article className="usage-metric-row" key={title}>
            <span className="usage-metric-row__window">{window}</span><h3>{title}</h3><p>{description}</p>
          </article>)}
        </div>
      </section>

      <section className="usage-trust" aria-labelledby="usage-trust-title">
        <div><h2 id="usage-trust-title">The boundary is the feature.</h2><p>Nothing here is a bill, a productivity score, or proof of a human prompt. Numeric measurements remain partial until their source coverage is qualified.</p></div>
        <ul><li>Codex and Claude Code first</li><li>No transcript storage</li><li>Explicit public consent</li><li>Reversible enrollment</li></ul>
      </section>
      <ChartPageFooter />
    </main>
  </>;
}
