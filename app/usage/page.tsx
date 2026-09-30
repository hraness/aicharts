import { ArticleFigure } from "@hraness/design-kit/react/server";
import { createPublicSiteMetadata } from "@hraness/web-discovery";
import Link from "next/link";

import { ChartPageFooter } from "@/components/chart-navigation";
import { UsageMockup } from "@/components/launch-mockups";
import { SiteHeader } from "@/components/site-header";
import { CopyCommand } from "@/components/usage/copy-command";
import {
  formatCheckedOn,
  homeAlternativesCheckedOn,
  searchSite,
  usageReleaseUrl,
} from "@/app/site";

import "@/styles/usage.css";

export const metadata = createPublicSiteMetadata({
  ...searchSite,
  title: "AI usage tracking | aicharts",
  description: "Track tokens, models, cost, and speed across your coding agents and AI clients, measured on your own machine and listed with the sources behind each total.",
}, { canonicalPath: "/usage" });

const steps = [
  ["01", "Build the collector", "Build the aicharts CLI from the aicharts GitHub repository with Rust. It reads token counts from your clients' local files. A few clients, such as Cursor and Warp, need a refresh step first."],
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

export default function UsagePage() {
  return <>
    <SiteHeader current="/usage" />
    <main tabIndex={-1} className="usage-home" id="main-content">
      <section className="usage-hero usage-hero--single" aria-labelledby="usage-title">
        <div className="usage-hero__copy">
          <p className="usage-eyebrow">Usage tracking</p>
          <h1 id="usage-title">See how many tokens your AI agents use</h1>
          <p className="usage-hero__lede">The aicharts collector counts tokens, cost, and speed for each model across the coding agents on your machine. Prompts, transcripts, file paths, and provider credentials stay on your machine, and each total lists the sources it covers.</p>
          <div className="usage-hero__actions">
            <Link className="usage-button usage-button--primary" href="/dashboard">Open your dashboard <span className="usage-button__arrow" aria-hidden="true">→</span></Link>
            <Link className="usage-button usage-button--quiet" href="#usage-setup">Set up tracking</Link>
          </div>
          <p className="usage-hero__note">In development. A Linux x86-64 build for local reports is on <a href={usageReleaseUrl}>GitHub Releases</a>; on a Mac, build from source. Account sync runs on macOS only.</p>
        </div>
      </section>

      <section className="usage-section usage-similar" aria-labelledby="usage-similar-title">
        <h2 id="usage-similar-title">Similar tools</h2>
        <p><a href="https://ccusage.com">ccusage</a> and <a href="https://tokscale.ai">Tokscale</a> also read coding agents&rsquo; local logs. ccusage runs without an install and prints daily, weekly, monthly, and session reports. Tokscale adds a web dashboard and a public leaderboard, and the aicharts collector builds on its open-source parsers. aicharts shows which sources each total covers, and on a Mac it can sync daily totals to your dashboard. Checked {formatCheckedOn(homeAlternativesCheckedOn)}.</p>
      </section>

      <section className="usage-section" id="usage-setup" aria-labelledby="usage-setup-title">
        <div className="usage-section__intro">
          <div><span className="usage-eyebrow">Setup</span><h2 id="usage-setup-title">Set up tracking in three steps</h2></div>
          <p>The collector runs on your machine. When it publishes, it uploads daily totals of tokens, cost, and time for each client and model, with each client&rsquo;s source coverage.</p>
        </div>
        <ol className="usage-steps">
          {steps.map(([step, title, description]) => <li className="usage-card usage-step" key={step}>
            <span className="usage-step__number" aria-hidden="true">{Number(step)}</span><h3>{title}</h3><p>{description}</p>
          </li>)}
        </ol>
        <CopyCommand command={'aicharts enroll --state-dir "$HOME/.aicharts/state"'} label="Collector setup command" note="then approve in browser" />
        <div className="usage-setup__foot">
          <Link className="usage-button usage-button--quiet usage-button--small" href="https://github.com/hraness/aicharts/blob/main/docs/usage-local.md#build-and-run">Build instructions <span className="usage-button__arrow" aria-hidden="true">↗</span></Link>
          <Link className="usage-button usage-button--quiet usage-button--small" href="https://github.com/hraness/aicharts/blob/main/docs/usage-autosubmit.md">Scheduled publication guide <span className="usage-button__arrow" aria-hidden="true">↗</span></Link>
        </div>
      </section>

      <section className="usage-section" aria-labelledby="usage-metrics-title">
        <div className="usage-section__intro">
          <div><span className="usage-eyebrow">Dashboard</span><h2 id="usage-metrics-title">What the dashboard shows</h2></div>
          <p>Every figure comes from the records your clients keep locally, reported per client, model, and UTC day.</p>
        </div>
        <ArticleFigure caption="The dashboard for a signed-in account, with made-up numbers." className="usage-preview" kind="illustration" width="wide">
          <UsageMockup />
        </ArticleFigure>
        <ul className="usage-metric-grid">
          {metrics.map(([window, title, description], index) => <li className="usage-card usage-metric-card" key={title} data-series={index % 5}>
            <span className="usage-metric-card__label"><i aria-hidden="true" />{window}</span><h3>{title}</h3><p>{description}</p>
          </li>)}
        </ul>
      </section>

      <section className="usage-section" aria-labelledby="usage-local-title">
        <div className="usage-card usage-local">
          <div>
            <span className="usage-eyebrow">No account needed</span>
            <h2 id="usage-local-title">Start with a local report</h2>
            <p>The collector writes a report file with token counts, known costs, and source coverage. The detailed reports page reads that file in your browser tab and does not upload it.</p>
          </div>
          <div>
            <CopyCommand command={'aicharts stats --home "$HOME" --all --json > usage-report.json'} label="Local-only report command" note="local only" />
            <Link className="usage-button usage-button--primary" href="/usage/details">Open a report <span className="usage-button__arrow" aria-hidden="true">→</span></Link>
          </div>
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
