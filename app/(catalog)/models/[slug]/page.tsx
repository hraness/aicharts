import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProviderLogo } from "@/components/brand-icon";
import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { CatalogChart } from "@/components/catalog/catalog-chart";
import { EffortTable } from "@/components/catalog/effort-table";
import { PairList } from "@/components/catalog/pair-list";
import { Questions } from "@/components/catalog/questions";
import { Cite, Sources, type Source } from "@/components/catalog/sources";
import { FrontierStars } from "@/components/frontier-stars";
import { pageMetadata } from "@/journal/content";
import {
  bestEffort,
  catalog,
  cheapestEffort,
  defaultEffort,
  EFFORT_NAMES,
  effortName,
  effortsByLevel,
} from "@/lib/catalog";
import { agentPairs } from "@/lib/agents";
import { modelCopy } from "@/lib/copy";
import { formatContext, formatFullDate, formatPrice, formatScore, formatUsd } from "@/lib/format";
import { BENCHMARKS, PROVIDERS, type EffortPoint, type EffortSlug } from "@/lib/types";

type Params = Promise<{ slug: string }>;

export const dynamicParams = false;

export function generateStaticParams() {
  return catalog.releases.map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const release = catalog.find((await params).slug);
  if (!release) return {};
  return pageMetadata(
    `${release.name} benchmarks, pricing and effort levels`,
    modelCopy(release).description,
    `/models/${release.slug}`,
  );
}

const pct = (e: EffortPoint) => formatScore(e.scores.coding, "%");
const cost = (e: EffortPoint) => formatUsd(e.costUsdPerTask.total);

