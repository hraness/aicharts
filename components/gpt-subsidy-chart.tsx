import {
  formatSubsidyDate,
  formatSubsidyMultiple,
  formatSubsidyTokens,
  formatSubsidyUsd,
  type GptSubsidyObservation,
  type GptSubsidySnapshot,
} from "@/lib/gpt-subsidy-data";

const WIDTH = 960;
const HEIGHT = 340;
const MARGIN = { bottom: 48, left: 56, right: 22, top: 22 } as const;
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

type Point = Readonly<{
  observation: GptSubsidyObservation;
  x: number;
  y: number;
}>;

function pathThrough(points: readonly Readonly<{ x: number; y: number }>[]): string {
  return points.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
  ).join(" ");
}

function boundedDomain(observations: readonly GptSubsidyObservation[]) {
  const minimum = Math.min(...observations.map(point => point.planPriceMultiple));
  const maximum = Math.max(...observations.map(point => point.planPriceMultiple));
  const observedSpan = maximum - minimum;
  const padding = observedSpan === 0
    ? Math.max(Math.abs(maximum) * 0.05, 1)
    : Math.max(observedSpan * 0.08, 1);
  const lower = Math.max(0, minimum - padding);
  const upper = Math.max(maximum + padding, lower + 1);
  const rawStep = (upper - lower) / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalizedStep = rawStep / magnitude;
  const step = (
    normalizedStep <= 1 ? 1
      : normalizedStep <= 2 ? 2
        : normalizedStep <= 5 ? 5 : 10
  ) * magnitude;
  const firstGuide = Math.ceil(lower / step) * step;
  const guides: number[] = [];
  for (let guide = firstGuide; guide <= upper; guide += step) {
    guides.push(guide);
  }

  return {
    guides: guides.length >= 2
      ? guides
      : [lower, lower + (upper - lower) / 2, upper],
    lower,
    upper,
  };
}

export function GptSubsidyChart({
  snapshot,
}: Readonly<{ snapshot: GptSubsidySnapshot }>) {
  const observations = snapshot.observations;
  const xValues = observations.map(point => Date.parse(point.observedAt));
  const rawMinimumX = Math.min(...xValues);
  const rawMaximumX = Math.max(...xValues);
  const day = 24 * 60 * 60 * 1_000;
  const minimumX = rawMinimumX === rawMaximumX ? rawMinimumX - day : rawMinimumX;
  const maximumX = rawMinimumX === rawMaximumX ? rawMaximumX + day : rawMaximumX;
  const yDomain = boundedDomain(observations);

  const xScale = (value: number) => MARGIN.left
    + ((value - minimumX) / (maximumX - minimumX)) * PLOT_WIDTH;
  const yScale = (value: number) => MARGIN.top
    + (1 - ((value - yDomain.lower) / (yDomain.upper - yDomain.lower)))
      * PLOT_HEIGHT;

  const points: readonly Point[] = observations.map(observation => ({
    observation,
    x: xScale(Date.parse(observation.observedAt)),
    y: yScale(observation.planPriceMultiple),
  }));
  const latestPoint = points.at(-1);

  const centralPath = pathThrough(points);
  const yTicks = yDomain.guides;
  const xTickIndexes = Array.from(new Set(
    observations.length <= 5
      ? observations.map((_, index) => index)
      : [0, Math.round((observations.length - 1) / 2), observations.length - 1],
  ));

  return (
    <figure className="gpt-subsidy-chart">
      <div className="gpt-subsidy-chart__plot">
        <svg
          aria-describedby="gpt-subsidy-chart-description"
          aria-labelledby="gpt-subsidy-chart-title"
          className="gpt-subsidy-chart__svg"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <title id="gpt-subsidy-chart-title">
            Four-week API-retail-equivalent multiple over time
          </title>
          <desc id="gpt-subsidy-chart-description">
            {observations.length} daily observations. The line shows the
            API-retail-equivalent plan-price multiple derived from each
            trailing seven-day period. Historical points are subdued and the
            latest point is emphasized.
          </desc>

          <g aria-hidden="true" className="gpt-subsidy-chart__grid">
            {yTicks.map(tick => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={WIDTH - MARGIN.right}
                  y1={yScale(tick)}
                  y2={yScale(tick)}
                />
                <text
                  textAnchor="end"
                  x={MARGIN.left - 12}
                  y={yScale(tick) + 4}
                >
                  {tick}×
                </text>
              </g>
            ))}
          </g>

          <g aria-hidden="true" className="gpt-subsidy-chart__dates">
            {xTickIndexes.map(index => {
              const observation = observations[index];
              if (observation === undefined) return null;
              const x = xScale(Date.parse(observation.observedAt));
              return (
                <g key={observation.id}>
                  <text
                    textAnchor={index === 0
                      ? "start"
                      : index === observations.length - 1 ? "end" : "middle"}
                    x={x}
                    y={HEIGHT - MARGIN.bottom + 28}
                  >
                    {shortDateFormatter.format(new Date(observation.observedAt))}
                  </text>
                </g>
              );
            })}
          </g>

          <path aria-hidden="true" className="gpt-subsidy-chart__line" d={centralPath} />

          <g aria-hidden="true" className="gpt-subsidy-chart__points">
            {points.slice(0, -1).map(point => (
              <circle
                className="gpt-subsidy-chart__point"
                cx={point.x}
                cy={point.y}
                key={point.observation.id}
                r="3.5"
              />
            ))}
            {latestPoint === undefined ? null : (
              <circle
                className="gpt-subsidy-chart__point gpt-subsidy-chart__point--latest"
                cx={latestPoint.x}
                cy={latestPoint.y}
                r="7"
              />
            )}
          </g>

          <text
            aria-hidden="true"
            className="gpt-subsidy-chart__axis-title"
            textAnchor="middle"
            transform={`translate(17 ${MARGIN.top + PLOT_HEIGHT / 2}) rotate(-90)`}
          >
            Four-week value ÷ $200
          </text>
        </svg>
      </div>

      <figcaption className="gpt-subsidy-chart__caption">
        <span>Each point covers seven complete UTC days</span>
        <span className="gpt-subsidy-chart__scroll-hint">
          Scroll horizontally for all dates
        </span>
      </figcaption>

      <details className="gpt-subsidy-disclosure gpt-subsidy-chart__table-details">
        <summary>View all {observations.length} observations</summary>
        <div className="plain-publication__table-scroll gpt-subsidy-table-scroll">
          <table className="plain-publication__table gpt-subsidy-table">
            <caption>Historical local Codex API-equivalent observations</caption>
            <thead>
              <tr>
                <th scope="col">Observed</th>
                <th scope="col">Period</th>
                <th scope="col">Tokens</th>
                <th scope="col">Four-week estimate</th>
                <th scope="col">Multiple</th>
              </tr>
            </thead>
            <tbody>
              {observations.map(observation => (
                <tr key={observation.id}>
                  <th scope="row">
                    <time dateTime={observation.observedAt}>
                      {formatSubsidyDate(observation.observedAt)}
                    </time>
                  </th>
                  <td>
                    <time dateTime={observation.periodStartedAt}>
                      {formatSubsidyDate(observation.periodStartedAt)}
                    </time>
                    {" – "}
                    <time dateTime={observation.periodEndsAt}>
                      {formatSubsidyDate(observation.periodEndsAt)}
                    </time>
                  </td>
                  <td>{formatSubsidyTokens(observation.tokens.total)}</td>
                  <td>{formatSubsidyUsd(observation.monthlyApiEquivalentUsd)}</td>
                  <td>{formatSubsidyMultiple(observation.planPriceMultiple)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
