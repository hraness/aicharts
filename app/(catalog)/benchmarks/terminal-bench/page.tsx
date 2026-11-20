import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { pageMetadata } from "@/journal/content";
import { catalog } from "@/lib/catalog";
import { agentLabel, effortPhrase } from "@/lib/copy";
import { formatFullDate, formatScore, formatTokens, formatUsd } from "@/lib/format";
import { TERMINAL_BENCH } from "@/lib/types";

const path = "/benchmarks/terminal-bench";
const runs = catalog.releases.flatMap(model => model.terminalBench ? [{ model, run: model.terminalBench }] : [])
  .sort((a, b) => b.run.accuracy - a.run.accuracy || a.model.name.localeCompare(b.model.name));
const byVersion = Map.groupBy(runs, ({ run }) => run.version);
const versions = [...byVersion.keys()].sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
const latestVersion = versions[0]!;
const latest = byVersion.get(latestVersion)!;
const leader = latest[0]!;
const title = `Terminal-Bench ${latestVersion} leaderboard`;

export const metadata = pageMetadata(
  `${title} | Scores and cost per task`,
  `Ranked Terminal-Bench ${latestVersion} submissions for Claude, GPT and Gemini. Compare task success, agent, reasoning effort, output tokens and cost per task.`,
  path,
);

export default function TerminalBenchPage() {
  return (
    <article className="catalog-page">
      <Breadcrumbs trail={[{ name: title, href: path }]} />
      <header className="page-head">
        <h1>{title}</h1>
        <p>Data checked <time dateTime={catalog.dataset.snapshotDate}>{formatFullDate(catalog.dataset.snapshotDate)}</time></p>
      </header>
      <p className="lead">
        Among the models listed here, {leader.model.name} had the highest Terminal-Bench {latestVersion} score at <strong>{formatScore(leader.run.accuracy, "%")}</strong>.
        {" "}It passed {leader.run.successes} of {leader.run.trials} trials in {leader.run.agent}
        {leader.run.costPerTaskUsd !== null && ` at a mean cost of ${formatUsd(leader.run.costPerTaskUsd)} per task`}.
        {" "}<a href={leader.run.sourceUrl}>View the submission</a>.
      </p>
      {versions.map(version => (
        <section key={version} aria-labelledby={`terminal-${version}`}>
          <h2 id={`terminal-${version}`}>Terminal-Bench {version} results</h2>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={`Terminal-Bench ${version} rankings`}>
            <table className="data-table">
              <thead><tr><th scope="col">Model</th><th scope="col">Agent and effort</th><th scope="col">Task success</th><th scope="col">Cost per task</th><th scope="col">Output tokens per task</th><th scope="col">Source</th></tr></thead>
              <tbody>
                {byVersion.get(version)!.map(({ model, run }) => (
                  <tr key={model.slug}>
                    <th scope="row"><a href={`/models/${model.slug}`}>{model.name}</a></th>
                    <td>{agentLabel(run)} {effortPhrase(run.effort)}</td>
                    <td>{formatScore(run.accuracy, "%")}</td>
                    <td>{run.costPerTaskUsd === null ? "—" : formatUsd(run.costPerTaskUsd)}</td>
                    <td>{formatTokens(run.tokensPerTask.output)}</td>
                    <td><a href={run.sourceUrl} aria-label={`${model.name} submission`}>Submission</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <section>
        <h2>What does Terminal-Bench measure?</h2>
        <p>
          Terminal-Bench tests coding agents on {TERMINAL_BENCH.tasks} tasks performed in a terminal, including building software and fixing systems.
          The success rate is the share of trials that passed. Each row is a published submission for the named model, coding agent and reasoning effort.
          The tables group submissions by benchmark version so each ranking uses the same task release.
          {" "}<a href={TERMINAL_BENCH.url}>Full Terminal-Bench leaderboard and methodology</a>.
        </p>
      </section>
      <p><a href="/agents">Compare the agents behind these scores</a> · <a href="/compare">Compare two models</a></p>
    </article>
  );
}
