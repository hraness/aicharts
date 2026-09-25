/** Saved views (D5): a bounded, versioned description of one dashboard
 * selection carried in URL search parameters. Only public registry
 * dimensions may appear (client, provider and model IDs from the checked
 * registry, catalog metric IDs and fixed groupings). Session, execution,
 * device and account identifiers are private and are refused outright, so a
 * shared link can never carry them. Unknown versions and invalid values fail
 * closed; older schema versions migrate to the current one. */
import { METRIC_DIMENSIONS, type MetricDimension } from "./metric-explorer";
import { metricDefinition } from "./metric-explorer-values";
import { STATS_MAX_DAY, STATS_MAX_DAYS } from "./stats-contract";
import { isStatsClient, isStatsModel, isStatsProvider } from "./stats-registry";
import type { StatsGrouping, StatsMetric, StatsRange } from "../../components/usage/stats-view";

export const SAVED_VIEW_VERSION = 2;
export const MAX_SAVED_VIEW_SEARCH_BYTES = 512;
export const SAVED_VIEW_PRESET_DAYS = [1, 7, 30, 90] as const;
export type SavedViewPresetDays = typeof SAVED_VIEW_PRESET_DAYS[number];
export type SavedViewRange = Readonly<{ kind: "preset"; days: SavedViewPresetDays }> | Readonly<{ kind: "dates"; firstUtcDay: number; dayCount: number }>;
export type SavedView = Readonly<{
  schemaVersion: typeof SAVED_VIEW_VERSION; range: SavedViewRange | null;
  client: string; provider: string; model: string; basis: "reported" | "estimated";
  grouping: StatsGrouping; secondGrouping: MetricDimension | null; metric: string; costKind: "reported" | "estimated";
  chart: StatsMetric; split: StatsGrouping | null;
}>;
export type SavedViewError = "saved_view_version" | "saved_view_invalid" | "saved_view_private" | "saved_view_limit";
export type SavedViewParse = Readonly<{ ok: true; value: SavedView; migratedFrom: number | null }> | Readonly<{ ok: false; error: SavedViewError }>;
export const DEFAULT_SAVED_VIEW: SavedView = Object.freeze({ schemaVersion: SAVED_VIEW_VERSION, range: null, client: "*", provider: "*", model: "*", basis: "reported",
  grouping: "client", secondGrouping: null, metric: "accounted-tokens", costKind: "reported", chart: "tokens", split: null });
/** Keys owned by the current schema. Foreign parameters are preserved untouched. */
export const SAVED_VIEW_KEYS = ["view", "range", "client", "provider", "model", "basis", "group", "then", "metric", "cost", "chart", "split"] as const;
/** Version 1 spelled the range as `days` or `from`/`to` and the second grouping as `second`. */
const LEGACY_V1_KEYS = ["days", "from", "to", "second"] as const;
/** Parameters that can only carry private identifiers. Their presence refuses the whole view. */
export const PRIVATE_VIEW_KEYS = ["session", "execution", "device", "account", "token", "key", "id"] as const;
const groupings: readonly StatsGrouping[] = ["client", "provider", "model"], charts: readonly StatsMetric[] = ["tokens", "records", "speed"];
const DAY_MS = 86_400_000;

