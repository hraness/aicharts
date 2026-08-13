import type { CodingAgentUpdate } from "./coding-agent-data";

const utcMonthLabels = [
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

function checkedDate(timestamp: string): Date {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.valueOf())) throw new RangeError(`Invalid update timestamp: ${timestamp}`);
  return date;
}

function monthLabel(date: Date): string {
  const month = utcMonthLabels[date.getUTCMonth()];
  if (month === undefined) throw new RangeError(`Invalid UTC month in ${date.toISOString()}.`);
  return month;
}

/** Keeps server and browser markup identical across differing ICU versions. */
export function formatRetrievedAt(timestamp: string): string {
  const date = checkedDate(timestamp);
  const hour = date.getUTCHours();
  const displayHour = hour % 12 || 12;
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const meridiem = hour >= 12 ? "PM" : "AM";
  return `${monthLabel(date)} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${displayHour}:${minutes} ${meridiem} UTC`;
}

export function formatUpdateDate(timestamp: string): string {
  const date = checkedDate(timestamp);
  return `${monthLabel(date)} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export type LatestUpdateGroup = Readonly<{
  detectedAt: string;
  events: readonly CodingAgentUpdate[];
  summary: string;
}>;

export function latestUpdateGroup(updates: readonly CodingAgentUpdate[]): LatestUpdateGroup | null {
  const detectedAt = updates.reduce<string | null>((latest, update) => (
    latest === null || Date.parse(update.detectedAt) > Date.parse(latest) ? update.detectedAt : latest
  ), null);
  if (detectedAt === null) return null;
  const events = updates.filter((update) => update.detectedAt === detectedAt);
  const additions = events.filter(({ kind }) => kind === "model-added");
  const variants = events.filter(({ kind }) => kind === "variant-added");
  const changes = events.filter(({ kind }) => kind === "benchmark-changed");
  const only = events[0];
  let summary: string;
  if (events.length === 1 && only !== undefined) {
    summary = only.kind === "model-added"
      ? `New: ${only.model}`
      : only.kind === "variant-added" ? `${only.model} settings added` : `${only.model} benchmark updated`;
  } else if (additions.length === events.length) {
    summary = `${additions.length} models added`;
  } else if (variants.length === events.length) {
    summary = `${variants.length} model settings added`;
  } else if (changes.length === events.length) {
    summary = `${changes.length} benchmark updates`;
  } else {
    summary = `${events.length} model changes`;
  }
  return { detectedAt, events, summary };
}

export function groupUpdatesByDetection(
  updates: readonly CodingAgentUpdate[],
): ReadonlyArray<Readonly<{ detectedAt: string; events: readonly CodingAgentUpdate[] }>> {
  const groups = new Map<string, CodingAgentUpdate[]>();
  for (const update of updates) {
    const group = groups.get(update.detectedAt) ?? [];
    group.push(update);
    groups.set(update.detectedAt, group);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => Date.parse(right) - Date.parse(left))
    .map(([detectedAt, events]) => ({ detectedAt, events }));
}
