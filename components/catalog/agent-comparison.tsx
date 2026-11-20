import { Fragment } from "react";
import { FrontierStarIcon, ProviderLogo } from "../brand-icon";
import { AgentChart, type AgentLegendItem } from "./agent-chart";
import { Breadcrumbs } from "./breadcrumbs";
import { FactCell, type Cell } from "./fact-cell";
import { Questions } from "./questions";
import { Cite, Sources, type Source } from "./sources";
import {
  agentBudgetText,
  agentChartReleases,
  agentChartScale,
  agentChooseReasons,
  agentLead,
  agentPairs,
  agentQuestions,
  BUDGETS,
  bestEpochRun,
  bestRun,
  bestUnder,
  cheapestRun,
  harnessGroups,
  olderVersionRuns,
  pickRun,
  type AgentPair,
  type AgentRun,
  type HarnessGroup,
} from "@/lib/agents";
import { bestEpoch, catalog, effortName, pairSlug, TB_TIE } from "@/lib/catalog";
import { epochTie } from "@/lib/copy";
import { formatFullDate, formatScore, formatTokens, formatUsd } from "@/lib/format";
import { buildPlottedPoints, computeParetoFrontier, getQualifiedFrontierKeys } from "@/lib/pareto";
import {
  EPOCH_BENCHMARKS,
  EPOCH_BENCHMARKS_URL,
  PROVIDERS,
  TERMINAL_BENCH,
  type ModelRelease,
  type ProviderId,
} from "@/lib/types";

const pct = (value: number) => formatScore(value, "%");
const cost = (run: AgentRun) =>
  run.run.costPerTaskUsd === null ? "No cost reported" : formatUsd(run.run.costPerTaskUsd);
const setting = (run: AgentRun) => `${run.release.name} at ${effortName(run.run.effort)}`;

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

/** Marks the lowest value when the next one is at least `ratio` times it. */
function ratioMarks(values: readonly (number | null)[], ratio: number, word: string) {
  const ranked = values
    .map((value, i) => ({ value, i }))
    .filter((x): x is { value: number; i: number } => x.value !== null && x.value > 0)
    .sort((x, y) => x.value - y.value);
  const out: (string | undefined)[] = values.map(() => undefined);
  const [first, second] = ranked;
  if (first && second && second.value / first.value >= ratio) out[first.i] = word;
  return out;
}

type Row = Readonly<{ label: string; cells: readonly Cell[] }>;

function factRows(groups: readonly HarnessGroup[], cite: Readonly<{ tb: number; epoch: number }>): Row[] {
  const tops = groups.map((g) => bestRun(g.runs));
  const topWins = marks(tops.map((r) => r.run.accuracy), true, TB_TIE, "Higher");
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
      cells: groups.map((g) => ({
        value: `${g.runs.length} model${g.runs.length === 1 ? "" : "s"}`,
        note: "One Terminal-Bench run each",
        cite: cite.tb,
      })),
    },
    {
      label: "Best Terminal-Bench score",
      cells: tops.map((run, i) => ({
        value: pct(run.run.accuracy),
        note: `${setting(run)} · ${cost(run)}`,
        win: topWins[i],
        cite: cite.tb,
      })),
    },
  ];

  const cheapest = groups.map((g) => cheapestRun(g.runs));
  const cheapWins = marks(
    cheapest.map((r) => r?.run.costPerTaskUsd ?? null),
    false,
    0,
    "Lower",
  );
  rows.push({
    label: "Lowest cost per task",
    cells: cheapest.map((run, i) =>
      run
        ? { value: cost(run), note: `${run.release.name} · scores ${pct(run.run.accuracy)}`, win: cheapWins[i], cite: cite.tb }
        : { value: "No cost reported" },
    ),
  });

  for (const budget of BUDGETS) {
    const picks = groups.map((g) => bestUnder(g.runs, budget));
    if (picks.every((p) => p === null)) continue;
    const wins = marks(
      picks.map((p) => (p ? p.run.accuracy : null)),
      true,
      TB_TIE,
      "Higher",
    );
    rows.push({
      label: `Best under ${formatUsd(budget)} per task`,
      cells: picks.map((run, i) =>
        run
          ? { value: pct(run.run.accuracy), note: `${run.release.name} · ${cost(run)}`, win: wins[i], cite: cite.tb }
          : {
              value: "No run",
              note: cheapest[i] ? `Cheapest is ${cost(cheapest[i]!)}` : undefined,
            },
      ),
    });
  }

  // The run a reader would pick: the cheapest within two tasks of the agent's best.
  const picks = groups.map((g) => pickRun(g.runs)!);
  const tokenWins = ratioMarks(picks.map((r) => r.run.tokensPerTask.output), 1.5, "Fewer");
  rows.push({
    label: "Output tokens per task",
    cells: picks.map((run, i) => ({
      value: formatTokens(run.run.tokensPerTask.output),
      note: `${run.release.name}, the cheapest run near its best`,
      win: tokenWins[i],
      cite: cite.tb,
    })),
  });
  const minuteWins = ratioMarks(picks.map((r) => r.run.minutesPerTask), 1.3, "Quicker");
  rows.push({
    label: "Minutes per task",
    cells: picks.map((run, i) => ({
      value: run.run.minutesPerTask === null ? "Not reported" : `${Math.round(run.run.minutesPerTask)} min`,
      note: run.release.name,
      win: minuteWins[i],
      cite: cite.tb,
    })),
  });

  const mirror = groups.map((g) => bestEpochRun(g.runs, "mirrorCode"));
  if (mirror.some(Boolean)) {
    const ranked = mirror
      .map((m, i) => ({ m, i }))
      .filter((x): x is { m: NonNullable<typeof x.m>; i: number } => x.m !== null)
      .sort((x, y) => y.m.score.score - x.m.score.score);
    const [first, second] = ranked;
    const win =
      first && second && first.m.score.score - second.m.score.score > epochTie(first.m.score, second.m.score)
        ? first.i
        : -1;
    rows.push({
      label: "MirrorCode, best model alone",
      cells: mirror.map((m, i) =>
        m
          ? {
              value: pct(m.score.score),
              note: `${m.release.name} at ${effortName(m.score.effort)}, without the agent`,
              win: i === win ? "Higher" : undefined,
              cite: cite.epoch,
            }
          : { value: "Not run", note: "No Epoch AI score yet" },
      ),
    });
  }
  return rows;
}

