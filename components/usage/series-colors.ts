import type { StatsGrouping } from "./stats-view";

/** Five category hues plus a quiet remainder slot (5, used for "Other"). */
export const SERIES_SLOTS = 5;
export const OTHER_SERIES_SLOT = 5;

// A client or provider keeps one hue across every chart, legend and table, so
// "Claude is orange" holds whether it ranks first or last in a selection.
const CLIENT_SLOTS: Readonly<Record<string, number>> = Object.freeze({ codex: 0, "devin-cli": 1, cursor: 2, claude: 3 });
const PROVIDER_SLOTS: Readonly<Record<string, number>> = Object.freeze({ openai: 0, google: 1, xai: 2, anthropic: 3 });

function fixedSlot(dimension: StatsGrouping | null, id: string | null): number | undefined {
  if (id === null) return undefined;
  const table = dimension === "client" ? CLIENT_SLOTS : dimension === "provider" ? PROVIDER_SLOTS : null;
  return table !== null && Object.hasOwn(table, id) ? table[id] : undefined;
}

/**
 * Assigns a hue slot to each category in rank order. Known clients and
 * providers claim their fixed hue first; the rest take the free hues by rank,
 * and anything past the five hues shares the quiet remainder slot. Two
 * categories never share a hue while one is still free.
 */
export function assignSeriesSlots(dimension: StatsGrouping | null, ids: readonly (string | null)[]): number[] {
  const claimed = new Set<number>();
  const fixed = ids.map(id => {
    const slot = fixedSlot(dimension, id);
    if (slot === undefined || claimed.has(slot)) return undefined;
    claimed.add(slot);
    return slot;
  });
  let next = 0;
  return fixed.map(slot => {
    if (slot !== undefined) return slot;
    while (next < SERIES_SLOTS && claimed.has(next)) next++;
    if (next >= SERIES_SLOTS) return OTHER_SERIES_SLOT;
    claimed.add(next);
    return next;
  });
}

/** The raw dimension value behind a one-dimension group key (`["codex"]`). */
export function seriesIdFromKey(key: string): string | null {
  if (!key.startsWith("[")) return key === "other" ? null : key;
  try {
    const parsed: unknown = JSON.parse(key);
    return Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === "string" ? parsed[0] : null;
  } catch { return null; }
}
