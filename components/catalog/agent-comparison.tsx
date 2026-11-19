import { Fragment } from "react";
import { FrontierStarIcon, ProviderLogo } from "../brand-icon";
import { AgentChart, type AgentLegendItem } from "./agent-chart";
import { Breadcrumbs } from "./breadcrumbs";
import { FactCell, type Cell } from "./fact-cell";
import { Questions } from "./questions";
import { Cite, Sources, type Source } from "./sources";
import {
  agentBudgetText,
  agentChooseReasons,
  agentLead,
  agentPairs,
  agentQuestions,
  BUDGETS,
  bestRun,
  bestUnder,
  chartRelease,
  cheapestRun,
  flagship,
  frontierCodeGap,
  gapText,
  harborEffort,
  harnessGroups,
  harborRows,
  noiseFloor,
  runFrontier,
  summarizeGaps,
  TERMINAL_BENCH_TASKS,
  TIE_POINTS,
  type AgentPair,
  type AgentRun,
  type HarnessGroup,
} from "@/lib/agents";
import { catalog, effortName, pairSlug } from "@/lib/catalog";
import { formatDelta, formatFullDate, formatScore, formatUsd } from "@/lib/format";
import { getQualifiedFrontierKeys } from "@/lib/pareto";
import { PROVIDERS, type ModelRelease, type ProviderId } from "@/lib/types";

const AGENTS_SOURCE = 1;
const MODELS_SOURCE = 2;
const LEADERBOARD_SOURCE = 3;
const TB_RELEASE_SOURCE = 4;
const GOOGLE_SOURCE = 5;

const index = (run: AgentRun) => run.cli.codingAgentScore.toFixed(1);
const cost = (run: AgentRun) => formatUsd(run.cli.costUsdPerTask);
const setting = (run: AgentRun) => `${run.release.name} at ${effortName(run.effort.effortSlug)}`;
const pct = (value: number) => formatScore(value, "%");

/**
 * Marks the best value in a row when it leads the next one by at least
 * `floor`: smaller gaps are within a couple of tasks and count as level.
 */
function marks(values: readonly (number | null)[], higherWins: boolean, floor: number, word: string) {
  const ranked = values
    .map((value, i) => ({ value, i }))
    .filter((x): x is { value: number; i: number } => x.value !== null)
    .sort((x, y) => (higherWins ? y.value - x.value : x.value - y.value));
  const out: (string | undefined)[] = values.map(() => undefined);
  const [first, second] = ranked;
  if (!first) return out;
  if (!second) {
    if (values.length > 1) out[first.i] = "Only run";
    return out;
  }
  if (Math.abs(first.value - second.value) >= floor && first.value !== second.value) out[first.i] = word;
  return out;
}

type Row = Readonly<{ label: string; cells: readonly Cell[] }>;

function bestRow(
  label: string,
  groups: readonly HarnessGroup[],
  metric: (run: AgentRun) => number,
  format: (value: number) => string,
  floor: number,
): Row {
  const tops = groups.map((g) => bestRun(g.runs, metric));
  const wins = marks(tops.map(metric), true, floor, "Higher");
  return {
    label,
    cells: tops.map((run, i) => ({
      value: format(metric(run)),
      note: `${setting(run)} · ${cost(run)}`,
      win: wins[i],
      cite: AGENTS_SOURCE,
    })),
  };
}