function legendFor(groups: readonly HarnessGroup[], emphasized: readonly AgentRun[]): AgentLegendItem[] {
  const items: AgentLegendItem[] = emphasized.map((run, i) => ({
    provider: run.release.provider,
    label: `${run.release.name} in ${run.harness.name}`,
    mark: i === 0 ? "hero" : "hollow",
  }));
  for (const g of groups) {
    const others = new Set(g.runs.map((r) => r.release.slug));
    const drawn = emphasized.filter((run) => others.delete(run.release.slug));
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

function epochCell(release: ModelRelease, id: (typeof EPOCH_BENCHMARKS)[number]["id"]) {
  const best = bestEpoch(release, id);
  return best ? (
    <>
      {pct(best.score)}
      <span className="cell-note">{effortName(best.effort)}</span>
    </>
  ) : (
    "—"
  );
}

export function AgentComparison({
  groups,
  pair,
}: Readonly<{ groups: readonly HarnessGroup[]; pair: AgentPair | null }>) {
  const all = groups.flatMap((g) => g.runs);
  const names = groups.map((g) => g.harness.name);
  const hasGoogle = groups.some((g) => g.harness.formerly);
  const older = olderVersionRuns(all);

  const sources: Source[] = [
    {
      name: "Terminal-Bench leaderboard submissions",
      url: "https://github.com/harbor-framework/terminal-bench/tree/main/leaderboard",
    },
    { name: "Epoch AI, Capabilities & benchmarking (CC BY 4.0)", url: EPOCH_BENCHMARKS_URL },
  ];
  const cite = { tb: 1, epoch: 2 };
  let releaseNotes = 0;
  if (older.length > 0) {
    sources.push({ name: "Terminal-Bench 4.1 release notes", url: TERMINAL_BENCH.releaseNotesUrl });
    releaseNotes = sources.length;
  }
  let google = 0;
  if (hasGoogle) {
    sources.push({
      name: "Google for Developers: Transitioning Gemini CLI to Antigravity CLI",
      url: "https://developers.googleblog.com/en/an-important-update-transitioning-gemini-cli-to-antigravity-cli/",
    });
    google = sources.length;
  }

  // The two agents with the highest-scoring runs have their best runs drawn
  // large; on the three-way page those are the top two agents.
  const emphasized = [...groups]
    .sort((x, y) => bestRun(y.runs).run.accuracy - bestRun(x.runs).run.accuracy)
    .slice(0, 2)
    .sort((x, y) => groups.indexOf(x) - groups.indexOf(y))
    .map((g) => bestRun(g.runs));
  const chartReleases = agentChartReleases(groups);
  const starred = getQualifiedFrontierKeys(computeParetoFrontier(buildPlottedPoints(chartReleases, "cost")));
  const others = agentPairs().filter((p) => p.slug !== pair?.slug);
  const title = names.join(" vs ");
  const flagshipPair =
    emphasized.length === 2
      ? catalog.findPair(pairSlug(emphasized[0]!.release, emphasized[1]!.release))
      : undefined;

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
              ? "Every current model's Terminal-Bench run inside each coding agent"
              : "The best AI coding agent, measured on Terminal-Bench with every current model"}
          </span>
          {hasGoogle && (
            <span>
              Antigravity CLI replaced Gemini CLI
              <Cite n={google} />
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
          <Cite n={cite.tb} /> {agentBudgetText(groups)}
        </p>
      </section>

      <AgentChart
        releases={chartReleases}
        scale={agentChartScale()}
        selectedSlug={emphasized[0]!.release.slug}
        compareSlug={emphasized[1]?.release.slug}
        legend={legendFor(groups, emphasized)}
        caption="Each dot is one current model's Terminal-Bench run inside the agent named. The dashed grey line is the cost frontier of every run here: whichever agent owns it at a budget gives the highest score for that spend."
      />

      <section aria-labelledby="glance">
        <h2 id="glance">At a glance</h2>
        <p className="legend">
          <span className="mark mark--yes" aria-hidden="true">
            ✓
          </span>{" "}
          marks the better value in a row. Score gaps smaller than two Terminal-Bench tasks count
          as level. Tokens and minutes are for each agent&apos;s cheapest run within two tasks of
          its best.
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
            {factRows(groups, cite).map((row) => (
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
        <h2 id="runs">Every current model</h2>
        <div className="table-scroll" role="region" aria-labelledby="runs-caption" tabIndex={0}>
          <table className="data-table agent-runs">
            <caption id="runs-caption">
              Each current model&apos;s Terminal-Bench run, highest score first. Cost is what the run
              reported spending across its trials, divided by the trials.
              <Cite n={cite.tb} />
            </caption>
            <thead>
              <tr>
                <th scope="col">Model and setting</th>
                <th scope="col">Terminal-Bench</th>
                <th scope="col">Cost per task</th>
                <th scope="col">Output tokens</th>
                <th scope="col">Minutes</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.harness.id}>
                <tr className="group-row">
                  <th scope="rowgroup" colSpan={5}>
                    <span className="model-link">
                      <ProviderLogo provider={g.harness.provider} size={14} />
                      {g.harness.name}
                    </span>
                  </th>
                </tr>
                {g.runs.map((run) => (
                  <tr key={run.key}>
                    <th scope="row">
                      <a className="model-link" href={`/models/${run.release.slug}#terminal-bench`}>
                        {run.release.name}
                      </a>
                      <span className="cell-note">
                        <span className="effort-cell">
                          {effortName(run.run.effort)} · {run.run.agentVersion}
                          {starred.has(run.release.slug) && (
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
                    <td>
                      {pct(run.run.accuracy)}
                      {older.includes(run) && (
                        <span className="cell-note">
                          Version {run.run.version}
                          <Cite n={releaseNotes} />
                        </span>
                      )}
                    </td>
                    <td>{cost(run)}</td>
                    <td>{formatTokens(run.run.tokensPerTask.output)}</td>
                    <td>{run.run.minutesPerTask === null ? "—" : Math.round(run.run.minutesPerTask)}</td>
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
        <h2 id="alone">The models alone</h2>
        <p>
          Epoch AI tests each model on its own, without an agent. MirrorCode is the closest to an
          agent&apos;s work: the model rebuilds whole programs without seeing their source.
          <Cite n={cite.epoch} /> Each cell is the model&apos;s best score and the setting it came
          from.
        </p>
        <div className="table-scroll" role="region" aria-labelledby="alone-caption" tabIndex={0}>
          <table className="data-table">
            <caption id="alone-caption">
              Epoch AI&apos;s scores for the models in each agent.
            </caption>
            <thead>
              <tr>
                <th scope="col">Model</th>
                {EPOCH_BENCHMARKS.map((b) => (
                  <th key={b.id} scope="col">
                    {b.label}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.harness.id}>
                <tr className="group-row">
                  <th scope="rowgroup" colSpan={EPOCH_BENCHMARKS.length + 1}>
                    <span className="model-link">
                      <ProviderLogo provider={g.harness.provider} size={14} />
                      {g.harness.name}
                    </span>
                  </th>
                </tr>
                {g.runs.map((run) => (
                  <tr key={run.key}>
                    <th scope="row">{run.release.name}</th>
                    {EPOCH_BENCHMARKS.map((b) => (
                      <td key={b.id}>{epochCell(run.release, b.id)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      {pair && (
        <div className="choose-grid">
          {groups.map((g, i) => {
            const other = groups[1 - i]!;
            const top = bestRun(g.runs);
            return (
              <section key={g.harness.id} aria-labelledby={`choose-${g.harness.id}`}>
                <h2 id={`choose-${g.harness.id}`}>Choose {g.harness.name} if…</h2>
                <ul>
                  {agentChooseReasons(g, other).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <p className="onward">
                  <a href={`/models/${top.release.slug}#terminal-bench`}>
                    {top.release.name} in {g.harness.name}: its run and scores
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
                  The models: {flagshipPair.first.name} vs {flagshipPair.second.name}
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
            Every run here is a submission on the official Terminal-Bench leaderboard: the agent
            attempts all {TERMINAL_BENCH.tasks} tasks at least five times, errored trials count as
            failures, and an LLM judge checks passing trials for reward hacking before the
            maintainers list the run. Cost is what the run reported at the API prices it ran on;
            subscription plans cost differently. Epoch AI&apos;s scores test each model alone,
            outside any agent, under CC BY 4.0. Only current models are listed. Written by aicharts
            from data checked {formatFullDate(catalog.dataset.snapshotDate)}.
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