export function utcDayFromDate(text: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00.000Z`);
  if (!Number.isSafeInteger(ms) || new Date(ms).toISOString().slice(0, 10) !== text) return null;
  const day = ms / DAY_MS;
  return Number.isSafeInteger(day) && day >= 0 && day <= STATS_MAX_DAY ? day : null;
}
export const dateFromUtcDay = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

function params(search: string | URLSearchParams): URLSearchParams | null {
  const value = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search;
  return value;
}
function parseRange(text: string): SavedViewRange | null {
  const preset = /^(\d{1,2})d$/u.exec(text);
  if (preset) { const days = Number(preset[1]); return (SAVED_VIEW_PRESET_DAYS as readonly number[]).includes(days) ? { kind: "preset", days: days as SavedViewPresetDays } : null; }
  const dates = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/u.exec(text);
  if (!dates) return null;
  const first = utcDayFromDate(dates[1]), last = utcDayFromDate(dates[2]);
  if (first === null || last === null || last < first || last - first + 1 > STATS_MAX_DAYS) return null;
  return { kind: "dates", firstUtcDay: first, dayCount: last - first + 1 };
}
function parseFields(fields: Readonly<Record<string, string | null>>): SavedView | null {
  const view = { ...DEFAULT_SAVED_VIEW } as { -readonly [key in keyof SavedView]: SavedView[key] };
  for (const [key, raw] of Object.entries(fields)) {
    if (raw === null) continue;
    if (raw.length > 128) return null;
    switch (key) {
      case "range": { const range = parseRange(raw); if (range === null) return null; view.range = range; break; }
      case "client": if (raw !== "*" && !isStatsClient(raw)) return null; view.client = raw; break;
      case "provider": if (raw !== "*" && !isStatsProvider(raw)) return null; view.provider = raw; break;
      case "model": if (raw !== "*" && !isStatsModel(raw)) return null; view.model = raw; break;
      case "basis": if (raw !== "reported" && raw !== "estimated") return null; view.basis = raw; break;
      case "group": if (!groupings.includes(raw as StatsGrouping)) return null; view.grouping = raw as StatsGrouping; break;
      case "then": if (raw !== "none" && !(METRIC_DIMENSIONS as readonly string[]).includes(raw)) return null; view.secondGrouping = raw === "none" ? null : raw as MetricDimension; break;
      case "metric": if (metricDefinition(raw) === undefined) return null; view.metric = raw; break;
      case "cost": if (raw !== "reported" && raw !== "estimated") return null; view.costKind = raw; break;
      case "chart": if (!charts.includes(raw as StatsMetric)) return null; view.chart = raw as StatsMetric; break;
      case "split": if (raw !== "none" && !groupings.includes(raw as StatsGrouping)) return null; view.split = raw === "none" ? null : raw as StatsGrouping; break;
      default: return null;
    }
  }
  if (view.secondGrouping === view.grouping) view.secondGrouping = null;
  return Object.freeze(view);
}
/** Returns null when the search carries no saved view at all. */
export function parseSavedViewSearch(search: string | URLSearchParams): SavedViewParse | null {
  const query = params(search); if (query === null) return null;
  if (new TextEncoder().encode(query.toString()).byteLength > MAX_SAVED_VIEW_SEARCH_BYTES) return { ok: false, error: "saved_view_limit" };
  for (const key of PRIVATE_VIEW_KEYS) if (query.has(key)) return { ok: false, error: "saved_view_private" };
  const version = query.get("view");
  if (version === null) return null;
  const single = (key: string) => { const all = query.getAll(key); return all.length === 0 ? null : all.length === 1 ? all[0] : undefined; };
  const read = (keys: readonly string[]): Record<string, string | null> | null => {
    const fields: Record<string, string | null> = {};
    for (const key of keys) { const value = single(key); if (value === undefined) return null; fields[key] = value; }
    return fields;
  };
  if (version === "1") {
    const fields = read([...LEGACY_V1_KEYS, "client", "provider", "model", "basis", "group", "metric"]);
    if (fields === null) return { ok: false, error: "saved_view_invalid" };
    const { days, from, to, second, ...rest } = fields;
    let range: string | null = null;
    if (days !== null && (from !== null || to !== null)) return { ok: false, error: "saved_view_invalid" };
    if (days !== null) range = `${days}d`;
    else if (from !== null || to !== null) { if (from === null || to === null) return { ok: false, error: "saved_view_invalid" }; range = `${from}..${to}`; }
    const value = parseFields({ ...rest, range, then: second });
    return value === null ? { ok: false, error: "saved_view_invalid" } : { ok: true, value, migratedFrom: 1 };
  }
  if (version !== String(SAVED_VIEW_VERSION)) return { ok: false, error: "saved_view_version" };
  const fields = read(SAVED_VIEW_KEYS.filter(key => key !== "view"));
  if (fields === null || LEGACY_V1_KEYS.some(key => query.has(key))) return { ok: false, error: "saved_view_invalid" };
  const value = parseFields(fields);
  return value === null ? { ok: false, error: "saved_view_invalid" } : { ok: true, value, migratedFrom: null };
}
export function savedViewRangeText(range: SavedViewRange): string {
  return range.kind === "preset" ? `${range.days}d` : `${dateFromUtcDay(range.firstUtcDay)}..${dateFromUtcDay(range.firstUtcDay + range.dayCount - 1)}`;
}
/** Serializes only the fields that differ from the default view, in a fixed
 * order, after every foreign parameter of `base`. Legacy keys are dropped. */
export function savedViewSearch(view: SavedView, base: string | URLSearchParams = ""): string {
  const query = new URLSearchParams(params(base) ?? undefined);
  for (const key of [...SAVED_VIEW_KEYS, ...LEGACY_V1_KEYS, ...PRIVATE_VIEW_KEYS]) query.delete(key);
  const own = new URLSearchParams();
  own.set("view", String(SAVED_VIEW_VERSION));
  if (view.range !== null) own.set("range", savedViewRangeText(view.range));
  for (const [key, value, fallback] of [["client", view.client, "*"], ["provider", view.provider, "*"], ["model", view.model, "*"], ["basis", view.basis, "reported"],
    ["group", view.grouping, "client"], ["then", view.secondGrouping ?? "none", "none"], ["metric", view.metric, "accounted-tokens"], ["cost", view.costKind, "reported"],
    ["chart", view.chart, "tokens"], ["split", view.split ?? "none", "none"]] as const) if (value !== fallback) own.set(key, value);
  const text = [query.toString(), own.toString()].filter(part => part !== "").join("&");
  if (new TextEncoder().encode(text).byteLength > MAX_SAVED_VIEW_SEARCH_BYTES) throw new Error("saved_view_limit");
  return `?${text}`;
}
/** The exact day range a saved view asks for. Presets anchor on the given day
 * (the report's last day for local files, today for account reads). Ranges
 * outside a bounded window are refused rather than clamped. */
export function savedViewRange(range: SavedViewRange | null, anchor: number, window: StatsRange | null): StatsRange | null {
  if (range === null) return null;
  const value: StatsRange = range.kind === "preset" ? { firstUtcDay: Math.max(0, anchor - range.days + 1), dayCount: Math.min(range.days, anchor + 1) } : { firstUtcDay: range.firstUtcDay, dayCount: range.dayCount };
  if (window !== null && (value.firstUtcDay < window.firstUtcDay || value.firstUtcDay + value.dayCount > window.firstUtcDay + window.dayCount)) return null;
  return value;
}
/** Describes a current selection as a saved view. A range equal to a preset
 * around the anchor is stored as that preset so a link keeps following time. */
export function savedViewFromSelection(selection: Readonly<{ range: StatsRange; anchor: number } & Omit<SavedView, "schemaVersion" | "range">>): SavedView {
  const { range, anchor, ...rest } = selection;
  const preset = SAVED_VIEW_PRESET_DAYS.find(days => range.firstUtcDay === Math.max(0, anchor - days + 1) && range.dayCount === Math.min(days, anchor + 1));
  const saved: SavedViewRange = preset === undefined ? { kind: "dates", firstUtcDay: range.firstUtcDay, dayCount: range.dayCount } : { kind: "preset", days: preset };
  return Object.freeze({ schemaVersion: SAVED_VIEW_VERSION, range: saved, ...rest, secondGrouping: rest.secondGrouping === rest.grouping ? null : rest.secondGrouping });
}
export const sameSavedView = (a: SavedView, b: SavedView): boolean => savedViewSearch(a) === savedViewSearch(b);
