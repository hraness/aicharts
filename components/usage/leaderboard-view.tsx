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
    <td className="usage-board__coverage">{day(entry.windowFirstUtcDay)}<span>through {day(entry.windowFirstUtcDay + entry.windowUtcDays - 1)}</span></td>
    <td>
      <time dateTime={new Date(entry.refreshedAtMs).toISOString()}>{time.format(entry.refreshedAtMs)} UTC</time>
    </td>
  </tr>;
}

/** The public leaderboard surface distinguishes ranked rows, an empty index,
 * paused publication, and an unavailable read. It never fabricates
 * data. Every row carries its coverage window and refresh time. */
export function LeaderboardView({ available, snapshot }: LeaderboardViewProps) {
  const live = available && snapshot !== null;
  const entries = snapshot?.entries ?? [];
  const published = entries.length;
  return <>
    <section className="usage-hero" aria-labelledby="leaderboard-title">
      <div className="usage-hero__copy">
        <h1 id="leaderboard-title">Public usage leaderboard</h1>
        <p className="usage-hero__lede">Opt-in accounts ranked by locally reported tokens over {LEADERBOARD_WINDOW_DAYS} UTC days. Each entry shows its reporting window and last refresh.</p>
        <div className="usage-hero__actions"><Link className="usage-button usage-button--primary" href="/dashboard">View your usage</Link></div>
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
            <div><strong>{available ? "Rankings unavailable" : "Not live yet"}</strong><span>{available ? "The latest rankings could not be loaded." : "Public publishing has not opened."}</span></div>
          </aside>}
    </section>
    {live && published > 0
      ? <section className="usage-board" aria-labelledby="leaderboard-board-title">
          <div className="usage-section-heading"><h2 id="leaderboard-board-title">Published rankings</h2><span>Observed tokens · {LEADERBOARD_WINDOW_DAYS}d window</span></div>
          <div className="usage-board__table-scroll" role="region" aria-label="Public usage rankings" tabIndex={0}>
            <table className="usage-board__table">
              <caption>Opt-in accounts ranked by observed tokens. Reporting windows and refresh times may differ; coverage is partial.</caption>
              <thead><tr>
                <th scope="col">Rank</th><th scope="col">Handle</th><th scope="col">Observed tokens</th>
                <th scope="col">Usage records</th><th scope="col">Coverage (UTC)</th><th scope="col">Last refreshed</th>
              </tr></thead>
              <tbody>{entries.map(entry => <Entry entry={entry} key={entry.publicHandle} />)}</tbody>
            </table>
          </div>
          <p className="usage-board__hint">A refresh checks the account&rsquo;s saved consent and totals. Usage comes from local collectors; it is not independently verified or a provider billing record. Email, account, and device identifiers are not public.</p>
        </section>
      : live
        ? <section className="usage-empty" aria-labelledby="leaderboard-empty-title">
            <div><h2 id="leaderboard-empty-title">No published entries yet</h2><p>Accounts appear after their owners choose a public handle and enable publishing from their private usage dashboard.</p><Link className="usage-inline-link" href="/dashboard">Manage publishing</Link></div>
          </section>
        : <section className="usage-empty" aria-labelledby="leaderboard-empty-title">
            <div><h2 id="leaderboard-empty-title">{available ? "Rankings could not be loaded" : "No public rankings yet"}</h2>
              <p>{available ? "The leaderboard is temporarily unavailable. Reload to check again. Your private data and publishing choice are unchanged." : "Rankings appear here once publishing opens. Until then, you can inspect your own usage in a local session report."}</p>
              {available ? <a className="usage-inline-link" href="/leaderboard">Reload rankings</a> : <Link className="usage-inline-link" href="/usage/sessions">Inspect local sessions</Link>}
            </div>
          </section>}
    <section className="usage-trust" aria-labelledby="leaderboard-trust-title"><div><h2 id="leaderboard-trust-title">What these totals measure</h2><p>Observed tokens include input, output, and cache tokens from the usage records the service accepted. Providers expose different records, and missing records are unknown. A total measures tokens, not spending, time worked, or productivity.</p></div><ul><li>Explicit account consent</li><li>Partial token observations</li><li>UTC reporting windows</li><li>Withdrawal from your dashboard</li></ul></section>
  </>;
}