export default async function ModelPage({ params }: { params: Params }) {
  const release = catalog.find((await params).slug);
  if (!release) notFound();
  const copy = modelCopy(release);
  const lab = PROVIDERS[release.provider];
  const best = bestEffort(release);
  const preset = defaultEffort(release);
  const cheapest = cheapestEffort(release);
  const stars = release.deprecated ? [] : (catalog.liveFrontier("coding").get(release.slug) ?? []);
  const field = release.deprecated ? [...catalog.current, release] : [...catalog.current];
  const pairs = catalog.pairsFor(release);
  const agentRuns = effortsByLevel(release).filter((e) => e.cliEval);
  const harbor = release.harborEval;

  const sources: Source[] = [
    { name: `Artificial Analysis: ${release.name} evaluations`, url: release.benchmarkUrl },
    { name: `${lab.name}: ${release.name}`, url: release.announcementUrl },
  ];
  // push() returns the new length, which is the 1-based citation number.
  const agentSource = agentRuns.length > 0 ? sources.push({
    name: "Artificial Analysis: Coding Agents",
    url: "https://artificialanalysis.ai/agents/coding-agents/",
  }) : null;
  const agentPages = agentPairs().filter((p) => p.first.name === lab.harness || p.second.name === lab.harness);
  const harborSource = harbor
    ? sources.push({ name: "Terminal-Bench leaderboard", url: "https://tbench.ai" })
    : null;

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
            Released <time dateTime={release.releaseDate}>{formatFullDate(release.releaseDate)}</time>
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
          {stars.length > 0 && <FrontierStars efforts={stars} size={9} labelled />}
        </p>
      </header>

      <p className="lead">
        {copy.lead}
        <Cite n={1} /> {copy.standing}
      </p>

      <dl className="stats">
        <div>
          <dt>Best coding score</dt>
          <dd>
            {pct(best)}
            <span>
              {effortName(best.effortSlug)} · {cost(best)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Default effort</dt>
          <dd>
            {effortName(preset.effortSlug)}
            <span>
              {pct(preset)} · {cost(preset)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Cheapest setting</dt>
          <dd>
            {cost(cheapest)}
            <span>
              {effortName(cheapest.effortSlug)} · {pct(cheapest)}
            </span>
          </dd>
        </div>
        <div>
          <dt>API price</dt>
          <dd>
            {formatPrice(release.pricing.inputPer1M)}/{formatPrice(release.pricing.outputPer1M)}
            <span>per 1M input/output tokens</span>
          </dd>
        </div>
      </dl>

      <CatalogChart
        releases={field}
        selectedSlug={release.slug}
        caption={`${release.name}'s effort settings against every current model. Gold rings mark frontier points; choose another model's point to open its page.`}
      />

      <section aria-labelledby="efforts">
        <h2 id="efforts">Benchmarks at each effort level</h2>
        <EffortTable
          release={release}
          frontier={stars}
          captionId="efforts-caption"
          caption={
            <>
              Coding is the mean of FrontierCode 2.0 and Terminal-Bench 4.0. A star marks a setting on
              the live cost frontier.
              <Cite n={1} />
            </>
          }
        />
      </section>

      <section aria-labelledby="stars">
        <h2 id="stars">Frontier stars by benchmark</h2>
        <p>
          A star marks an effort setting on the cost frontier: for that spend per task, no other
          model scores higher. {release.deprecated ? "" : "Today counts the current models; "}At
          release counts the models out on {formatFullDate(release.releaseDate)}. Settings under 75%
          of the top score do not earn one.
        </p>
        <dl className="star-list">
          {BENCHMARKS.map((benchmark) => (
            <div key={benchmark.id}>
              <dt>{benchmark.fullLabel}</dt>
              {!release.deprecated && (
                <dd>
                  <StarLine
                    label="Today"
                    efforts={catalog.liveFrontier(benchmark.id).get(release.slug) ?? []}
                  />
                </dd>
              )}
              <dd>
                <StarLine
                  label="At release"
                  context="release"
                  efforts={catalog.releaseDayFrontier(benchmark.id).get(release.slug) ?? []}
                />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {copy.steps.length > 0 && (
        <section aria-labelledby="steps">
          <h2 id="steps">Is the next effort level worth it?</h2>
          <ul className="steps">
            {copy.steps.map((step) => (
              <li key={step.text} className={step.drop ? "is-drop" : undefined}>
                {step.text}
                {step.stepSlug && (
                  <>
                    {" "}
                    <a href={`/effort/${step.stepSlug}`}>Compare across models</a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(agentRuns.length > 0 || harbor) && (
        <section aria-labelledby="agent">
          <h2 id="agent">In {lab.harness}</h2>
          {agentRuns.length === 1 && agentSource && (
            <p>
              Artificial Analysis also ran {release.name} inside {lab.harness}, {lab.name}&apos;s
              coding agent. At {effortName(agentRuns[0]!.effortSlug)} effort it scored{" "}
              {agentRuns[0]!.cliEval!.codingAgentScore.toFixed(1)} on the Coding Agent Index for{" "}
              {formatUsd(agentRuns[0]!.cliEval!.costUsdPerTask)} per task.
              <Cite n={agentSource} />
            </p>
          )}
          {agentRuns.length > 1 && agentSource && (
            <div className="table-scroll" role="region" aria-labelledby="agent-caption" tabIndex={0}>
              <table className="data-table">
                <caption id="agent-caption">
                  {release.name} inside {lab.harness}, by effort setting.
                  <Cite n={agentSource} />
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Effort</th>
                    <th scope="col">Coding Agent Index</th>
                    <th scope="col">FrontierCode 2.0</th>
                    <th scope="col">SWE-Atlas</th>
                    <th scope="col">Terminal-Bench 4.1</th>
                    <th scope="col">Cost per task</th>
                  </tr>
                </thead>
                <tbody>
                  {agentRuns.map((e) => (
                    <tr key={e.effortSlug}>
                      <th scope="row">{effortName(e.effortSlug)}</th>
                      <td>{e.cliEval!.codingAgentScore.toFixed(1)}</td>
                      <td>{formatScore(e.cliEval!.frontierCode2, "%")}</td>
                      <td>{formatScore(e.cliEval!.sweAtlas, "%")}</td>
                      <td>{formatScore(e.cliEval!.terminalBench4, "%")}</td>
                      <td>{formatUsd(e.cliEval!.costUsdPerTask)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {harbor && harborSource && (
            <p>
              On the official Terminal-Bench leaderboard, {harbor.agent} with {release.name} at{" "}
              {EFFORT_NAMES[harbor.effort as EffortSlug] ?? harbor.effort} effort passed{" "}
              {formatScore(harbor.accuracy, "%")} of trials at {formatUsd(harbor.costPerTrialUsd)} per
              trial.
              <Cite n={harborSource} />
            </p>
          )}
          {agentPages.length > 0 && (
            <p className="onward">
              Compare {lab.harness} with other coding agents:{" "}
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
      )}

      <section aria-labelledby="pricing">
        <h2 id="pricing">Pricing</h2>
        <dl className="facts-list">
          <div>
            <dt>Input</dt>
            <dd>{formatPrice(release.pricing.inputPer1M)} per million tokens</dd>
          </div>
          {release.pricing.cachedInputPer1M !== null && (
            <div>
              <dt>Cached input</dt>
              <dd>{formatPrice(release.pricing.cachedInputPer1M)} per million tokens</dd>
            </div>
          )}
          <div>
            <dt>Output</dt>
            <dd>{formatPrice(release.pricing.outputPer1M)} per million tokens</dd>
          </div>
          <div>
            <dt>Context window</dt>
            <dd>{formatContext(release.pricing.contextWindowTokens)} tokens</dd>
          </div>
        </dl>
        <p>
          Token prices set the rate; the effort setting sets how many tokens a task spends. That is
          why the same model costs {cost(cheapest)} per task at {effortName(cheapest.effortSlug)}
          {release.efforts.length > 1 ? (
            <>
              {" "}
              and{" "}
              {cost(
                release.efforts.reduce((a, b) =>
                  b.costUsdPerTask.total > a.costUsdPerTask.total ? b : a,
                ),
              )}{" "}
              at its most expensive setting
            </>
          ) : null}
          .<Cite n={1} />
        </p>
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
            Scores, cost per task and output tokens come from Artificial Analysis&apos;s runs at each
            effort setting; the coding composite is the mean of FrontierCode 2.0 and Terminal-Bench
            4.0. Frontier stars compare current models only. Written by aicharts from data checked{" "}
            {formatFullDate(catalog.dataset.snapshotDate)}. Prices and scores change as labs update
            their models.
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
  efforts,
  context = "live",
}: Readonly<{ label: string; efforts: readonly EffortPoint[]; context?: "live" | "release" }>) {
  return (
    <span className="star-line">
      <span className="muted">{label}:</span>{" "}
      {efforts.length > 0 ? (
        <>
          <FrontierStars efforts={efforts} size={10} context={context} />{" "}
          <span>{efforts.map((e) => effortName(e.effortSlug)).join(", ")}</span>
        </>
      ) : (
        <span>no star</span>
      )}
    </span>
  );
}
