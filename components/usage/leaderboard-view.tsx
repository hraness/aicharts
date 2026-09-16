import Link from "next/link";

import {
  LEADERBOARD_WINDOW_DAYS, type LeaderboardEntryV1, type LeaderboardSnapshotV1,
} from "@/lib/usage/leaderboard-contract";

const number = new Intl.NumberFormat("en-US");
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const time = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const tokens = (value: string) => number.format(BigInt(value));
const day = (utcDay: number) => date.format(new Date(utcDay * 86_400_000));

export interface LeaderboardViewProps {
  /** The production public-read fence. Off renders the honest paused state. */
  available: boolean;
  /** The materialized snapshot, or null when the index cannot answer. */
  snapshot: LeaderboardSnapshotV1 | null;
}

function Entry({ entry }: { entry: LeaderboardEntryV1 }) {
  return <tr>
    <th scope="row">{entry.rank}</th>
    <td className="usage-board__handle">{entry.publicHandle}</td>
    <td>{tokens(entry.observedTokens)}</td>
    <td>{number.format(entry.usageRecords)}</td>
    <td>
      <time dateTime={new Date(entry.refreshedAtMs).toISOString()}>{time.format(entry.refreshedAtMs)} UTC</time>
    </td>
  </tr>;
}

/** The public leaderboard surface. It renders exactly three honest states —
 * ranked rows, an empty index, or the paused state — and never fabricates
 * data. Every row carries its coverage window and verification freshness. */
export function LeaderboardView({ available, snapshot }: LeaderboardViewProps) {
  const live = available && snapshot !== null;
  const entries = snapshot?.entries ?? [];
  const published = entries.length;
  return <>
    <section className="usage-hero" aria-labelledby="leaderboard-title">
      <div className="usage-hero__copy">
        <p className="usage-hero__eyebrow">Public usage · opt in</p>
        <h1 id="leaderboard-title">A leaderboard that shows its receipts.</h1>
        <p className="usage-hero__lede">Ranked by total observed accounted tokens over the trailing {LEADERBOARD_WINDOW_DAYS} UTC days, across Codex, Claude Code and Devin. Coverage, freshness, and consent sit beside every result.</p>
        <div className="usage-hero__actions"><Link className="usage-button usage-button--primary" href="/usage">Explore personal analytics <span aria-hidden="true">↗</span></Link></div>
      </div>
      {live
        ? <aside className="usage-status" aria-label="Leaderboard status">
            <span className="usage-status__dot" aria-hidden="true" />
            <div><strong>Opt-in publishing</strong>
              <span>{number.format(published)} {published === 1 ? "entry" : "entries"} · updated <time dateTime={new Date(snapshot.computedAtMs).toISOString()}>{time.format(snapshot.computedAtMs)} UTC</time></span>
            </div>
          </aside>
        : <aside className="usage-status usage-status--paused" aria-label="Leaderboard status">
            <span className="usage-status__dot" aria-hidden="true" />
            <div><strong>Publishing paused</strong><span>Public reads are disabled while qualification continues.</span></div>
          </aside>}
    </section>
    {live && published > 0
      ? <section className="usage-board" aria-labelledby="leaderboard-board-title">
          <div className="usage-section-heading"><h2 id="leaderboard-board-title">Published rankings</h2><span>Observed tokens · {LEADERBOARD_WINDOW_DAYS}d window</span></div>
          <div className="usage-board__table-scroll" role="region" aria-label="Public usage rankings" tabIndex={0}>
            <table className="usage-board__table">
              <caption>Ranked opt-in accounts by observed accounted tokens, {day(entries[0]!.windowFirstUtcDay)}–{day(entries[0]!.windowFirstUtcDay + entries[0]!.windowUtcDays - 1)}. Every row is the account&rsquo;s own consented projection.</caption>
              <thead><tr>
                <th scope="col">Rank</th><th scope="col">Handle</th><th scope="col">Observed tokens</th>
                <th scope="col">Usage records</th><th scope="col">Verified</th>
              </tr></thead>
              <tbody>{entries.map(entry => <Entry entry={entry} key={entry.publicHandle} />)}</tbody>
            </table>
          </div>
          <p className="usage-board__hint">Handles are chosen at consent time. Rows carry no email, account, or device identifier. Verification times show each row&rsquo;s freshness; a stale row means its source could not be re-read yet.</p>
        </section>
      : live
        ? <section className="usage-empty" aria-labelledby="leaderboard-empty-title">
            <div className="usage-empty__index" aria-hidden="true">02</div>
            <div><h2 id="leaderboard-empty-title">No published entries yet</h2><p>The materialized index is live but empty. Entries appear only after an account explicitly opts in from its private dashboard, chooses a public handle, and the index verifies the projection at the account object.</p><Link className="usage-inline-link" href="/usage">Manage your publishing consent <span aria-hidden="true">↗</span></Link></div>
          </section>
        : <section className="usage-empty" aria-labelledby="leaderboard-empty-title">
            <div className="usage-empty__index" aria-hidden="true">02</div>
            <div><h2 id="leaderboard-empty-title">No rankings before the evidence layer</h2><p>AI Charts will not turn a local counter into a public claim. When public reads are enabled, entries carry their measurement scope, source coverage, account consent, and correction history.</p><Link className="usage-inline-link" href="/data">Inspect the measurement contract <span aria-hidden="true">↗</span></Link></div>
          </section>}
    <section className="usage-trust" aria-labelledby="leaderboard-trust-title"><div><h2 id="leaderboard-trust-title">Comparable does not mean universal.</h2><p>Different providers expose different evidence. The leaderboard keeps provider, model, subscription, and coverage dimensions distinct instead of collapsing them into one score.</p></div><ul><li>Provider-aware cohorts</li><li>Unknown stays unknown</li><li>Corrections are visible</li><li>Deletion is durable</li></ul></section>
  </>;
}
