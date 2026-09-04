import type {
  ArtificialAnalysisIntelligenceRecord,
  ArtificialAnalysisIntelligenceSnapshot,
} from "@/lib/artificial-analysis-intelligence-data";
import { layoutChartLabels } from "@/lib/chart-label-layout";
import {
  comparableIntelligenceRecords,
  focusModelComparison,
  intelligenceEfficiencyMetricValue,
  intelligenceScoreDomain,
  logScale,
  logTicks,
  orderedParetoPath,
  paddedLogDomain,
  paretoMembership,
  type IntelligenceEfficiencyMetric,
  type NumericDomain,
} from "@/lib/intelligence-efficiency";

import "@/styles/intelligence-efficiency.css";

const CHART_WIDTH = 640;
const CHART_HEIGHT = 386;
const PLOT = { bottom: 326, left: 52, right: 626, top: 20 } as const;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});
const indexFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});
const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const tokenTableFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});
const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});
const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

type ChartPoint = Readonly<{
  record: ArtificialAnalysisIntelligenceRecord;
  x: number;
  y: number;
}>;

type MetricPresentation = Readonly<{
  axisLabel: string;
  formatTick: (value: number) => string;
  title: string;
}>;

const metricPresentations: Readonly<Record<IntelligenceEfficiencyMetric, MetricPresentation>> = {
  costUsdPerTask: {
    axisLabel: "US dollars per Intelligence Index task · log scale",
    formatTick: formatCompactUsd,
    title: "Cost per task",
  },
  outputTokensPerTask: {
    axisLabel: "Output tokens per Intelligence Index task · log scale",
    formatTick: formatCompactTokens,
    title: "Output tokens per task",
  },
};

function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? String(millions) : millions.toFixed(1)}m`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${Number.isInteger(thousands) ? String(thousands) : thousands.toFixed(1)}k`;
  }
  return integerFormatter.format(value);
}

