import { parseUsageStatsJson, STATS_MAX_BYTES } from "@/lib/usage/stats-contract";

/** File metadata is checked before allocating text; the shared decoder checks bytes and fields again. */
export async function readStatsReportFile(file: Pick<File, "size" | "text">) {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > STATS_MAX_BYTES) throw new Error("invalid_report");
  const report = parseUsageStatsJson(await file.text());
  if (report === null) throw new Error("invalid_report");
  return report;
}
