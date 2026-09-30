import { BrowserFrame, SampleText } from "@hraness/design-kit/mockups";

import {
  CODING_POINTS,
  INTELLIGENCE_POINTS,
  INTELLIGENCE_RETRIEVED_ON,
  INTELLIGENCE_SOURCE,
  INTELLIGENCE_VERSION,
  bestValueLine,
  hoveredCodingPoint,
  type MockupPoint,
} from "./data";

/**
 * The aicharts score-against-cost chart, drawn as an illustration from the
 * checked snapshots. The live chart is interactive and much richer; this
 * keeps only what one launch beat needs to show.
 */

export const CHART_VIEWS = ["models", "frontier", "tokens", "coding", "source"] as const;
export type ChartView = (typeof CHART_VIEWS)[number];

export function isChartView(value: unknown): value is ChartView {
  return typeof value === "string" && (CHART_VIEWS as readonly string[]).includes(value);
}

const WIDTH = 720;
const HEIGHT = 380;
const PAD = { top: 18, right: 22, bottom: 40, left: 46 } as const;
const MAKER_SLOTS = 6;

/** The makers with the most points get their own colour; the rest share a neutral one. */
function makerSlots(points: readonly MockupPoint[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const point of points) counts.set(point.maker, (counts.get(point.maker) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return new Map(ranked.slice(0, MAKER_SLOTS - 1).map(([maker], index) => [maker, index]));
}

function logScale(values: readonly number[], from: number, to: number): (value: number) => number {
  const logs = values.map(Math.log10);
  const min = Math.floor(Math.min(...logs));
  const max = Math.ceil(Math.max(...logs));
  return (value) => from + ((Math.log10(value) - min) / (max - min || 1)) * (to - from);
}

function logTicks(values: readonly number[]): readonly number[] {
  const logs = values.map(Math.log10);
  const ticks: number[] = [];
  for (let power = Math.floor(Math.min(...logs)); power <= Math.ceil(Math.max(...logs)); power += 1) ticks.push(10 ** power);
  return ticks;
}

function linearScale(values: readonly number[], from: number, to: number): (value: number) => number {
  const min = Math.floor(Math.min(...values) / 10) * 10;
  const max = Math.ceil(Math.max(...values) / 10) * 10;
  return (value) => from - ((value - min) / (max - min || 1)) * (from - to);
}

function money(value: number): string {
  if (value >= 1) return `$${value.toFixed(value >= 10 ? 0 : 2)}`;
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  return `$${value.toPrecision(1)}`;
}

function tickLabel(value: number, unit: "cost" | "tokens"): string {
  if (unit === "tokens") return value >= 1e6 ? `${value / 1e6}M` : value >= 1e3 ? `${value / 1e3}K` : String(value);
  return value >= 1 ? `$${value}` : `$${value}`;
}

type Plot<P extends MockupPoint> = Readonly<{
  points: readonly P[];
  x: (point: P) => number;
  unit: "cost" | "tokens";
  xLabel: string;
  yLabel: string;
  line?: readonly P[];
  highlight?: P;
}>;

function Scatter<P extends MockupPoint>({ highlight, line, points, unit, x, xLabel, yLabel }: Plot<P>) {
  const slots = makerSlots(points);
  const xs = points.map(x);
  const sx = logScale(xs, PAD.left, WIDTH - PAD.right);
  const sy = linearScale(points.map((point) => point.score), HEIGHT - PAD.bottom, PAD.top);
  const scores = points.map((point) => point.score);
  const yMin = Math.floor(Math.min(...scores) / 10) * 10;
  const yMax = Math.ceil(Math.max(...scores) / 10) * 10;
  const yTicks: number[] = [];
  for (let value = yMin; value <= yMax; value += 10) yTicks.push(value);
  const path = line?.map((point, index) => `${index === 0 ? "M" : "L"}${sx(x(point)).toFixed(1)},${sy(point.score).toFixed(1)}`).join(" ");
  return (
    <svg aria-hidden="true" className="acm-scatter" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      {yTicks.map((value) => (
        <g key={`y${value}`}>
          <line className="acm-grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={sy(value)} y2={sy(value)} />
          <text className="acm-tick" textAnchor="end" x={PAD.left - 8} y={sy(value) + 4}>{value}</text>
        </g>
      ))}
      {logTicks(xs).map((value) => (
        <text className="acm-tick" key={`x${value}`} textAnchor="middle" x={sx(value)} y={HEIGHT - PAD.bottom + 18}>{tickLabel(value, unit)}</text>
      ))}
      <text className="acm-axis" textAnchor="middle" x={(PAD.left + WIDTH - PAD.right) / 2} y={HEIGHT - 6}>{xLabel}</text>
      <text className="acm-axis" textAnchor="middle" transform={`translate(12 ${(PAD.top + HEIGHT - PAD.bottom) / 2}) rotate(-90)`}>{yLabel}</text>
      {path === undefined ? null : <path className="acm-frontier" d={path} />}
      {points.map((point) => (
        <circle
          className="acm-point"
          cx={sx(x(point))}
          cy={sy(point.score)}
          data-acm-on-line={line?.includes(point) ? "" : undefined}
          data-acm-series={slots.get(point.maker) ?? MAKER_SLOTS - 1}
          key={point.id}
          r={point === highlight ? 7 : line?.includes(point) ? 5 : 4}
        />
      ))}
      {highlight === undefined ? null : (
        <circle className="acm-point-ring" cx={sx(x(highlight))} cy={sy(highlight.score)} r={12} />
      )}
    </svg>
  );
}

function Legend({ points }: Readonly<{ points: readonly MockupPoint[] }>) {
  const slots = makerSlots(points);
  return (
    <ul aria-hidden="true" className="acm-legend">
      {[...slots.entries()].map(([maker, slot]) => (
        <li data-acm-series={slot} key={maker}><i /><SampleText>{maker}</SampleText></li>
      ))}
      <li data-acm-series={MAKER_SLOTS - 1}><i /><span>Others</span></li>
    </ul>
  );
}

function Toolbar({ active, items }: Readonly<{ items: readonly string[]; active: string }>) {
  return (
    <div aria-hidden="true" className="acm-toggle">
      {items.map((item) => <span data-acm-active={item === active ? "" : undefined} key={item}>{item}</span>)}
    </div>
  );
}

function PageHead({ children, title }: Readonly<{ title: string; children?: React.ReactNode }>) {
  return (
    <div className="acm-head">
      <span className="acm-brand" aria-hidden="true">aicharts</span>
      <strong className="acm-title">{title}</strong>
      {children}
    </div>
  );
}

const DESCRIBE: Readonly<Record<ChartView, string>> = {
  models: "Illustration of the aicharts models chart: AI models plotted by benchmark score against cost per task.",
  frontier: "Illustration of the models chart with the best-value line joining the models nothing cheaper beats.",
  tokens: "Illustration of the models chart switched to output tokens per task on the horizontal axis.",
  coding: "Illustration of the coding chart with one coding-agent setup hovered, showing its model, agent, effort, score, cost and time.",
  source: "Illustration of a chart's source panel: who published the scores, the index version, the day they were checked and the cost unit.",
};

export function ChartMockup({ theme, view }: Readonly<{ view: ChartView; theme?: "light" | "dark" }>) {
  const themed = theme === undefined ? {} : { theme };
  if (view === "coding") {
    const hovered = hoveredCodingPoint();
    const line = bestValueLine(CODING_POINTS);
    return (
      <BrowserFrame {...themed} className="acm" describe={DESCRIBE.coding} url="aicharts.example/coding">
        <PageHead title="Coding agents: score against cost">
          <Toolbar active="Cost" items={["Cost", "Time", "Tokens"]} />
        </PageHead>
        <div className="acm-stage">
          <Scatter highlight={hovered} line={line} points={CODING_POINTS} unit="cost" x={(point) => point.cost} xLabel="Cost per task (USD, log scale)" yLabel="Coding Agent Index" />
          <div className="acm-tooltip" aria-hidden="true">
            <strong><SampleText>{hovered.label}</SampleText></strong>
            <dl>
              <div><dt>Agent</dt><dd><SampleText>{hovered.agent}</SampleText></dd></div>
              <div><dt>Effort</dt><dd><SampleText>{hovered.setting}</SampleText></dd></div>
              <div><dt>Score</dt><dd>{hovered.score.toFixed(1)}</dd></div>
              <div><dt>Cost</dt><dd>{money(hovered.cost)} per task</dd></div>
              <div><dt>Time</dt><dd>{Math.round(hovered.minutes)} min per task</dd></div>
              <div><dt>Tokens</dt><dd>{(hovered.tokens / 1e6).toFixed(1)}M per task</dd></div>
            </dl>
          </div>
        </div>
        <Legend points={CODING_POINTS} />
      </BrowserFrame>
    );
  }
  const tokens = view === "tokens";
  const line = view === "frontier" || view === "source" ? bestValueLine(INTELLIGENCE_POINTS) : undefined;
  return (
    <BrowserFrame {...themed} className="acm" describe={DESCRIBE[view]} url="aicharts.example">
      <PageHead title={`Intelligence Index ${INTELLIGENCE_VERSION} against ${tokens ? "output tokens" : "cost"}`}>
        <Toolbar active={tokens ? "Tokens" : "Cost"} items={["Cost", "Tokens"]} />
      </PageHead>
      <div className="acm-stage">
        <Scatter
          {...(line === undefined ? {} : { line })}
          points={INTELLIGENCE_POINTS}
          unit={tokens ? "tokens" : "cost"}
          x={tokens ? (point) => point.tokens : (point) => point.cost}
          xLabel={tokens ? "Output tokens per task (log scale)" : "Cost per task (USD, log scale)"}
          yLabel="Intelligence Index"
        />
        {view === "frontier" ? <p className="acm-callout" aria-hidden="true">Best value at each price</p> : null}
        {view === "source" ? (
          <div className="acm-tooltip acm-tooltip--source" aria-hidden="true">
            <strong>About this chart</strong>
            <dl>
              <div><dt>Scores</dt><dd>{INTELLIGENCE_SOURCE}</dd></div>
              <div><dt>Index</dt><dd>Intelligence Index {INTELLIGENCE_VERSION}</dd></div>
              <div><dt>Checked</dt><dd>{INTELLIGENCE_RETRIEVED_ON}</dd></div>
              <div><dt>Cost unit</dt><dd>USD per task</dd></div>
            </dl>
          </div>
        ) : null}
      </div>
      <Legend points={INTELLIGENCE_POINTS} />
    </BrowserFrame>
  );
}
