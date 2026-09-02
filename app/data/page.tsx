import { Breadcrumbs } from "@/components/ui";
import { CodingAgentLeadersTable } from "@/components/coding-agent-leaders-table";
import { CodingAgentSnapshotTable } from "@/components/coding-agent-snapshot-table";
import codingAgentData from "@/data/coding-agents.json";
import terminalBenchData from "@/data/terminal-bench.json";
import terminalBenchScienceData from "@/data/terminal-bench-science.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import { codingAgentSnapshotRows } from "@/lib/coding-agent-snapshot-rows";
import { BENCHMARK_DATA_DESCRIPTION } from "@/lib/benchmark-portfolio";
import {
  terminalBenchDatasetJsonLd,
  terminalBenchScienceDatasetJsonLd,
} from "@/lib/benchmark-dataset-json-ld";
import {
  CODING_AGENT_BENCHMARK_DEFINITIONS,
  CODING_AGENT_DATASET_DOWNLOAD_PATH,
  CODING_AGENT_DATASET_PATH,
  codingAgentDatasetJsonLd,
  codingAgentDatasetModifiedAt,
  codingAgentDatasetSummary,
  currentCodingAgentBenchmarkLeaders,
} from "@/lib/coding-agent-dataset";
import { parseTerminalBenchSnapshot } from "@/lib/terminal-bench-data";
import { parseTerminalBenchScienceSnapshot } from "@/lib/terminal-bench-science-data";
import { createPublicSiteMetadata } from "@hraness/web-discovery";
import { JsonLdScript } from "@hraness/web-discovery/json-ld";
import type { Metadata } from "next";
import Link from "next/link";

import { searchSite } from "../site";

const dataSearchSite = {
  ...searchSite,
  description: BENCHMARK_DATA_DESCRIPTION,
  socialTitle: "Benchmark Data and Method | AI Charts",
  title: "Benchmark Data and Method | AI Charts",
} as const;

export const metadata: Metadata = createPublicSiteMetadata(
  dataSearchSite,
  { canonicalPath: CODING_AGENT_DATASET_PATH },
);

const retrievedAtFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
  timeZoneName: "short",
  year: "numeric",
});

function formatRetrievedAt(value: string): string {
  return retrievedAtFormatter.format(new Date(value));
}

