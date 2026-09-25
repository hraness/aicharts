import { expect, test } from "bun:test";
import { assertProperty, fc } from "../property-test";
import { METRIC_DIMENSIONS } from "./metric-explorer";
import { METRIC_CATALOG } from "./metric-explorer-catalog";
import { DEFAULT_SAVED_VIEW, MAX_SAVED_VIEW_SEARCH_BYTES, parseSavedViewSearch, savedViewFromSelection, savedViewRange, savedViewSearch, type SavedView } from "./saved-views";

const ok = (search: string) => { const parsed = parseSavedViewSearch(search); if (parsed === null || !parsed.ok) throw new Error(`expected a view: ${search} → ${JSON.stringify(parsed)}`); return parsed; };
const error = (search: string) => { const parsed = parseSavedViewSearch(search); if (parsed === null || parsed.ok) throw new Error(`expected an error: ${search}`); return parsed.error; };

test("a saved view round-trips through search parameters and keeps foreign parameters", () => {
  const view: SavedView = { ...DEFAULT_SAVED_VIEW, range: { kind: "preset", days: 7 }, client: "codex", model: "gpt-5", grouping: "model", secondGrouping: "utc-day", metric: "cached-input-share", costKind: "estimated", chart: "records", split: "provider" };
  const search = savedViewSearch(view, "?utm_source=mail&view=1&days=3&session=abcd");
  expect(search).toBe("?utm_source=mail&view=2&range=7d&client=codex&model=gpt-5&group=model&then=utc-day&metric=cached-input-share&cost=estimated&chart=records&split=provider");
  expect(ok(search)).toEqual({ ok: true, value: view, migratedFrom: null });
  expect(savedViewSearch(DEFAULT_SAVED_VIEW)).toBe("?view=2");
  expect(parseSavedViewSearch("?utm_source=mail")).toBeNull();
  expect(parseSavedViewSearch("")).toBeNull();
});

test("version 1 links migrate: days or from/to become a range and second becomes then", () => {
  expect(ok("?view=1&days=30&group=model&second=weekday&metric=peak-daily-tokens&client=claude")).toEqual({ ok: true, migratedFrom: 1,
    value: { ...DEFAULT_SAVED_VIEW, range: { kind: "preset", days: 30 }, grouping: "model", secondGrouping: "weekday", metric: "peak-daily-tokens", client: "claude" } });
  expect(ok("?view=1&from=2026-08-01&to=2026-08-31").value.range).toEqual({ kind: "dates", firstUtcDay: 20666, dayCount: 31 });
  expect(error("?view=1&days=7&from=2026-08-01&to=2026-08-02")).toBe("saved_view_invalid");
  expect(error("?view=1&from=2026-08-01")).toBe("saved_view_invalid");
  expect(error("?view=2&days=7")).toBe("saved_view_invalid");
  expect(error("?view=3")).toBe("saved_view_version");
  expect(error("?view=")).toBe("saved_view_version");
});

test("private identifiers, unknown values, duplicates and oversized links are refused, never partially applied", () => {
  expect(error("?view=2&session=0123456789abcdef0123456789abcdef")).toBe("saved_view_private");
  expect(error("?view=2&account=acct_1")).toBe("saved_view_private");
  expect(error("?session=x")).toBe("saved_view_private");
  expect(error("?view=2&client=my-private-client")).toBe("saved_view_invalid");
  expect(error("?view=2&model=0123456789abcdef0123456789abcdef")).toBe("saved_view_invalid");
  expect(error("?view=2&metric=not-a-metric")).toBe("saved_view_invalid");
  expect(error("?view=2&range=5d")).toBe("saved_view_invalid");
  expect(error("?view=2&range=2026-02-30..2026-03-01")).toBe("saved_view_invalid");
  expect(error("?view=2&range=2026-03-01..2026-02-01")).toBe("saved_view_invalid");
  expect(error("?view=2&range=2025-01-01..2026-01-02")).toBe("saved_view_invalid");
  expect(error("?view=2&then=session")).toBe("saved_view_invalid");
  expect(error("?view=2&group=model&group=client")).toBe("saved_view_invalid");
  expect(error(`?view=2&${"x=".repeat(300)}`)).toBe("saved_view_limit");
  expect(() => savedViewSearch(DEFAULT_SAVED_VIEW, `?${"padding=" + "y".repeat(MAX_SAVED_VIEW_SEARCH_BYTES)}`)).toThrow("saved_view_limit");
  expect(ok("?view=2&group=model&then=model").value.secondGrouping).toBeNull();
});

