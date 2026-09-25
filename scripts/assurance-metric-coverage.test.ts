import { expect, test } from "bun:test";
import { checkMetricCoverage } from "./assurance-metric-coverage";
import { SUPPORTED_METRIC_IDS } from "../lib/usage/metric-explorer";
import { RICH_SUPPORTED_METRIC_IDS } from "../lib/usage/rich-metric-explorer";

test("every implemented metric has a declared view, filter, drilldown and export surface and every planned one a shipped reason", async () => {
  const result = await checkMetricCoverage();
  expect(result.errors).toEqual([]);
  expect(result.ok).toBe(true);
  expect(result.counts.rows).toBe(241);
  expect(result.counts.explorer).toBe(SUPPORTED_METRIC_IDS.size);
  expect(result.counts.rich).toBe(RICH_SUPPORTED_METRIC_IDS.length);
  expect(result.counts["implemented-unqualified"]).toBe(SUPPORTED_METRIC_IDS.size + RICH_SUPPORTED_METRIC_IDS.length);
  expect(result.counts["implemented-qualified"]).toBe(0);
  expect(result.counts.explorerExported).toBe(result.counts.explorer);
  expect(result.counts.richExported).toBe(result.counts.rich);
  expect(result.claim).toContain("not live-qualified");
});
