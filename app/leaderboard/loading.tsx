import { SiteHeader } from "@/components/site-header";
import "@/styles/usage.css";

export default function LeaderboardLoading() {
  return <>
    <SiteHeader current="/leaderboard" />
    <main tabIndex={-1} className="usage-home leaderboard-home" id="main-content">
      <section className="usage-hero" aria-labelledby="leaderboard-loading-title">
        <div className="usage-hero__copy">
          <p className="usage-hero__title" id="leaderboard-loading-title">Public usage leaderboard</p>
          <p className="usage-hero__lede" role="status">Loading the latest published rankings.</p>
        </div>
      </section>
    </main>
  </>;
}
