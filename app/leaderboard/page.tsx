import { createPublicSiteMetadata } from "@hraness/web-discovery";
import Link from "next/link";

import { ChartPageFooter } from "@/components/chart-navigation";
import { SiteHeader } from "@/components/site-header";
import { searchSite } from "@/app/site";

import "@/styles/usage.css";

export const metadata = createPublicSiteMetadata({
  ...searchSite,
  title: "AI usage leaderboard | AI Charts",
  description: "An opt-in leaderboard for comparable, numeric Codex and Claude Code usage measurements.",
}, { canonicalPath: "/leaderboard" });

export default function LeaderboardPage() {
  return <>
    <SiteHeader current="/leaderboard" />
    <main className="usage-home leaderboard-home" id="main-content">
      <section className="usage-hero" aria-labelledby="leaderboard-title">
        <div className="usage-hero__copy">
          <p className="usage-hero__eyebrow">Public usage · opt in</p>
          <h1 id="leaderboard-title">A leaderboard that shows its receipts.</h1>
          <p className="usage-hero__lede">Rankings will use bounded numeric measurements with coverage, freshness, and consent beside every result. There is no public data yet.</p>
          <div className="usage-hero__actions"><Link className="usage-button usage-button--primary" href="/usage">Explore personal analytics <span aria-hidden="true">↗</span></Link></div>
        </div>
        <aside className="usage-status usage-status--paused" aria-label="Leaderboard status"><span className="usage-status__dot" aria-hidden="true" /><div><strong>Publishing paused</strong><span>Admission and moderation are still being qualified.</span></div></aside>
      </section>
      <section className="usage-empty" aria-labelledby="leaderboard-empty-title">
        <div className="usage-empty__index" aria-hidden="true">02</div>
        <div><h2 id="leaderboard-empty-title">No rankings before the evidence layer</h2><p>AI Charts will not turn a local counter into a public claim. A future entry will carry its measurement scope, source coverage, account consent, and correction history.</p><Link className="usage-inline-link" href="/data">Inspect the measurement contract <span aria-hidden="true">↗</span></Link></div>
      </section>
      <section className="usage-trust" aria-labelledby="leaderboard-trust-title"><div><h2 id="leaderboard-trust-title">Comparable does not mean universal.</h2><p>Different providers expose different evidence. The leaderboard will keep provider, model, subscription, and coverage dimensions distinct instead of collapsing them into one score.</p></div><ul><li>Provider-aware cohorts</li><li>Unknown stays unknown</li><li>Corrections are visible</li><li>Deletion is durable</li></ul></section>
      <ChartPageFooter />
    </main>
  </>;
}
