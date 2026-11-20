import type { BudgetAxis, ModelRelease } from "./types";

export function formatUsd(value: number): string {
  if (value > 0 && value < 0.001) return `$${value.toPrecision(2)}`;
  if (value < 0.01) return `$${value.toFixed(3)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value)}`;
}

export function formatUsdTick(value: number): string {
  return `$${value}`;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 100_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${Math.round(value)}`;
}

export function formatTokensTick(value: number): string {
  if (value >= 1_000_000) return `${value / 1_000_000}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return `${value}`;
}

export function formatScore(value: number, unit: "%" | "pts"): string {
  return unit === "%" ? `${value.toFixed(1)}%` : value.toFixed(1);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  const monthIdx = Number(m) - 1;
  const month = MONTHS[monthIdx] ?? m;
  const day = Number(d);
  return y === "2026" ? `${month} ${day}` : `${month} ${day}, '${(y ?? "").slice(2)}`;
}

export function formatFullDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  const monthIdx = Number(m) - 1;
  const month = MONTHS[monthIdx] ?? m;
  return `${month} ${Number(d)}, ${y}`;
}

export function formatPricePair(inputPer1M: number, outputPer1M: number): string {
  const fmt = (n: number) => (Number.isInteger(n) ? `${n}` : `${n}`);
  return `$${fmt(inputPer1M)}/$${fmt(outputPer1M)}`;
}

export function shortModelName(name: string): string {
  return name
    .replace(/^Claude\s+/, "")
    .replace(/^Gemini\s+4\s+/, "G4 ")
    .replace(/^Gemini\s+/, "Gem ")
    .replace(/^GPT-/, "GPT-");
}

/** A signed score change with a true minus sign, such as +3.1 or −0.4. */
export function formatDelta(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0.0";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1)}`;
}

/** A cost or token multiple, such as 1.32×, 2.4× or 12×. */
export function formatRatio(value: number): string {
  if (value >= 10) return `${Math.round(value)}×`;
  return `${value.toFixed(value >= 2 ? 1 : 2)}×`;
}

/** A per-million-token price: $3, $0.10, $1.25 or $0.075. */
export function formatPrice(perMillion: number): string {
  if (Number.isInteger(perMillion)) return `$${perMillion}`;
  const cents = perMillion.toFixed(2);
  return `$${Number(cents) === perMillion ? cents : Number(perMillion.toFixed(3))}`;
}

export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(2))}M`;
  return `${Math.round(tokens / 1000)}k`;
}

/** One model's place on the chart, in words, for the line under the chart. */
export function chartReadout(release: ModelRelease, axis: BudgetAxis): string {
  const run = release.terminalBench;
  if (!run) return `${release.name} · no Terminal-Bench run yet`;
  const budget =
    axis === "cost"
      ? run.costPerTaskUsd === null
        ? "no cost reported"
        : `${formatUsd(run.costPerTaskUsd)} per task`
      : `${formatTokens(run.tokensPerTask.output)} output tokens per task`;
  return `${release.name} in ${run.agent} · ${formatScore(run.accuracy, "%")} on Terminal-Bench · ${budget}`;
}
