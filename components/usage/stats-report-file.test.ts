import { expect, test } from "bun:test";
import { STATS_MAX_BYTES } from "@/lib/usage/stats-contract";
import { createUsageStatsExample } from "@/lib/usage/stats-example";
import { readStatsReportFile } from "./stats-report-file";

test("oversized local reports are refused before text allocation", async () => {
  let reads = 0;
  await expect(readStatsReportFile({ size: STATS_MAX_BYTES + 1, text: async () => { reads++; return ""; } })).rejects.toThrow("invalid_report");
  expect(reads).toBe(0);
});

test("imports admit only the shared numeric contract and surface file-read failure", async () => {
  const report = createUsageStatsExample(20_700), text = JSON.stringify(report);
  expect(await readStatsReportFile({ size: new TextEncoder().encode(text).length, text: async () => text })).toEqual(report);
  for (const invalid of ["[]", '{"prompt":"private"}', JSON.stringify({ ...report, filename: "private-path" })]) {
    await expect(readStatsReportFile({ size: invalid.length, text: async () => invalid })).rejects.toThrow("invalid_report");
  }
  await expect(readStatsReportFile({ size: 1, text: async () => { throw new Error("unreadable"); } })).rejects.toThrow("unreadable");
});
