import { SiteHeader } from "@/components/site-header";
import "@/styles/usage.css";

export default function LeaderboardLoading() {
  return <>
    <SiteHeader current="/leaderboard" />
    <main className="usage-home leaderboard-home" id="main-content">
      <section className="usage-hero" aria-labelledby="leaderboard-loading-title">
        <div className="usage-hero__copy">
          <h1 id="leaderboard-loading-title">Public usage leaderboard</h1>
          <p className="usage-hero__lede" role="status">Loading the latest published rankings.</p>
        </div>
      </section>
    </main>
  </>;
}