function factRows(groups: readonly HarnessGroup[]): Row[] {
  const rows: Row[] = [
    {
      label: "Made by",
      cells: groups.map((g) => ({
        value: PROVIDERS[g.harness.provider].name,
        note: g.harness.formerly ? `Formerly ${g.harness.formerly}` : undefined,
      })),
    },
    {
      label: "Measured",
      cells: groups.map((g) => {
        const models = new Set(g.runs.map((r) => r.release.slug)).size;
        return {
          value: `${g.runs.length} run${g.runs.length === 1 ? "" : "s"}`,
          note: `${models} current model${models === 1 ? "" : "s"}`,
          cite: AGENTS_SOURCE,
        };
      }),
    },
    bestRow("Best Coding Agent Index", groups, (r) => r.cli.codingAgentScore, (v) => v.toFixed(1), TIE_POINTS),
  ];

  const cheapest = groups.map((g) => cheapestRun(g.runs)!);
  const cheapWins = marks(cheapest.map((r) => r.cli.costUsdPerTask), false, 0, "Lower");
  rows.push({
    label: "Lowest cost per task",
    cells: cheapest.map((run, i) => ({
      value: cost(run),
      note: `${setting(run)} · scores ${index(run)}`,
      win: cheapWins[i],
      cite: AGENTS_SOURCE,
    })),
  });

  for (const budget of BUDGETS) {
    const picks = groups.map((g) => bestUnder(g.runs, budget));
    if (picks.every((p) => p === null)) continue;
    const wins = marks(
      picks.map((p) => (p ? p.cli.codingAgentScore : null)),
      true,
      TIE_POINTS,
      "Higher",
    );
    rows.push({
      label: `Best under ${formatUsd(budget)} per task`,
      cells: picks.map((run, i) =>
        run
          ? { value: index(run), note: `${setting(run)} · ${cost(run)}`, win: wins[i], cite: AGENTS_SOURCE }
          : { value: "No run", note: `Cheapest is ${cost(cheapest[i]!)}` },
      ),
    });
  }

  rows.push(
    bestRow("Terminal-Bench 4.1", groups, (r) => r.cli.terminalBench4, pct, noiseFloor(TERMINAL_BENCH_TASKS)),
    bestRow("FrontierCode 2.0", groups, (r) => r.cli.frontierCode2, pct, noiseFloor(132)),
    bestRow("SWE-Atlas QnA", groups, (r) => r.cli.sweAtlas, pct, noiseFloor(124)),
  );

  const leaderboard = groups.map((g) => harborRows(g.harness)[0] ?? null);
  if (leaderboard.some(Boolean)) {
    const wins = marks(
      leaderboard.map((row) => row?.result.accuracy ?? null),
      true,
      noiseFloor(TERMINAL_BENCH_TASKS),
      "Higher",
    );
    rows.push({
      label: "Official Terminal-Bench",
      cells: leaderboard.map((row, i) =>
        row
          ? {
              value: pct(row.result.accuracy),
              note: `${row.release.name} · ${formatUsd(row.result.costPerTrialUsd)} per trial`,
              win: wins[i],
              cite: LEADERBOARD_SOURCE,
            }
          : { value: "Not listed" },
      ),
    });
  }

  rows.push({
    label: "FrontierCode, agent vs model alone",
    cells: groups.map((g) => {
      const s = summarizeGaps(g.runs);
      return {
        value: formatDelta(s.median),
        note: `Median of ${s.count} run${s.count === 1 ? "" : "s"}; ${s.lower} lower`,
        cite: MODELS_SOURCE,
      };
    }),
  });
  return rows;
}

function legendFor(groups: readonly HarnessGroup[], emphasized: readonly ModelRelease[]): AgentLegendItem[] {
  const items: AgentLegendItem[] = emphasized.map((release, i) => ({
    provider: release.provider,
    label: `${release.name} in ${PROVIDERS[release.provider].harness}`,
    mark: i === 0 ? "solid" : "dashed",
  }));
  for (const g of groups) {
    const others = new Set(g.runs.map((r) => r.release.slug));
    const drawn = emphasized.filter((release) => others.delete(release.slug));
    if (others.size > 0) {
      items.push({
        provider: g.harness.provider,
        label: `${drawn.length > 0 ? "Other models" : "Models"} in ${g.harness.name}`,
        mark: "dot",
      });
    }
  }
  return items;
}

function Marks({ providers }: Readonly<{ providers: readonly ProviderId[] }>) {
  return (
    <span className="pair-links__marks">
      {providers.map((provider) => (
        <ProviderLogo key={provider} provider={provider} size={14} />
      ))}
    </span>
  );
}

