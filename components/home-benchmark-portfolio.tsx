import {
  CORE_BENCHMARK_PORTFOLIO,
  SUPPLEMENTAL_CODING_BENCHMARK,
} from "@/lib/benchmark-portfolio";

export { CORE_BENCHMARK_PORTFOLIO } from "@/lib/benchmark-portfolio";

export interface TerminalBenchPortfolioEntry {
  readonly id: string;
  readonly model: string;
  readonly agent: string;
  readonly agentVersion?: string;
  readonly organization?: string;
  readonly reasoningEffort?: string;
  readonly score: number;
  /** Half-width of the reported 95% confidence interval, in percentage points. */
  readonly confidenceInterval95?: number | null;
  readonly totalCostUsd?: number | null;
}

export interface TerminalBenchPortfolioSnapshot {
  /** A bare semantic version, such as `4.0.0`. */
  readonly version: string;
  readonly retrievedAt: string;
  readonly sourceLabel: string;
  readonly sourceUrl: string;
  readonly entries: readonly TerminalBenchPortfolioEntry[];
}

export interface TerminalBenchSciencePortfolioEntry {
  readonly id: string;
  /** Benchmark-owner rank, including the owner's tie-break policy. */
  readonly rank: number;
  readonly model: string;
  readonly harness: string;
  readonly organization?: string;
  readonly reasoningEffort?: string;
  readonly score: number;
  /** Source-published binomial standard error, in percentage points. */
  readonly standardError?: number | null;
  readonly totalCostUsd?: number | null;
}

export interface TerminalBenchSciencePortfolioSnapshot {
  /** A bare semantic version, such as `0.1.0`. */
  readonly version: string;
  readonly retrievedAt: string;
  readonly sourceLabel: string;
  readonly sourceUrl: string;
  readonly entries: readonly TerminalBenchSciencePortfolioEntry[];
}

const scoreFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});
const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

function isTerminalBench4(version: string): boolean {
  return version.trim().replace(/^v/iu, "") === "4.0.0";
}

function validTerminalBenchEntries(
  entries: readonly TerminalBenchPortfolioEntry[],
): readonly TerminalBenchPortfolioEntry[] {
  return entries
    .filter(entry => (
      entry.id.trim().length > 0
      && entry.model.trim().length > 0
      && entry.agent.trim().length > 0
      && Number.isFinite(entry.score)
      && entry.score >= 0
      && entry.score <= 100
    ))
    .toSorted((left, right) => (
      right.score - left.score || left.model.localeCompare(right.model)
    ))
    .slice(0, 4);
}

function validTerminalBenchScienceEntries(
  entries: readonly TerminalBenchSciencePortfolioEntry[],
): readonly TerminalBenchSciencePortfolioEntry[] {
  return entries
    .filter(entry => (
      entry.id.trim().length > 0
      && Number.isInteger(entry.rank)
      && entry.rank > 0
      && entry.model.trim().length > 0
      && entry.harness.trim().length > 0
      && Number.isFinite(entry.score)
      && entry.score >= 0
      && entry.score <= 100
    ))
    .toSorted((left, right) => left.rank - right.rank || left.id.localeCompare(right.id))
    .slice(0, 4);
}

function formattedRetrievalDate(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : dateFormatter.format(date);
}

function optionalNumber(
  value: number | null | undefined,
  formatter: Intl.NumberFormat,
): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "Not reported"
    : formatter.format(value);
}