test("ranges resolve exactly against an anchor and are refused outside a bounded window", () => {
  expect(savedViewRange({ kind: "preset", days: 7 }, 20_700, null)).toEqual({ firstUtcDay: 20_694, dayCount: 7 });
  expect(savedViewRange({ kind: "preset", days: 30 }, 5, null)).toEqual({ firstUtcDay: 0, dayCount: 6 });
  expect(savedViewRange({ kind: "dates", firstUtcDay: 20_690, dayCount: 3 }, 20_700, { firstUtcDay: 20_690, dayCount: 20 })).toEqual({ firstUtcDay: 20_690, dayCount: 3 });
  expect(savedViewRange({ kind: "dates", firstUtcDay: 20_689, dayCount: 3 }, 20_700, { firstUtcDay: 20_690, dayCount: 20 })).toBeNull();
  expect(savedViewRange({ kind: "preset", days: 90 }, 20_709, { firstUtcDay: 20_690, dayCount: 20 })).toBeNull();
  expect(savedViewRange(null, 20_700, null)).toBeNull();
  const selection = { anchor: 20_709, client: "*", provider: "*", model: "*", basis: "reported" as const, grouping: "model" as const, secondGrouping: "model" as const, metric: "accounted-tokens", costKind: "reported" as const, chart: "tokens" as const, split: null };
  expect(savedViewFromSelection({ ...selection, range: { firstUtcDay: 20_703, dayCount: 7 } })).toMatchObject({ range: { kind: "preset", days: 7 }, secondGrouping: null });
  expect(savedViewFromSelection({ ...selection, range: { firstUtcDay: 20_700, dayCount: 7 } })).toMatchObject({ range: { kind: "dates", firstUtcDay: 20_700, dayCount: 7 } });
});

test("every public view round-trips exactly and never exceeds the link budget", () => {
  const viewArbitrary = fc.record({
    range: fc.oneof(fc.constant(null), fc.constantFrom(1, 7, 30, 90).map(days => ({ kind: "preset" as const, days: days as 1 | 7 | 30 | 90 })),
      fc.tuple(fc.integer({ min: 0, max: 30_000 }), fc.integer({ min: 1, max: 366 })).map(([firstUtcDay, dayCount]) => ({ kind: "dates" as const, firstUtcDay, dayCount }))),
    client: fc.constantFrom("*", "codex", "claude", "cline"), provider: fc.constantFrom("*", "openai", "anthropic"), model: fc.constantFrom("*", "gpt-5", "claude-opus-4-1"),
    basis: fc.constantFrom("reported" as const, "estimated" as const), grouping: fc.constantFrom("client" as const, "provider" as const, "model" as const),
    secondGrouping: fc.constantFrom(null, ...METRIC_DIMENSIONS), metric: fc.constantFrom(...METRIC_CATALOG.map(entry => entry.id)),
    costKind: fc.constantFrom("reported" as const, "estimated" as const), chart: fc.constantFrom("tokens" as const, "records" as const, "speed" as const),
    split: fc.constantFrom(null, "client" as const, "provider" as const, "model" as const),
  });
  assertProperty(fc.property(viewArbitrary, fields => {
    const view: SavedView = Object.freeze({ schemaVersion: 2, ...fields, secondGrouping: fields.secondGrouping === fields.grouping ? null : fields.secondGrouping });
    const search = savedViewSearch(view);
    expect(new TextEncoder().encode(search).byteLength).toBeLessThanOrEqual(MAX_SAVED_VIEW_SEARCH_BYTES);
    expect(ok(search)).toEqual({ ok: true, value: view, migratedFrom: null });
  }), { numRuns: 150 });
});
