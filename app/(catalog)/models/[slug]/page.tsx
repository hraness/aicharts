import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProviderLogo } from "@/components/brand-icon";
import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { CatalogChart } from "@/components/catalog/catalog-chart";
import { PairList } from "@/components/catalog/pair-list";
import { Questions } from "@/components/catalog/questions";
import { Cite, Sources, type Source } from "@/components/catalog/sources";
import { FrontierStar } from "@/components/frontier-stars";
import { pageMetadata } from "@/journal/content";
import { agentPairs } from "@/lib/agents";
import { bestEpoch, catalog, effortName, isComparable } from "@/lib/catalog";
import { agentLabel, modelCopy } from "@/lib/copy";
import {
  formatContext,
  formatFullDate,
  formatPrice,
  formatScore,
  formatTokens,
  formatUsd,
} from "@/lib/format";
import { EPOCH_BENCHMARKS, EPOCH_BENCHMARKS_URL, PROVIDERS, TERMINAL_BENCH } from "@/lib/types";

type Params = Promise<{ slug: string }>;

export const dynamicParams = false;

export function generateStaticParams() {
  return catalog.releases.map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const release = catalog.find((await params).slug);
  if (!release) return {};
  return pageMetadata(
    `${release.name} benchmarks, pricing and cost per task`,
    modelCopy(release).description,
    `/models/${release.slug}`,
  );
}

const pct = (value: number) => formatScore(value, "%");
const EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"];