function TerminalBenchSnapshot({
  snapshot,
}: Readonly<{ snapshot: TerminalBenchPortfolioSnapshot }>) {
  const entries = validTerminalBenchEntries(snapshot.entries);
  const retrievalDate = formattedRetrievalDate(snapshot.retrievedAt);

  if (!isTerminalBench4(snapshot.version)) {
    return (
      <aside className="terminal-bench-snapshot terminal-bench-snapshot--incompatible">
        <h3>Terminal-Bench leaderboard held back</h3>
        <p>
          This snapshot identifies version {snapshot.version}. The coding-standard view accepts
          exact Terminal-Bench 4.0.0 results only.
        </p>
      </aside>
    );
  }

  return (
    <section aria-labelledby="terminal-bench-snapshot-title" className="terminal-bench-snapshot">
      <header className="terminal-bench-snapshot__header">
        <div>
          <p className="terminal-bench-snapshot__label">Coding standard</p>
          <h3 id="terminal-bench-snapshot-title">
            Terminal-Bench {snapshot.version} snapshot
          </h3>
        </div>
        <p className="terminal-bench-snapshot__provenance">
          <a
            data-analytics-destination-id="source:terminal-bench"
            data-analytics-destination-kind="source"
            href={snapshot.sourceUrl}
          >
            {snapshot.sourceLabel}
          </a>
          {retrievalDate === null ? null : (
            <>
              {" · Retrieved "}
              <time dateTime={snapshot.retrievedAt}>{retrievalDate}</time>
            </>
          )}
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="terminal-bench-snapshot__empty">
          No valid Terminal-Bench 4 rows were available in this snapshot.
        </p>
      ) : (
        <div className="terminal-bench-snapshot__table-scroll">
          <table className="terminal-bench-snapshot__table">
            <caption>
              Highest Terminal-Bench 4 accuracy scores in the current official snapshot
            </caption>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Model and agent</th>
                <th scope="col">Accuracy</th>
                <th scope="col">95% interval</th>
                <th scope="col">Evaluation cost</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={entry.id}>
                  <th scope="row">{index + 1}</th>
                  <td>
                    <strong>{entry.model}</strong>
                    <small>
                      {entry.agent}
                      {entry.agentVersion === undefined ? null : ` ${entry.agentVersion}`}
                      {entry.reasoningEffort === undefined ? null : ` · ${entry.reasoningEffort}`}
                      {entry.organization === undefined ? null : ` · ${entry.organization}`}
                    </small>
                  </td>
                  <td>
                    <span className="terminal-bench-snapshot__score">
                      <meter
                        aria-hidden="true"
                        max={100}
                        min={0}
                        value={entry.score}
                      />
                      <data value={entry.score}>{scoreFormatter.format(entry.score)}%</data>
                    </span>
                  </td>
                  <td>
                    {entry.confidenceInterval95 === null
                      || entry.confidenceInterval95 === undefined
                      || !Number.isFinite(entry.confidenceInterval95)
                      ? "Not reported"
                      : `±${scoreFormatter.format(entry.confidenceInterval95)} points`}
                  </td>
                  <td>{optionalNumber(entry.totalCostUsd, currencyFormatter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TerminalBenchScienceSnapshot({
  snapshot,
}: Readonly<{ snapshot: TerminalBenchSciencePortfolioSnapshot }>) {
  const entries = validTerminalBenchScienceEntries(snapshot.entries);
  const retrievalDate = formattedRetrievalDate(snapshot.retrievedAt);

  if (snapshot.version.trim().replace(/^v/iu, "") !== "0.1.0") {
    return (
      <aside className="terminal-bench-snapshot terminal-bench-snapshot--incompatible">
        <h3>Terminal-Bench-Science leaderboard held back</h3>
        <p>
          This snapshot identifies version {snapshot.version}. The scientific-workflow view
          accepts exact Terminal-Bench-Science 0.1.0 results only.
        </p>
      </aside>
    );
  }

  return (
    <section
      aria-labelledby="terminal-bench-science-snapshot-title"
      className="terminal-bench-snapshot terminal-bench-snapshot--science"
    >
      <header className="terminal-bench-snapshot__header">
        <div>
          <p className="terminal-bench-snapshot__label">Scientific workflows</p>
          <h3 id="terminal-bench-science-snapshot-title">
            Terminal-Bench-Science {snapshot.version} snapshot
          </h3>
        </div>
        <p className="terminal-bench-snapshot__provenance">
          <a
            data-analytics-destination-id="source:terminal-bench-science"
            data-analytics-destination-kind="source"
            href={snapshot.sourceUrl}
          >
            {snapshot.sourceLabel}
          </a>
          {retrievalDate === null ? null : (
            <>
              {" · Retrieved "}
              <time dateTime={snapshot.retrievedAt}>{retrievalDate}</time>
            </>
          )}
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="terminal-bench-snapshot__empty">
          No valid Terminal-Bench-Science 0.1 rows were available in this snapshot.
        </p>
      ) : (
        <div className="terminal-bench-snapshot__table-scroll">
          <table className="terminal-bench-snapshot__table">
            <caption>
              Highest Terminal-Bench-Science 0.1 resolution rates in the current owner snapshot
            </caption>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Model and harness</th>
                <th scope="col">Resolution rate</th>
                <th scope="col">Standard error</th>
                <th scope="col">Evaluation cost</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.id}>
                  <th scope="row">{entry.rank}</th>
                  <td>
                    <strong>{entry.model}</strong>
                    <small>
                      {entry.harness}
                      {entry.reasoningEffort === undefined ? null : ` · ${entry.reasoningEffort}`}
                      {entry.organization === undefined ? null : ` · ${entry.organization}`}
                    </small>
                  </td>
                  <td>
                    <span className="terminal-bench-snapshot__score">
                      <meter aria-hidden="true" max={100} min={0} value={entry.score} />
                      <data value={entry.score}>{scoreFormatter.format(entry.score)}%</data>
                    </span>
                  </td>
                  <td>
                    {entry.standardError === null
                      || entry.standardError === undefined
                      || !Number.isFinite(entry.standardError)
                      ? "Not reported"
                      : `±${scoreFormatter.format(entry.standardError)} points`}
                  </td>
                  <td>{optionalNumber(entry.totalCostUsd, currencyFormatter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function HomeBenchmarkPortfolio({
  terminalBench,
  terminalBenchScience,
}: Readonly<{
  terminalBench?: TerminalBenchPortfolioSnapshot;
  terminalBenchScience?: TerminalBenchSciencePortfolioSnapshot;
}>) {
  return (
    <section
      aria-describedby="home-benchmark-portfolio-summary"
      aria-labelledby="home-benchmark-portfolio-title"
      className="home-benchmark-portfolio"
      data-analytics-surface="home_portfolio"
    >
      <header className="home-benchmark-portfolio__header">
        <p className="home-benchmark-portfolio__label">Benchmark selection</p>
        <h2 id="home-benchmark-portfolio-title">Five benchmark roles, one coding standard</h2>
        <p id="home-benchmark-portfolio-summary">
          Each role answers a different question. Checked score views stay on their native
          scales; versions remain visible; Terminal-Bench 4 is the coding standard.
        </p>
      </header>

      <div className="home-benchmark-portfolio__table-scroll">
        <table className="home-benchmark-portfolio__table">
          <caption>Core benchmark set</caption>
          <thead>
            <tr>
              <th scope="col">Signal</th>
              <th scope="col">Benchmark and source</th>
              <th scope="col">What it measures</th>
              <th scope="col">Comparison rule</th>
            </tr>
          </thead>
          <tbody>
            {CORE_BENCHMARK_PORTFOLIO.map(benchmark => (
              <tr data-benchmark={benchmark.id} key={benchmark.id}>
                <th scope="row">{benchmark.signal}</th>
                <td>
                  <span className="home-benchmark-portfolio__benchmark-name">
                    <a
                      data-analytics-destination-id={`source:${benchmark.id}`}
                      data-analytics-destination-kind="source"
                      href={benchmark.sourceUrl}
                    >
                      {benchmark.name}
                    </a>
                    <span>{benchmark.version}</span>
                    {benchmark.standard === true ? (
                      <strong className="home-benchmark-portfolio__standard">Standard</strong>
                    ) : null}
                  </span>
                  <small>Source: {benchmark.sourceLabel}</small>
                </td>
                <td>
                  <span className="home-benchmark-portfolio__mobile-label">Measures</span>
                  {benchmark.measure}
                </td>
                <td>
                  <span className="home-benchmark-portfolio__mobile-label">Comparison rule</span>
                  {benchmark.comparisonRule}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside
        aria-labelledby="home-benchmark-supplement-title"
        className="home-benchmark-portfolio__supplement"
      >
        <div>
          <p className="home-benchmark-portfolio__supplement-label">
            Supplemental · closed
          </p>
          <h3 id="home-benchmark-supplement-title">
            <a
              data-analytics-destination-id="source:cursorbench"
              data-analytics-destination-kind="source"
              href={SUPPLEMENTAL_CODING_BENCHMARK.sourceUrl}
            >
              {SUPPLEMENTAL_CODING_BENCHMARK.name} {SUPPLEMENTAL_CODING_BENCHMARK.version}
            </a>
          </h3>
        </div>
        <p>
          {SUPPLEMENTAL_CODING_BENCHMARK.measure} Its task set and full harness are closed,
          so it can corroborate deployed behavior but does not replace the public coding
          standard or feed a composite score.
        </p>
        <small>Source: {SUPPLEMENTAL_CODING_BENCHMARK.sourceLabel}</small>
      </aside>

      {terminalBench === undefined && terminalBenchScience === undefined ? null : (
        <div className="home-benchmark-portfolio__snapshots">
          {terminalBench === undefined ? null : (
            <TerminalBenchSnapshot snapshot={terminalBench} />
          )}
          {terminalBenchScience === undefined ? null : (
            <TerminalBenchScienceSnapshot snapshot={terminalBenchScience} />
          )}
        </div>
      )}
    </section>
  );
}