export function AgentComparison({
  groups,
  pair,
}: Readonly<{ groups: readonly HarnessGroup[]; pair: AgentPair | null }>) {
  const all = groups.flatMap((g) => g.runs);
  const names = groups.map((g) => g.harness.name);
  const hasGoogle = groups.some((g) => g.harness.formerly);
  const sources: Source[] = [
    { name: "Artificial Analysis: Coding Agents", url: "https://artificialanalysis.ai/agents/coding-agents/" },
    { name: "Artificial Analysis: model evaluations", url: "https://artificialanalysis.ai/models" },
    { name: "Terminal-Bench leaderboard", url: "https://tbench.ai" },
    {
      name: "Terminal-Bench 4.1 release notes",
      url: "https://github.com/harbor-framework/terminal-bench/releases/tag/v4.1.0",
    },
  ];
  if (hasGoogle) {
    sources.push({
      name: "Google for Developers: Transitioning Gemini CLI to Antigravity CLI",
      url: "https://developers.googleblog.com/en/an-important-update-transitioning-gemini-cli-to-antigravity-cli/",
    });
  }

  // The two most-measured agents' flagship models are drawn as lines; on the
  // three-way page those are Codex and Claude Code, whose sweeps cover every effort.
  const emphasized = [...groups]
    .sort((x, y) => y.runs.length - x.runs.length)
    .slice(0, 2)
    .sort((x, y) => groups.indexOf(x) - groups.indexOf(y))
    .map((g) => flagship(g.runs));
  const chartReleases = groups.flatMap((g) => {
    const slugs = [...new Set(g.runs.map((r) => r.release.slug))];
    return slugs.map((slug) => chartRelease(catalog.find(slug)!, g.harness)!);
  });
  const frontier = runFrontier(all);
  const starred = getQualifiedFrontierKeys(
    frontier.map((run) => ({
      key: run.key,
      release: run.release,
      effort: run.effort,
      provider: run.release.provider,
      budget: run.cli.costUsdPerTask,
      score: run.cli.codingAgentScore,
    })),
  );
  const leaderboard = groups
    .flatMap((g) => harborRows(g.harness))
    .sort((x, y) => y.result.accuracy - x.result.accuracy);
  const others = agentPairs().filter((p) => p.slug !== pair?.slug);
  const title = names.join(" vs ");
  const flagshipPair =
    emphasized.length === 2 ? catalog.findPair(pairSlug(emphasized[0]!, emphasized[1]!)) : undefined;

  return (
    <article className="catalog-page agent-page">
      <Breadcrumbs
        trail={[
          { name: "Coding agents", href: "/agents" },
          ...(pair ? [{ name: title, href: `/agents/${pair.slug}` }] : []),
        ]}
      />
      <header className="page-head">
        <h1 className="pair-title">
          {groups.map((g, i) => (
            <Fragment key={g.harness.id}>
              {i > 0 && <span className="pair-title__vs">vs</span>}
              <span>
                <ProviderLogo provider={g.harness.provider} size={26} />
                {g.harness.name}
              </span>
            </Fragment>
          ))}
        </h1>
        <p className="page-meta">
          <span>
            {pair
              ? "Every model and effort, measured inside each coding agent"
              : "The best AI coding agent, measured with every model and effort"}
          </span>
          {hasGoogle && (
            <span>
              Antigravity CLI replaced Gemini CLI
              <Cite n={GOOGLE_SOURCE} />
            </span>
          )}
          <span>
            Data checked{" "}
            <time dateTime={catalog.dataset.snapshotDate}>
              {formatFullDate(catalog.dataset.snapshotDate)}
            </time>
          </span>
          {pair ? <a href="/agents">All coding agents</a> : <a href="/compare">Compare models</a>}
        </p>
      </header>

      <section aria-labelledby="answer">
        <h2 id="answer" className="sr-only">
          Answer
        </h2>
        <p className="lead">
          {agentLead(groups)}
          <Cite n={AGENTS_SOURCE} /> {agentBudgetText(groups)}
        </p>
      </section>

      <AgentChart
        releases={chartReleases}
        selectedSlug={emphasized[0]!.slug}
        compareSlug={emphasized[1]?.slug}
        legend={legendFor(groups, emphasized)}
        caption={`Each point is one model at one effort setting inside its lab's agent; lines join one model's settings. The dashed grey line is the cost frontier of every run here: whichever agent owns it at a budget gives the highest score for that spend.`}
      />

      <section aria-labelledby="glance">
        <h2 id="glance">At a glance</h2>
        <p className="legend">
          <span className="mark mark--yes" aria-hidden="true">
            ✓
          </span>{" "}
          marks the better value in a row. Score rows show each agent&apos;s best run; gaps smaller
          than two benchmark tasks count as level.
        </p>
        {/* Roles are explicit: the three-agent table changes its display on phones. */}
        <table role="table" className={`facts facts--${groups.length}`}>
          <caption className="sr-only">{title} compared</caption>
          <thead role="rowgroup">
            <tr role="row">
              <td role="cell" />
              {names.map((name) => (
                <th key={name} scope="col" role="columnheader">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {factRows(groups).map((row) => (
              <tr key={row.label} role="row">
                <th scope="row" role="rowheader">
                  {row.label}
                </th>
                {row.cells.map((cell, i) => (
                  <FactCell key={names[i]} cell={cell} label={names[i]!} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="runs">
        <h2 id="runs">Every model, every effort</h2>
        <div className="table-scroll" role="region" aria-labelledby="runs-caption" tabIndex={0}>
          <table className="data-table agent-runs">
            <caption id="runs-caption">
              Each current model inside its lab&apos;s agent, best model first. Cost is the
              pay-per-token API bill for one task.
              <Cite n={AGENTS_SOURCE} />
            </caption>
            <thead>
              <tr>
                <th scope="col">Model and effort</th>
                <th scope="col">Coding Agent Index</th>
                <th scope="col">Cost per task</th>
                <th scope="col">Terminal-Bench 4.1</th>
                <th scope="col">FrontierCode 2.0</th>
                <th scope="col">SWE-Atlas QnA</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.harness.id}>
                <tr className="group-row">
                  <th scope="rowgroup" colSpan={6}>
                    <span className="model-link">
                      <ProviderLogo provider={g.harness.provider} size={14} />
                      {g.harness.name}
                    </span>
                  </th>
                </tr>
                {g.runs.map((run) => (
                  <tr key={run.key}>
                    <th scope="row">
                      <a className="model-link" href={`/models/${run.release.slug}#agent`}>
                        {run.release.name}
                      </a>
                      <span className="cell-note">
                        <span className="effort-cell">
                          {effortName(run.effort.effortSlug)}
                          {starred.has(run.key) && (
                            <span
                              className="effort-cell__star"
                              title="On the cost frontier of the runs on this page"
                            >
                              <FrontierStarIcon size={9} />
                              <span className="sr-only">on the cost frontier</span>
                            </span>
                          )}
                        </span>
                      </span>
                    </th>
                    <td>{index(run)}</td>
                    <td>{cost(run)}</td>
                    <td>{pct(run.cli.terminalBench4)}</td>
                    <td>{pct(run.cli.frontierCode2)}</td>
                    <td>{pct(run.cli.sweAtlas)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <p className="legend">
          <span className="effort-cell__star">
            <FrontierStarIcon size={9} />
          </span>{" "}
          marks runs on the cost frontier of this page: nothing here scores higher for less.
          Runs scoring under three quarters of the top score aren&apos;t marked.
        </p>
      </section>

      <section aria-labelledby="alone">
        <h2 id="alone">Inside the agent and alone</h2>
        <p>
          {gapText(groups)}
          <Cite n={AGENTS_SOURCE} />
          <Cite n={MODELS_SOURCE} /> Limits and prompts differ between the two set-ups, so the gap
          measures the whole set-up, not the agent alone. Terminal-Bench can&apos;t be compared
          this way: the agent runs use version 4.1, which changed the checks on all 66 tasks, and
          the model runs use 4.0.
          <Cite n={TB_RELEASE_SOURCE} />
        </p>
        <div className="table-scroll" role="region" aria-labelledby="alone-caption" tabIndex={0}>
          <table className="data-table">
            <caption id="alone-caption">
              FrontierCode 2.0 for the same model and effort, alone and inside its lab&apos;s agent.
            </caption>
            <thead>
              <tr>
                <th scope="col">Model and effort</th>
                <th scope="col">Alone</th>
                <th scope="col">In the agent</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.harness.id}>
                <tr className="group-row">
                  <th scope="rowgroup" colSpan={4}>
                    <span className="model-link">
                      <ProviderLogo provider={g.harness.provider} size={14} />
                      {g.harness.name}
                    </span>
                  </th>
                </tr>
                {g.runs.map((run) => {
                  const gap = frontierCodeGap(run);
                  return (
                    <tr key={run.key}>
                      <th scope="row">
                        {run.release.name}
                        <span className="cell-note">{effortName(run.effort.effortSlug)}</span>
                      </th>
                      <td>{pct(gap.alone)}</td>
                      <td>{pct(gap.inAgent)}</td>
                      <td>{formatDelta(gap.change)}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      {leaderboard.length > 0 && (
        <section aria-labelledby="leaderboard">
          <h2 id="leaderboard">On the official Terminal-Bench leaderboard</h2>
          <p>
            Terminal-Bench keeps its own leaderboard of submitted runs: 330 trials, five on each of
            its 66 tasks. Its cost is per trial.
            <Cite n={LEADERBOARD_SOURCE} />
          </p>
          <div className="table-scroll" role="region" aria-labelledby="leaderboard-caption" tabIndex={0}>
            <table className="data-table">
              <caption id="leaderboard-caption">Entries with current models, most passes first.</caption>
              <thead>
                <tr>
                  <th scope="col">Agent and model</th>
                  <th scope="col">Effort</th>
                  <th scope="col">Trials passed</th>
                  <th scope="col">Cost per trial</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row) => (
                  <tr key={`${row.harness.id}:${row.release.slug}`}>
                    <th scope="row">
                      {row.harness.name}
                      <span className="cell-note">{row.release.name}</span>
                    </th>
                    <td>{harborEffort(row)}</td>
                    <td>{pct(row.result.accuracy)}</td>
                    <td>{formatUsd(row.result.costPerTrialUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pair && (
        <div className="choose-grid">
          {groups.map((g, i) => {
            const other = groups[1 - i]!;
            const top = flagship(g.runs);
            return (
              <section key={g.harness.id} aria-labelledby={`choose-${g.harness.id}`}>
                <h2 id={`choose-${g.harness.id}`}>Choose {g.harness.name} if…</h2>
                <ul>
                  {agentChooseReasons(g, other).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <p className="onward">
                  <a href={`/models/${top.slug}#agent`}>
                    {top.name} in {g.harness.name}, effort by effort
                  </a>
                </p>
              </section>
            );
          })}
        </div>
      )}

      <section aria-labelledby="related">
        <h2 id="related">{pair ? "Other matchups" : "Head to head"}</h2>
        <ul className="pair-links">
          {others.map((p) => (
            <li key={p.slug}>
              <a href={`/agents/${p.slug}`}>
                <Marks providers={[p.first.provider, p.second.provider]} />
                <span>
                  {p.first.name} vs {p.second.name}
                </span>
              </a>
            </li>
          ))}
          {pair && (
            <li>
              <a href="/agents">
                <Marks providers={harnessGroups().map((g) => g.harness.provider)} />
                <span>{harnessGroups().map((g) => g.harness.name).join(" vs ")}</span>
              </a>
            </li>
          )}
          {flagshipPair && (
            <li>
              <a href={`/compare/${flagshipPair.slug}`}>
                <Marks providers={[flagshipPair.first.provider, flagshipPair.second.provider]} />
                <span>
                  The models alone: {flagshipPair.first.name} vs {flagshipPair.second.name}
                </span>
              </a>
            </li>
          )}
        </ul>
      </section>

      <Questions items={agentQuestions(groups)} />

      <Sources
        scope={
          <>
            Artificial Analysis runs each lab&apos;s own coding agent with that lab&apos;s models on
            the same tasks, three attempts per task, and prices each run at pay-per-token API rates
            with cache discounts; subscription plans cost differently. The Coding Agent Index is the
            equal-weight mean of FrontierCode 2.0, Terminal-Bench 4.1 and SWE-Atlas QnA. Only
            current models are listed. Written by aicharts from data checked{" "}
            {formatFullDate(catalog.dataset.snapshotDate)}.
          </>
        }
        sources={sources}
      />

      <p className="page-action">
        <a href="/">Open the explorer</a>
      </p>
    </article>
  );
}
