import { FrontierStarIcon, ProviderLogo } from "./brand-icon";
import { formatScore, formatTokens, formatUsd, shortModelName } from "@/lib/format";
import { CHART_BENCHMARKS, type CurveBenchmarkId } from "@/lib/benchmarks";
import { benchmarkEfforts } from "@/lib/pareto";
import { bestEpoch, effortName, epochScores } from "@/lib/measures";
import type { BudgetAxis, CurveEffort, EpochBenchmarkMeta, ModelRelease } from "@/lib/types";

export function BenchmarkEfforts({
  benchmark,
  axis,
  release,
  active,
  frontierKeys,
  onSelect,
}: Readonly<{
  benchmark: CurveBenchmarkId;
  axis: BudgetAxis;
  release: ModelRelease;
  active: CurveEffort | null;
  frontierKeys: ReadonlySet<string>;
  onSelect: (effort: CurveEffort) => void;
}>) {
  const runs = benchmarkEfforts(release, benchmark);
  if (!runs.length) return null;
  const { scoreLabel, scoreUnit, workload } = CHART_BENCHMARKS[benchmark];
  const budgetLabel = axis === "cost" ? "Cost" : "Output tokens";
  return (
    <div className="effort-table benchmark-efforts" role="group" aria-label="Reasoning settings">
      <div className="effort-table__head" aria-hidden="true">
        <span>Effort</span>
        <span className="align-right">{scoreLabel}</span>
        <span className="align-right">{budgetLabel} / {workload}</span>
      </div>
      {runs.map((run) => (
        <button
          key={run.effort}
          type="button"
          aria-pressed={run.effort === active}
          className={`effort-row${run.effort === active ? " is-active" : ""}`}
          onClick={() => onSelect(run.effort)}
        >
          <span className="effort-row__name">
            <span className={`effort-dot${run.effort === active ? " is-active" : ""}`} aria-hidden="true" />
            <span className="effort-row__label">{effortName(run.effort)}</span>
            {frontierKeys.has(`${release.slug}:${run.effort}`) && (
              <span className="effort-row__star">
                <FrontierStarIcon size={9} />
                <span className="sr-only">Frontier point</span>
              </span>
            )}
          </span>
          <strong className="effort-row__score mono align-right">{formatScore(run.score, scoreUnit)}</strong>
          <span className="effort-row__cell mono align-right" title={benchmark === "game-bench" ? release.gameBench?.find((game) => game.effort === run.effort)?.costBasis : undefined}>
            {axis === "cost" ? formatUsd(run.costUsd) : run.outputTokens === null ? "—" : formatTokens(run.outputTokens)}
          </span>
        </button>
      ))}
    </div>
  );
}

export function EpochScoreChart({
  benchmark,
  releases,
  selected,
  onSelect,
}: Readonly<{
  benchmark: EpochBenchmarkMeta;
  releases: readonly ModelRelease[];
  selected: ModelRelease;
  onSelect: (slug: string) => void;
}>) {
  const ranked = releases
    .flatMap((release) => {
      const result = bestEpoch(release, benchmark.id);
      return result ? [{ release, result }] : [];
    })
    .sort((a, b) => b.result.score - a.result.score || a.release.name.localeCompare(b.release.name));
  const settings = epochScores(selected, benchmark.id);

  return (
    <div className="epoch-scores" data-benchmark={benchmark.id}>
      <p className="benchmark-note">
        {benchmark.description} <a href={benchmark.url}>Epoch AI results</a>
      </p>
      {ranked.length > 0 && (
        <div className="epoch-score-chart" role="group" aria-label={`${benchmark.label} best scores`}>
          {ranked.map(({ release, result }) => (
            <button
              key={release.slug}
              type="button"
              className={`epoch-score epoch-score--${release.provider}`}
              aria-pressed={release.slug === selected.slug}
              onClick={() => onSelect(release.slug)}
              title={result.stderr === null ? undefined : `Standard error ±${result.stderr} points`}
            >
              <span className="epoch-score__model">
                <ProviderLogo provider={release.provider} size={14} />
                {shortModelName(release.name)}
              </span>
              <span className="epoch-score__track" aria-hidden="true">
                <span className="epoch-score__bar" style={{ width: `${result.score}%` }} />
              </span>
              <span className="epoch-score__value mono">{formatScore(result.score, "%")}</span>
              <span className="sr-only">{effortName(result.effort)} effort</span>
            </button>
          ))}
        </div>
      )}
      {settings.length === 0 && (
        <p className="benchmark-note">Epoch AI has yet to publish a {benchmark.label} score for {selected.name}.</p>
      )}
      {settings.length > 1 && (
        <div className="epoch-settings" aria-label={`${selected.name} scores by effort`}>
          {settings.map((result) => (
            <span key={result.effort ?? "default"}>
              {effortName(result.effort)} <strong className="mono">{formatScore(result.score, "%")}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