export default function CodingAgentDatasetPage() {
  const input: unknown = codingAgentData;
  const parsed = parseCodingAgentSnapshot(input);
  if (!parsed.ok) {
    throw new Error(
      "Checked coding-agent snapshot is invalid: " + parsed.error.message,
      { cause: parsed.error },
    );
  }
  const snapshot = parsed.value;
  const parsedTerminalBench = parseTerminalBenchSnapshot(terminalBenchData);
  if (!parsedTerminalBench.ok) {
    throw new Error(
      "Checked Terminal-Bench snapshot is invalid: " + parsedTerminalBench.error.message,
      { cause: parsedTerminalBench.error },
    );
  }
  const terminalBench = parsedTerminalBench.value;
  const parsedTerminalBenchScience = parseTerminalBenchScienceSnapshot(
    terminalBenchScienceData,
  );
  if (!parsedTerminalBenchScience.ok) {
    throw new Error(
      "Checked Terminal-Bench-Science snapshot is invalid: "
        + parsedTerminalBenchScience.error.message,
      { cause: parsedTerminalBenchScience.error },
    );
  }
  const terminalBenchScience = parsedTerminalBenchScience.value;
  const modifiedAt = codingAgentDatasetModifiedAt(snapshot);
  const summary = codingAgentDatasetSummary(snapshot);
  const leaders = currentCodingAgentBenchmarkLeaders(snapshot);

  return (
    <main
      className="plain-publication__article"
      data-analytics-surface="data_document"
      id="data-content"
    >
      <JsonLdScript
        data={[
          codingAgentDatasetJsonLd(snapshot, searchSite),
          terminalBenchDatasetJsonLd(terminalBench, searchSite),
          terminalBenchScienceDatasetJsonLd(terminalBenchScience, searchSite),
        ]}
        id="aicharts-benchmark-datasets-structured-data"
      />

      <header className="plain-publication__article-header plain-publication__shell">
        <Breadcrumbs
          aria-label="Breadcrumb"
          className="plain-publication__breadcrumbs"
          items={[
            { href: "/", id: "aicharts", label: "AI Charts" },
            { id: "data", label: "Data" },
          ]}
        />
        <h1>Benchmark data and method</h1>
        <p className="plain-publication__article-dek">
          {BENCHMARK_DATA_DESCRIPTION}
        </p>
        <p className="plain-publication__article-meta">
          <span>Artificial Analysis retrieved </span>
          <time dateTime={snapshot.source.retrievedAt}>
            {formatRetrievedAt(snapshot.source.retrievedAt)}
          </time>
          <span aria-hidden="true"> · </span>
          <span>Latest notable AA update </span>
          <time dateTime={modifiedAt}>{formatRetrievedAt(modifiedAt)}</time>
          <span aria-hidden="true"> · </span>
          <span>{summary.recordCount} AA configurations</span>
          <span aria-hidden="true"> · </span>
          <span>{summary.providerCount} AA providers</span>
        </p>
        <nav aria-label="Dataset downloads" className="plain-publication__download-links">
          <p>Download checked snapshots</p>
          <ul>
            <li>
              <a download="aicharts-terminal-bench-4.json" href="/data/terminal-bench-4.json">
                Terminal-Bench 4 <span aria-hidden="true">↓</span>
              </a>
            </li>
            <li>
              <a
                download="aicharts-terminal-bench-science-0-1.json"
                href="/data/terminal-bench-science-0-1.json"
              >
                Terminal-Bench-Science 0.1 <span aria-hidden="true">↓</span>
              </a>
            </li>
            <li>
              <a
                download="aicharts-coding-agent-benchmarks.json"
                href={CODING_AGENT_DATASET_DOWNLOAD_PATH}
              >
                Artificial Analysis coding agents <span aria-hidden="true">↓</span>
              </a>
            </li>
          </ul>
        </nav>
      </header>

      <div className="plain-publication__article-layout plain-publication__shell">
        <nav aria-label="On this page" className="plain-publication__toc">
          <p>On this page</p>
          <ol>
            <li><a href="#terminal-bench-4">Terminal-Bench 4 standard</a></li>
            <li><a href="#terminal-bench-science">Terminal-Bench-Science 0.1</a></li>
            <li><a href="#source">Source and refresh</a></li>
            <li><a href="#benchmarks">Benchmark definitions</a></li>
            <li><a href="#leaders">Current leaders</a></li>
            <li><a href="#configurations">All configurations</a></li>
            <li><a href="#method">Normalization method</a></li>
            <li><a href="#limitations">Limitations</a></li>
          </ol>
        </nav>

        <div className="plain-publication__article-main">
          <div className="plain-publication__article-body">
            <h2 id="terminal-bench-4">Terminal-Bench 4 coding standard</h2>
            <p>
              The homepage uses Terminal-Bench {terminalBench.benchmark.version}{" "}
              as its standard agentic terminal-engineering benchmark. The checked
              snapshot contains {terminalBench.records.length} configurations from
              the official{" "}
              <a href={terminalBench.source.submissionsDirectoryUrl}>
                Harbor Framework submissions
              </a>
              {" "}at{" "}
              <a href={terminalBench.source.repositoryCommitUrl}>
                commit {terminalBench.source.repositoryCommit.slice(0, 7)}
              </a>
              , committed on{" "}
              <time dateTime={terminalBench.source.repositoryCommittedAt}>
                {formatRetrievedAt(terminalBench.source.repositoryCommittedAt)}
              </time>
              , with {terminalBench.benchmark.taskCount} tasks and{" "}
              {terminalBench.benchmark.trialsPerTask} trials per task. AI Charts
              retrieved this owner snapshot on{" "}
              <time dateTime={terminalBench.source.retrievedAt}>
                {formatRetrievedAt(terminalBench.source.retrievedAt)}
              </time>.
            </p>
            <p>
              Terminal-Bench 4 is a breaking exam generation. Its scores remain
              separate from the Terminal-Bench v2.1 field in the Artificial
              Analysis dataset below. Every TB4 row retains its model, agent,
              agent version, effort, accuracy, 95% confidence interval, trials,
              cost, tokens, duration, and pinned source files.
            </p>
            <a
              className="plain-publication__primary-link"
              download="aicharts-terminal-bench-4.json"
              href="/data/terminal-bench-4.json"
            >
              Download Terminal-Bench 4 JSON <span aria-hidden="true">↓</span>
            </a>

            <h2 id="terminal-bench-science">Terminal-Bench-Science 0.1</h2>
            <p>
              The checked scientific-workflow snapshot published by{" "}
              <a href={terminalBenchScience.source.repositoryUrl}>
                {terminalBenchScience.source.name}
              </a>
              {" "}contains{" "}
              {terminalBenchScience.records.length} owner-published system
              configurations across {terminalBenchScience.benchmark.taskCount} tasks
              and {terminalBenchScience.benchmark.trialsPerTask} trials per task. It is
              pinned to the exact{" "}
              <a href={terminalBenchScience.source.releaseCommitUrl}>
                v0.1.0 release commit {terminalBenchScience.source.releaseCommit.slice(0, 7)}
              </a>
              . The release has the persistent citation{" "}
              <a href={terminalBenchScience.source.releaseDoiUrl}>
                {terminalBenchScience.source.releaseDoiUrl}
              </a>
              , and the owner leaderboard was updated on{" "}
              <time dateTime={terminalBenchScience.source.leaderboardUpdatedAt}>
                {formatRetrievedAt(terminalBenchScience.source.leaderboardUpdatedAt)}
              </time>
              . AI Charts retrieved it on{" "}
              <time dateTime={terminalBenchScience.source.retrievedAt}>
                {formatRetrievedAt(terminalBenchScience.source.retrievedAt)}
              </time>.
            </p>
            <p>
              Every row keeps the named model, harness, reasoning effort, resolution
              rate, binomial standard error, trial count, evaluation cost, token use,
              and owner-published source link. Terminal-Bench-Science remains separate
              from general terminal engineering and does not feed a composite score.
              Owner-published aggregate and per-domain cost fields are retained
              independently and are not forced to reconcile.
            </p>
            <a
              className="plain-publication__primary-link"
              download="aicharts-terminal-bench-science-0-1.json"
              href="/data/terminal-bench-science-0-1.json"
            >
              Download Terminal-Bench-Science 0.1 JSON <span aria-hidden="true">↓</span>
            </a>

            <h2 id="source">Source and refresh</h2>
            <p>
              The source is the public{" "}
              <a href={snapshot.source.url}>
                {snapshot.source.name} coding-agents comparison
              </a>.
              AI Charts retrieved this snapshot on{" "}
              <time dateTime={snapshot.source.retrievedAt}>
                {formatRetrievedAt(snapshot.source.retrievedAt)}
              </time>.
              The site checks for a new source snapshot daily. The displayed
              retrieval time changes only when a validated snapshot is stored.
            </p>
            <p>
              The most recent retained model, variant, or material benchmark
              change was detected on{" "}
              <time dateTime={modifiedAt}>{formatRetrievedAt(modifiedAt)}</time>.
              This meaningful-update time is separate from the daily retrieval
              check.
            </p>
            <p>
              The checked dataset contains {summary.recordCount} model-agent
              configurations across {summary.modelCount} models,{" "}
              {summary.agentCount} agent harnesses, and {summary.providerCount}{" "}
              model providers. The chart and the JSON download use this same
              checked snapshot.
            </p>

            <h2 id="benchmarks">Benchmark definitions</h2>
            <p>
              Each benchmark is shown on the 0–100 scale stored in the snapshot.
              The metrics evaluate different tasks and should be interpreted
              separately.
            </p>
            {CODING_AGENT_BENCHMARK_DEFINITIONS.map(definition => (
              <div key={definition.id}>
                <h3>{definition.label}</h3>
                <p>{definition.description}</p>
              </div>
            ))}

            <h2 id="leaders">Current leaders</h2>
            <p>
              These are the highest available scores in the retrieved snapshot,
              one row per benchmark. They are observations of the named model,
              agent harness, and effort setting rather than general model ranks.
            </p>
            <CodingAgentLeadersTable
              caption="Highest score by benchmark in the current snapshot"
              leaders={leaders}
            />
            <p>
              For AA Index versus mean API cost, including the cost/performance
              frontier, see{" "}
              <Link href="/blog/aa-index-cost-coding-agents">
                AA Index versus cost for coding agents
              </Link>
              . For whether classified open-weight rows sit with those leaders,
              see{" "}
              <Link href="/blog/open-models-coding-agent-benchmarks">
                open models on coding-agent benchmarks
              </Link>
              . For how lower inference costs change frequent-use product
              economics, see{" "}
              <Link href="/blog/small-models-have-arrived">
                cheaper AI models can make everyday products viable
              </Link>
              . For what a 30% Terminal-Bench-Science result measures—and how
              cost and token use change the comparison—see{" "}
              <Link href="/blog/terminal-bench-science">
                What Terminal-Bench-Science’s 30% result measures
              </Link>
              . For why a public-suite high score still needs a holdout, see{" "}
              <Link href="/blog/coding-agent-score-holdouts">
                why a coding-agent high score still needs a holdout
              </Link>
              .
            </p>

            <h2 id="configurations">All configurations</h2>
            <p>
              Every model-agent configuration in the retrieved snapshot, with
              AA Index, component scores, and mean API cost per task. Missing
              values are stored as empty in the source and shown as a dash.
            </p>
            <CodingAgentSnapshotTable
              caption={`All ${summary.recordCount} model-agent configurations in the ${snapshot.source.name} snapshot retrieved ${formatRetrievedAt(snapshot.source.retrievedAt)}`}
              className="plain-publication__table-scroll"
              id="coding-agent-snapshot"
              rows={codingAgentSnapshotRows(snapshot.records)}
              tableClassName="plain-publication__table"
              variant="full"
            />

            <h2 id="method">Normalization method</h2>
            <p>
              The refresh job reads the source page&apos;s public data payload,
              validates every source row, and maps it into a versioned owned
              schema. Benchmark reward proportions are represented as 0–100
              scores. Mean task cost stays in US dollars, mean active wall time
              stays in seconds, and mean total token use stays as a token count.
            </p>
            <p>
              Provider identifiers, model effort settings, stable series keys,
              and sort order are normalized for the chart. The refresh is
              rejected when duplicate records, major row loss, stable-key loss,
              or substantial metric-coverage regressions are detected. AI Charts
              does not recalculate the source benchmark outcomes.
            </p>

            <h2 id="limitations">Limitations</h2>
            <ul>
              <li>
                Artificial Analysis defines and operates the upstream
                evaluations. AI Charts is an independent visualization and is
                not affiliated with Artificial Analysis or the listed providers.
              </li>
              <li>
                Scores depend on the named model, agent harness, effort setting,
                task set, and evaluation version. They do not establish results
                for every software repository or production workflow.
              </li>
              <li>
                Cost, duration, and token values are task-level means from the
                source evaluation. They are not price or latency guarantees.
              </li>
              <li>
                This is a daily checked snapshot, not a real-time mirror. Use the
                retrieval timestamp when citing a value.
              </li>
            </ul>

            <aside className="plain-publication__callout">
              <strong>Reuse and attribution</strong>
              <p>
                The application code is MIT licensed. Third-party data, names,
                and marks are not covered by that license. Read the{" "}
                <a href="https://github.com/hraness/aicharts/blob/main/NOTICE.md">
                  data notice
                </a>{" "}
                before reuse, and cite the source page with the retrieval time.
              </p>
            </aside>
          </div>

          <section
            aria-labelledby="dataset-links-title"
            className="plain-publication__sources"
          >
            <h2 id="dataset-links-title">Dataset links</h2>
            <ol>
              <li>
                <a href={CODING_AGENT_DATASET_DOWNLOAD_PATH}>
                  Download the current JSON snapshot
                </a>
                <span>
                  Versioned records, provenance, retrieval time, and bounded
                  update history used by the production chart.
                </span>
              </li>
              <li>
                <a href={snapshot.source.url}>
                  Artificial Analysis coding-agents source
                </a>
                <span>
                  The upstream comparison from which the checked snapshot is
                  derived.
                </span>
              </li>
              <li>
                <a href="https://github.com/hraness/aicharts/blob/main/scripts/refresh-coding-agents.ts">
                  Refresh and normalization source code
                </a>
                <span>
                  The public parser, normalization rules, validation guards, and
                  update-detection logic.
                </span>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </main>
  );
}
