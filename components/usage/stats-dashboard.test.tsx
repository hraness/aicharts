import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createUsageStatsExample } from "@/lib/usage/stats-example";
import { StatsDashboard } from "./stats-dashboard";
import { StatsReportView } from "./stats-report-view";

const utcDay = (date: string) => Date.parse(`${date}T00:00:00.000Z`) / 86_400_000;

test("initial account load renders a structured skeleton that mirrors the report layout", () => {
  const html = renderToStaticMarkup(<StatsDashboard todayUtcDay={utcDay("2026-09-21")} remoteEnabled startWithAccount />);
  expect(html).toContain('role="status"');
  expect(html).toContain("Loading numeric usage.");
  const skeleton = html.match(/<div class="usage-stats__skeleton" aria-hidden="true">(.*)/);
  expect(skeleton).not.toBeNull();
  expect(html).toContain('class="usage-stats__skeleton-presets"');
  expect(html).toContain('class="usage-stats__skeleton-filters"');
  expect(html).toContain('class="usage-stats__skeleton-summary"');
  expect(html).toContain('class="usage-stats__skeleton-total"');
  expect(html).toContain('class="usage-stats__skeleton-plot"');
  expect(html).toContain('class="usage-stats__skeleton-axis"');
  expect(html).toContain('class="usage-stats__skeleton-table"');
  expect(html.match(/<span style="height:[0-9]+%"><\/span>/g)?.length).toBe(30);
});

test("the skeleton exposes no data or controls to assistive technology", () => {
  const html = renderToStaticMarkup(<StatsDashboard todayUtcDay={utcDay("2026-09-21")} remoteEnabled startWithAccount />);
  const skeleton = html.slice(html.indexOf('<div class="usage-stats__skeleton"'));
  expect(skeleton).not.toContain("<button");
  expect(skeleton).not.toContain("<select");
  // Every element is a presentational empty span or a layout div.
  expect(skeleton.replace(/<\/?(div|span)[^>]*>/g, "").trim()).toBe("");
});

test("idle state shows the empty prompt instead of the skeleton", () => {
  const html = renderToStaticMarkup(<StatsDashboard todayUtcDay={utcDay("2026-09-21")} />);
  expect(html).not.toContain("usage-stats__skeleton");
  expect(html).toContain("See the whole usage picture");
});

test("a refreshing report stays rendered and marked busy", () => {
  const html = renderToStaticMarkup(<StatsReportView report={createUsageStatsExample(20_700)} scope="account" todayUtcDay={20_700} busy onRefresh={() => {}} />);
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("Refreshing…");
});
