import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyUsageDashboard, dailyUsagePresetRange } from "./daily-dashboard";

const utcDay = (date: string) => Date.parse(`${date}T00:00:00.000Z`) / 86_400_000;

test("presets include today and retain UTC calendar dates across month and leap-day boundaries", () => {
  const today = utcDay("2024-03-01");
  expect(dailyUsagePresetRange(today, 1)).toEqual({ firstUtcDay: today, dayCount: 1 });
  expect(dailyUsagePresetRange(today, 7)).toEqual({ firstUtcDay: utcDay("2024-02-24"), dayCount: 7 });
  expect(dailyUsagePresetRange(today, 30)).toEqual({ firstUtcDay: utcDay("2024-02-01"), dayCount: 30 });
  expect(dailyUsagePresetRange(utcDay("2024-01-01"), 7)).toEqual({ firstUtcDay: utcDay("2023-12-26"), dayCount: 7 });
});

test("presets never request dates before the supported epoch", () => {
  expect(dailyUsagePresetRange(0, 30)).toEqual({ firstUtcDay: 0, dayCount: 1 });
  expect(dailyUsagePresetRange(3, 7)).toEqual({ firstUtcDay: 0, dayCount: 4 });
});

test("initial HTML exposes three keyboard-native UTC presets and the active 30-day range", () => {
  const html = renderToStaticMarkup(<DailyUsageDashboard todayUtcDay={utcDay("2026-09-19")} />);
  expect(html).toContain('role="group" aria-label="Quick date ranges in UTC"');
  for (const label of ["Today", "Last 7 days", "Last 30 days"]) expect(html).toContain(`>${label}</button>`);
  expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
  expect(html).toContain('aria-pressed="true" aria-describedby="usage-range-hint">Last 30 days');
  expect(html).toContain('value="2026-08-21"');
  expect(html).toContain('value="2026-09-19"');
});