export default async function ModelPage({ params }: { params: Params }) {
  const release = catalog.find((await params).slug);
  if (!release) notFound();
  const copy = modelCopy(release);
  const lab = PROVIDERS[release.provider];
  const run = release.terminalBench;
  const pricing = release.pricing;
  const mirror = bestEpoch(release, "mirrorCode");
  const starredToday = !release.deprecated && catalog.liveFrontier.has(release.slug);
  const starredAtRelease = catalog.releaseDayFrontier.has(release.slug);
  const field = release.deprecated ? [...catalog.current, release] : [...catalog.current];
  const pairs = catalog.pairsFor(release).filter(isComparable);
  const agentPages = run
    ? agentPairs().filter((p) => p.first.name === run.agent || p.second.name === run.agent)
    : [];
  const prices = catalog.dataset.sources.find((s) => s.id === "litellm")!;
  const epochRows = [...release.epoch].sort(
    (a, b) =>
      EPOCH_BENCHMARKS.findIndex((m) => m.id === a.benchmark) -
        EPOCH_BENCHMARKS.findIndex((m) => m.id === b.benchmark) ||
      EFFORT_ORDER.indexOf(a.effort ?? "") - EFFORT_ORDER.indexOf(b.effort ?? ""),
  );

  const sources: Source[] = [
    run
      ? {
          name: `Terminal-Bench leaderboard: ${run.agent} with ${release.name}`,
          url: run.sourceUrl,
        }
      : { name: "Terminal-Bench leaderboard", url: TERMINAL_BENCH.url },
    {
      name: "Epoch AI, Capabilities & benchmarking (CC BY 4.0)",
      url: EPOCH_BENCHMARKS_URL,
    },
    { name: `${prices.name} (MIT)`, url: prices.url },
  ];
  const cite = { tb: 1, epoch: 2, prices: 3 };
  if (release.announcementUrl) {
    sources.push({
      name: `${lab.name}: ${release.name}`,
      url: release.announcementUrl,
    });
  }

  const upgrades = pairs.filter((p) => p.relation === "upgrade");
  const rivals = pairs.filter((p) => p.relation !== "upgrade" && p.current);
  const earlier = pairs.filter((p) => p.relation !== "upgrade" && !p.current);

  return (
    <article className="catalog-page">
      <Breadcrumbs
        trail={[
          { name: "Models", href: "/models" },
          { name: release.name, href: `/models/${release.slug}` },
        ]}
      />
      <header className="page-head">
        <h1>
          <ProviderLogo provider={release.provider} size={30} />
          {release.name}
        </h1>
        <p className="page-meta">
          <span>{lab.name}</span>
          <span>
            Released{" "}
            <time dateTime={release.releaseDate}>{formatFullDate(release.releaseDate)}</time>
          </span>
          <span>
            {release.supersededOn ? (
              <>
                Superseded{" "}
                <time dateTime={release.supersededOn}>{formatFullDate(release.supersededOn)}</time>
              </>
            ) : (
              "Current"
            )}
          </span>
          {starredToday && <FrontierStar size={9} labelled />}
        </p>
      </header>

      <p className="lead">
        {copy.lead}
        {run && <Cite n={cite.tb} />}
        {release.epoch.length > 0 && <Cite n={cite.epoch} />} {copy.standing}
      </p>

      <dl className="stats">
        <div>
          <dt>Terminal-Bench</dt>
          <dd>
            {run ? pct(run.accuracy) : "No run yet"}
            <span>
              {run ? `${run.agent} · ${effortName(run.effort)}` : "Not on the leaderboard"}
            </span>
          </dd>
        </div>
        <div>
          <dt>Cost per task</dt>
          <dd>
            {run?.costPerTaskUsd != null ? formatUsd(run.costPerTaskUsd) : "—"}
            <span>
              {run
                ? `${formatTokens(run.tokensPerTask.output)} output tokens`
                : "Needs a Terminal-Bench run"}
            </span>
          </dd>
        </div>
        <div>
          <dt>MirrorCode</dt>
          <dd>
            {mirror ? pct(mirror.score) : "—"}
            <span>
              {mirror ? `Epoch AI · ${effortName(mirror.effort)}` : "Not run by Epoch AI"}
            </span>
          </dd>
        </div>
        <div>
          <dt>API price</dt>
          <dd>
            {pricing
              ? `${formatPrice(pricing.inputPer1M)}/${formatPrice(pricing.outputPer1M)}`
              : "—"}
            <span>{pricing ? "per 1M input/output tokens" : "Not listed yet"}</span>
          </dd>
        </div>
      </dl>

      {run && (
        <CatalogChart
          releases={field}
          scale={catalog.chartScale}
          selectedSlug={release.slug}
          caption={`${release.name}'s Terminal-Bench run against every current model. The dashed line is the cost frontier: no model scores higher for less. Choose another model's dot to open its page.`}
        />
      )}

      <section aria-labelledby="terminal-bench">
        <h2 id="terminal-bench">On Terminal-Bench</h2>
        {run ? (
          <>
            <p>
              {TERMINAL_BENCH.label} has {TERMINAL_BENCH.tasks} tasks done in a terminal, from
              building software to fixing systems. This run drove {release.name} through{" "}
              {run.agentUrl ? <a href={run.agentUrl}>{agentLabel(run)}</a> : agentLabel(run)} and
              was graded on version {run.version} of the tasks.
              <Cite n={cite.tb} />
            </p>
            <dl className="facts-list">
              <div>
                <dt>Trials passed</dt>
                <dd>
                  {run.successes} of {run.trials}, {pct(run.accuracy)}
                  {run.ci95 !== null && ` ±${run.ci95.toFixed(1)}`}
                </dd>
              </div>
              <div>
                <dt>Setting</dt>
                <dd>{effortName(run.effort)}</dd>
              </div>
              <div>
                <dt>Cost per task</dt>
                <dd>
                  {run.costPerTaskUsd !== null ? formatUsd(run.costPerTaskUsd) : "Not reported"}
                </dd>
              </div>
              <div>
                <dt>Output tokens per task</dt>
                <dd>{formatTokens(run.tokensPerTask.output)}</dd>
              </div>
              <div>
                <dt>All tokens per task</dt>
                <dd>{formatTokens(run.tokensPerTask.total)}</dd>
              </div>
              {run.minutesPerTask !== null && (
                <div>
                  <dt>Minutes per task</dt>
                  <dd>{Math.round(run.minutesPerTask)}</dd>
                </div>
              )}
            </dl>
            <p className="legend">
              ± is the 95% confidence interval the run reported. All tokens include input and cached
              input, which an agent rereads on every turn.
            </p>
          </>
        ) : (
          <p>
            {release.name} has no run on the official Terminal-Bench leaderboard yet, so it has no
            cost per task and no place on the chart. This page adds one when a run is published.
            <Cite n={cite.tb} />
          </p>
        )}
        {run?.costPerTaskUsd != null && (
          <>
            <dl className="star-list">
              <div>
                <dt>Frontier star</dt>
                {!release.deprecated && (
                  <dd>
                    <StarLine label="Today" starred={starredToday} />
                  </dd>
                )}
                <dd>
                  <StarLine label="At release" starred={starredAtRelease} context="release" />
                </dd>
              </div>
            </dl>
            <p className="legend">
              A star marks a model on the cost frontier: for its cost per task, no other model
              scores higher on Terminal-Bench.{" "}
              {release.deprecated ? "" : "Today counts the current models; "}At release counts the
              models out on {formatFullDate(release.releaseDate)}. Models under 75% of the top score
              do not earn one.
            </p>
          </>
        )}
        {agentPages.length > 0 && run && (
          <p className="onward">
            Compare {run.agent} with other coding agents:{" "}
            {agentPages.map((p, i) => (
              <span key={p.slug}>
                {i > 0 && " · "}
                <a href={`/agents/${p.slug}`}>
                  {p.first.name} vs {p.second.name}
                </a>
              </span>
            ))}
          </p>
        )}
      </section>

      <section aria-labelledby="epoch">
        <h2 id="epoch">Epoch AI scores</h2>
        {epochRows.length > 0 ? (
          <div className="table-scroll" role="region" aria-labelledby="epoch-caption" tabIndex={0}>
            <table className="data-table">
              <caption id="epoch-caption">
                {release.name} alone, without an agent, at each setting Epoch AI ran. ± is one
                standard error.
                <Cite n={cite.epoch} />
              </caption>
              <thead>
                <tr>
                  <th scope="col">Benchmark</th>
                  <th scope="col">Setting</th>
                  <th scope="col">Score</th>
                  <th scope="col">Run on</th>
                </tr>
              </thead>
              <tbody>
                {epochRows.map((score) => {
                  const meta = EPOCH_BENCHMARKS.find((m) => m.id === score.benchmark)!;
                  return (
                    <tr key={`${score.benchmark}:${score.effort ?? "default"}`}>
                      <th scope="row">
                        <a href={meta.url}>{meta.label}</a>
                      </th>
                      <td>{effortName(score.effort)}</td>
                      <td>
                        {pct(score.score)}
                        {score.stderr !== null && (
                          <span className="cell-note">±{score.stderr.toFixed(1)}</span>
                        )}
                      </td>
                      <td>
                        {score.runOn ? (
                          <time dateTime={score.runOn}>{formatFullDate(score.runOn)}</time>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            Epoch AI hasn&apos;t published scores for {release.name} yet.
            <Cite n={cite.epoch} />
          </p>
        )}
        {epochRows.length > 0 &&
          EPOCH_BENCHMARKS.filter((meta) => epochRows.some((s) => s.benchmark === meta.id)).map(
            (meta) => (
              <p key={meta.id} className="legend">
                <strong>{meta.label}</strong>: {meta.description}
              </p>
            ),
          )}
      </section>

      <section aria-labelledby="pricing">
        <h2 id="pricing">Pricing</h2>
        {pricing ? (
          <>
            <dl className="facts-list">
              <div>
                <dt>Input</dt>
                <dd>{formatPrice(pricing.inputPer1M)} per million tokens</dd>
              </div>
              {pricing.cachedInputPer1M !== null && (
                <div>
                  <dt>Cached input</dt>
                  <dd>{formatPrice(pricing.cachedInputPer1M)} per million tokens</dd>
                </div>
              )}
              <div>
                <dt>Output</dt>
                <dd>{formatPrice(pricing.outputPer1M)} per million tokens</dd>
              </div>
              {pricing.maxInputTokens !== null && (
                <div>
                  <dt>Longest input</dt>
                  <dd>{formatContext(pricing.maxInputTokens)} tokens</dd>
                </div>
              )}
            </dl>
            <p>
              Token prices set the rate; how many tokens a task spends sets the bill.
              <Cite n={cite.prices} />
              {run && (
                <>
                  {" "}
                  In its Terminal-Bench run, {release.name} wrote{" "}
                  {formatTokens(run.tokensPerTask.output)} output tokens per task
                  {run.costPerTaskUsd !== null
                    ? ` and reported ${formatUsd(run.costPerTaskUsd)} per task`
                    : ""}
                  .<Cite n={cite.tb} />
                </>
              )}
            </p>
          </>
        ) : (
          <p>
            LiteLLM&apos;s price list has no entry for {release.name} yet.
            <Cite n={cite.prices} />
          </p>
        )}
      </section>

      {pairs.length > 0 && (
        <section aria-labelledby="compare">
          <h2 id="compare">Compare {release.name}</h2>
          {upgrades.length > 0 && <PairList title="Upgrades" pairs={upgrades} from={release} />}
          {rivals.length > 0 && <PairList title="Current models" pairs={rivals} from={release} />}
          {earlier.length > 0 && (
            <PairList
              title={release.deprecated ? "Models it was current with" : "Earlier models"}
              pairs={earlier}
              from={release}
            />
          )}
        </section>
      )}

      <Questions items={copy.questions} />

      <Sources
        scope={
          <>
            The Terminal-Bench result is this model&apos;s run on the official leaderboard: the
            agent attempts all {TERMINAL_BENCH.tasks} tasks at least five times, errored trials
            count as failures, and passing trials are checked for reward hacking. Cost per task is
            what the run reported. Epoch AI&apos;s scores test the model alone, under CC BY 4.0. API
            prices come from LiteLLM&apos;s price list. Frontier stars compare current models only.
            Written by aicharts from data checked {formatFullDate(catalog.dataset.snapshotDate)}.
            Prices and scores change as labs update their models.
          </>
        }
        sources={sources}
      />

      <p className="page-action">
        <a href={`/?release=${release.slug}`}>Open {release.name} in the explorer</a>
      </p>
    </article>
  );
}

function StarLine({
  label,
  starred,
  context = "live",
}: Readonly<{
  label: string;
  starred: boolean;
  context?: "live" | "release";
}>) {
  return (
    <span className="star-line">
      <span className="muted">{label}:</span>{" "}
      {starred ? <FrontierStar size={10} context={context} labelled /> : <span>no star</span>}
    </span>
  );
}