function formatCompactUsd(value: number): string {
  if (value >= 100) return `$${integerFormatter.format(value)}`;
  if (value >= 10) return `$${value.toFixed(0)}`;
  if (value >= 1) return `$${Number.isInteger(value) ? String(value) : value.toFixed(1)}`;
  if (value >= .1) return `$${value.toFixed(2)}`;
  if (value >= .01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function formatTableUsd(value: number): string {
  if (value < .01) return `$${value.toFixed(4)}`;
  if (value < .1) return `$${value.toFixed(3)}`;
  return currencyFormatter.format(value);
}

function linearScale(domain: NumericDomain, range: NumericDomain): (value: number) => number {
  const domainSpan = domain[1] - domain[0];
  const rangeSpan = range[1] - range[0];
  return value => range[0] + ((value - domain[0]) / domainSpan) * rangeSpan;
}

function pathThrough(points: readonly Readonly<{ x: number; y: number }>[]): string {
  return points.map((point, index) => (
    `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  )).join(" ");
}

function chartLabel(record: ArtificialAnalysisIntelligenceRecord): string {
  return record.shortName.length <= 31
    ? record.shortName
    : `${record.shortName.slice(0, 30)}…`;
}

function labelWidth(label: string): number {
  return Math.min(174, Math.max(58, label.length * 5.25 + 8));
}

function closestLabelEdge(
  point: Readonly<{ x: number; y: number }>,
  placement: Readonly<{ height: number; width: number; x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  return {
    x: Math.max(placement.x, Math.min(point.x, placement.x + placement.width)),
    y: Math.max(placement.y, Math.min(point.y, placement.y + placement.height)),
  };
}

function PointGlyph({
  isAstra,
  isFrontier,
  isSol,
  point,
}: Readonly<{
  isAstra: boolean;
  isFrontier: boolean;
  isSol: boolean;
  point: ChartPoint;
}>) {
  const className = [
    "intelligence-efficiency__point",
    isFrontier ? "intelligence-efficiency__point--frontier" : "",
    isAstra ? "intelligence-efficiency__point--astra" : "",
    isSol ? "intelligence-efficiency__point--sol" : "",
  ].filter(Boolean).join(" ");

  if (isAstra) {
    return <rect className={className} height="9" width="9" x={point.x - 4.5} y={point.y - 4.5} />;
  }
  if (isSol) {
    return (
      <path
        className={className}
        d={`M ${point.x.toFixed(2)} ${(point.y - 5).toFixed(2)} L ${(point.x + 5).toFixed(2)} ${(point.y + 4).toFixed(2)} L ${(point.x - 5).toFixed(2)} ${(point.y + 4).toFixed(2)} Z`}
      />
    );
  }
  if (isFrontier) {
    return (
      <path
        className={className}
        d={`M ${point.x.toFixed(2)} ${(point.y - 4).toFixed(2)} L ${(point.x + 4).toFixed(2)} ${point.y.toFixed(2)} L ${point.x.toFixed(2)} ${(point.y + 4).toFixed(2)} L ${(point.x - 4).toFixed(2)} ${point.y.toFixed(2)} Z`}
      />
    );
  }
  return <circle className={className} cx={point.x} cy={point.y} r="2.4" />;
}

function IntelligenceEfficiencyChart({
  cohort,
  focusIds,
  metric,
  yDomain,
}: Readonly<{
  cohort: readonly ArtificialAnalysisIntelligenceRecord[];
  focusIds: Readonly<{ astra: string | null; sol: string | null }>;
  metric: IntelligenceEfficiencyMetric;
  yDomain: NumericDomain;
}>) {
  const presentation = metricPresentations[metric];
  const xValues = cohort.map(record => {
    const value = intelligenceEfficiencyMetricValue(record, metric);
    if (value === null || value <= 0) throw new Error("Comparable cohort metric invariant failed.");
    return value;
  });
  const xDomain = paddedLogDomain(xValues);
  const scaleX = logScale(xDomain, [PLOT.left, PLOT.right]);
  const scaleY = linearScale(yDomain, [PLOT.bottom, PLOT.top]);
  const membership = paretoMembership(cohort, metric);
  const points: readonly ChartPoint[] = cohort.map((record, index) => ({
    record,
    x: scaleX(xValues[index] ?? 1),
    y: scaleY(record.intelligenceIndex),
  }));
  const pointsById = new Map(points.map(point => [point.record.id, point]));
  const pathPoints = orderedParetoPath(cohort, metric).flatMap(point => {
    const plotted = pointsById.get(point.record.id);
    return plotted === undefined ? [] : [plotted];
  });
  const labeledPoints = points.filter(point => (
    membership.has(point.record.id)
    || point.record.id === focusIds.astra
    || point.record.id === focusIds.sol
  ));
  const placements = layoutChartLabels(
    labeledPoints.map(point => {
      const label = chartLabel(point.record);
      return {
        height: 17,
        id: point.record.id,
        priority: point.record.id === focusIds.astra
          ? 4
          : point.record.id === focusIds.sol ? 3 : 1,
        width: labelWidth(label),
        x: point.x,
        y: point.y,
      };
    }),
    { bottom: PLOT.bottom - 3, left: PLOT.left + 4, right: PLOT.right - 4, top: PLOT.top + 3 },
    {
      gap: 2,
      maxRings: 18,
      offset: 8,
      obstacles: labeledPoints.map(point => ({
        height: 10,
        width: 10,
        x: point.x - 5,
        y: point.y - 5,
      })),
    },
  );
  const xTicks = logTicks(xDomain);
  const yTicks = Array.from(
    { length: Math.floor(yDomain[1] / 10) + 1 },
    (_, index) => index * 10,
  );
  const titleId = `intelligence-efficiency-${metric}-title`;
  const descriptionId = `intelligence-efficiency-${metric}-description`;

  return (
    <figure className="intelligence-efficiency__figure">
      <figcaption>
        <h3>{presentation.title}</h3>
        <p>
          Upper left is better · identical {cohort.length}-configuration cohort
          <span className="intelligence-efficiency__pan-hint"> · Pan chart ↔</span>
        </p>
      </figcaption>
      <div
        aria-label={`${presentation.title} chart. Scroll horizontally for the full plot.`}
        className="intelligence-efficiency__plot-scroll"
        role="region"
        tabIndex={0}
      >
        <svg
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          className="intelligence-efficiency__svg"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        >
          <title id={titleId}>
            {`Artificial Analysis Intelligence Index by ${presentation.title.toLowerCase()}`}
          </title>
          <desc id={descriptionId}>
            {`${cohort.length} model configurations. Intelligence uses the shared ${yDomain[0]} to ${yDomain[1]} vertical scale. ${presentation.axisLabel}. Small dots provide context, diamonds mark the AI Charts-derived Pareto frontier, a square marks GPT-6 Astra at max effort, and a triangle marks GPT-5.6 Sol at max effort.`}
          </desc>

        <g aria-hidden="true" className="intelligence-efficiency__grid">
          {yTicks.map(tick => (
            <g key={tick}>
              <line x1={PLOT.left} x2={PLOT.right} y1={scaleY(tick)} y2={scaleY(tick)} />
              <text textAnchor="end" x={PLOT.left - 10} y={scaleY(tick) + 4}>{tick}</text>
            </g>
          ))}
        </g>

        <g aria-hidden="true" className="intelligence-efficiency__x-axis">
          <line x1={PLOT.left} x2={PLOT.right} y1={PLOT.bottom} y2={PLOT.bottom} />
          {xTicks.map(tick => (
            <g key={tick}>
              <line x1={scaleX(tick)} x2={scaleX(tick)} y1={PLOT.bottom} y2={PLOT.bottom + 5} />
              <text textAnchor="middle" x={scaleX(tick)} y={PLOT.bottom + 19}>
                {presentation.formatTick(tick)}
              </text>
            </g>
          ))}
          <text className="intelligence-efficiency__axis-title" textAnchor="middle" x={(PLOT.left + PLOT.right) / 2} y={CHART_HEIGHT - 12}>
            {presentation.axisLabel}
          </text>
          <text className="intelligence-efficiency__better" x={PLOT.left + 2} y={PLOT.top + 10}>higher ↑</text>
        </g>

        {pathPoints.length < 2 ? null : (
          <path
            aria-hidden="true"
            className="intelligence-efficiency__frontier-line"
            d={pathThrough(pathPoints)}
          />
        )}

        <g aria-hidden="true" className="intelligence-efficiency__points">
          {points.map(point => (
            <PointGlyph
              isAstra={point.record.id === focusIds.astra}
              isFrontier={membership.has(point.record.id)}
              isSol={point.record.id === focusIds.sol}
              key={point.record.id}
              point={point}
            />
          ))}
        </g>

        <g aria-hidden="true" className="intelligence-efficiency__leaders">
          {labeledPoints.map(point => {
            const placement = placements.get(point.record.id);
            if (placement === undefined) return null;
            const edge = closestLabelEdge(point, placement);
            const isFocus = point.record.id === focusIds.astra
              || point.record.id === focusIds.sol;
            return (
              <line
                className={isFocus ? "intelligence-efficiency__leader--focus" : undefined}
                key={point.record.id}
                x1={point.x}
                x2={edge.x}
                y1={point.y}
                y2={edge.y}
              />
            );
          })}
        </g>

        <g aria-hidden="true" className="intelligence-efficiency__labels">
          {labeledPoints.map(point => {
            const placement = placements.get(point.record.id);
            if (placement === undefined) return null;
            return (
              <text
                className={point.record.id === focusIds.astra || point.record.id === focusIds.sol
                  ? "intelligence-efficiency__label intelligence-efficiency__label--focus"
                  : "intelligence-efficiency__label"}
                key={point.record.id}
                x={placement.x + 4}
                y={placement.y + 12}
              >
                {chartLabel(point.record)}
              </text>
            );
          })}
        </g>
        </svg>
      </div>
    </figure>
  );
}

function relativePhrase(
  value: number,
  positive: string,
  negative: string,
): string {
  return `${percentFormatter.format(Math.abs(value))}% ${value >= 0 ? positive : negative}`;
}

function methodologySummary(snapshot: ArtificialAnalysisIntelligenceSnapshot): string {
  const weights = snapshot.benchmark.categoryWeightsPercent;
  return [
    `agents ${weights.agents}%`,
    `coding ${weights.coding}%`,
    `scientific ${weights.scientific}%`,
    `general ${weights.general}%`,
  ].join(" · ");
}

export function HomeIntelligenceEfficiency({
  snapshot,
}: Readonly<{ snapshot: ArtificialAnalysisIntelligenceSnapshot }>) {
  const cohort = comparableIntelligenceRecords(snapshot.records);
  const yDomain = intelligenceScoreDomain(cohort);
  const comparison = focusModelComparison(cohort);
  const retrievedAt = new Date(snapshot.source.retrievedAt);
  const retrievalLabel = Number.isNaN(retrievedAt.valueOf())
    ? snapshot.source.retrievedAt
    : dateFormatter.format(retrievedAt);
  const focusIds = {
    astra: comparison?.astra.id ?? null,
    sol: comparison?.sol.id ?? null,
  };

  return (
    <section
      aria-labelledby="home-intelligence-efficiency-title"
      className="intelligence-efficiency"
      data-analytics-surface="benchmark_chart"
    >
      <header className="intelligence-efficiency__header">
        <div>
          <p className="intelligence-efficiency__eyebrow">General capability · model-level</p>
          <h2 id="home-intelligence-efficiency-title">
            Artificial Analysis Intelligence Index v{snapshot.benchmark.version}
          </h2>
        </div>
        <p className="intelligence-efficiency__definition">
          Output tokens are answer plus reasoning generated per Intelligence Index task.
          They exclude input and cache traffic. These output-only model observations are
          separate from the coding-agent configurations and total-token measurement below.
        </p>
      </header>

      {comparison === null ? null : (
        <p className="intelligence-efficiency__finding">
          <strong>Current read.</strong>{" "}
          {"At max effort, "}
          {comparison.roundedIntelligenceScore === null
            ? `GPT-6 Astra scores ${indexFormatter.format(comparison.astra.intelligenceIndex)} and GPT-5.6 Sol scores ${indexFormatter.format(comparison.sol.intelligenceIndex)}.`
            : `GPT-6 Astra and GPT-5.6 Sol both round to ${comparison.roundedIntelligenceScore} on the publisher’s displayed index.`}
          {" Astra uses "}
          {relativePhrase(comparison.outputTokenReductionPercent, "fewer", "more")}
          {" output tokens per task and has "}
          {relativePhrase(comparison.costIncreasePercent, "higher", "lower")}
          {" cost per task."}
        </p>
      )}

      {cohort.length === 0 ? (
        <p className="intelligence-efficiency__empty">
          No configurations meet the complete model-level comparison rule in this snapshot.
        </p>
      ) : (
        <div className="intelligence-efficiency__charts">
          <IntelligenceEfficiencyChart
            cohort={cohort}
            focusIds={focusIds}
            metric="outputTokensPerTask"
            yDomain={yDomain}
          />
          <IntelligenceEfficiencyChart
            cohort={cohort}
            focusIds={focusIds}
            metric="costUsdPerTask"
            yDomain={yDomain}
          />
        </div>
      )}

      <div className="intelligence-efficiency__legend" role="list" aria-label="Chart symbols">
        <span role="listitem"><i data-symbol="context" />Model configuration</span>
        <span role="listitem"><i data-symbol="frontier" />AI Charts-derived Pareto frontier</span>
        <span role="listitem"><i data-symbol="astra" />GPT-6 Astra · max effort</span>
        <span role="listitem"><i data-symbol="sol" />GPT-5.6 Sol · max effort</span>
      </div>

      <footer className="intelligence-efficiency__provenance">
        <p>
          <strong>Source.</strong>{" "}
          <a
            data-analytics-destination-id="source:artificial-analysis"
            data-analytics-destination-kind="source"
            href={snapshot.source.url}
          >
            {snapshot.source.name} public models leaderboard
          </a>
          {" · Retrieved "}
          <time dateTime={snapshot.source.retrievedAt}>{retrievalLabel}</time>
          {" · First-party public Next.js page payload."}
        </p>
        <p>
          <strong>Selection.</strong>{" "}
          The source has {snapshot.selection.sourceRecordCount} records;{" "}
          {snapshot.selection.measuredCompleteRecordCount} meet the current, non-estimated
          complete-measure rule. Both panels use the same {cohort.length} configurations that
          also report a positive task cost. No benchmark families are blended.
        </p>
        <p>
          <strong>Method.</strong>{" "}
          AI Charts computes each lower-resource, higher-score Pareto frontier from the checked snapshot.
          The publisher’s {snapshot.benchmark.evaluationCount}-evaluation index weights{" "}
          {methodologySummary(snapshot)}.{" "}
          <a
            data-analytics-destination-id="source:artificial-analysis-methodology"
            data-analytics-destination-kind="source"
            href={snapshot.source.methodologyUrl}
          >
            Methodology
          </a>
          {" · "}
          <a
            data-analytics-destination-id="source:artificial-analysis-terms"
            data-analytics-destination-kind="source"
            href={snapshot.source.termsUrl}
          >
            Source terms
          </a>
        </p>
      </footer>

      <details className="intelligence-efficiency__table-details">
        <summary>View all {cohort.length} comparable configurations</summary>
        <div className="intelligence-efficiency__table-scroll">
          <table className="intelligence-efficiency__table">
            <caption>
              Complete model-configuration Artificial Analysis Intelligence Index efficiency records
            </caption>
            <thead>
              <tr>
                <th scope="col">Cohort rank</th>
                <th scope="col">Model</th>
                <th scope="col">Creator</th>
                <th scope="col">Intelligence</th>
                <th scope="col">Output tokens / task</th>
                <th scope="col">Cost / task</th>
                <th scope="col">Released</th>
              </tr>
            </thead>
            <tbody>
              {cohort.map((record, index) => (
                <tr key={record.id}>
                  <th scope="row">{index + 1}</th>
                  <td>
                    <a
                      data-analytics-destination-id="source:artificial-analysis"
                      data-analytics-destination-kind="source"
                      href={record.detailsUrl}
                    >
                      {record.name}
                    </a>
                  </td>
                  <td>{record.creator.name}</td>
                  <td><data value={record.intelligenceIndex}>{indexFormatter.format(record.intelligenceIndex)}</data></td>
                  <td><data value={record.outputTokensPerTask.total}>{tokenTableFormatter.format(record.outputTokensPerTask.total)}</data></td>
                  <td>
                    {record.costUsdPerTask === null
                      ? "Not reported"
                      : <data value={record.costUsdPerTask.total}>{formatTableUsd(record.costUsdPerTask.total)}</data>}
                  </td>
                  <td><time dateTime={record.releaseDate}>{record.releaseDate}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
