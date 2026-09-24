import { isMetricResult, MAX_METRIC_EXPORT_BYTES, metricSnapshotDigest, type MetricResult } from "@/lib/usage/metric-explorer";
import { statsRowsCsv } from "./stats-view";

/** A deferred export may finish after its view or account authority has ended. */
export async function exportCurrentStatsImage<T>(current: () => boolean, prepare: () => Promise<T>, download: (image: T) => void): Promise<boolean> {
  if (!current()) return false;
  const image = await prepare();
  if (!current()) return false;
  download(image);
  return true;
}

/** Row CSV and the explorer use the same captured selection. Exact decimal
 * strings and each row's basis survive the export, alongside its snapshot. */
export async function statsBoundRowsCsv(result: MetricResult): Promise<string> {
  if (!isMetricResult(result)) throw new Error("metric_result_invalid");
  const digest = await metricSnapshotDigest(result.snapshot);
  const csv = statsRowsCsv([...result.rows, ...result.refreshSnapshot.rows]);
  const lines = csv.slice(0, -2).split("\r\n");
  const metadata = `"${digest}","${result.snapshot.revision}","client-stats-v2","${result.query.firstUtcDay}","${result.query.dayCount}","${result.query.basis}",`;
  const output = ["snapshot_sha256,snapshot_revision,source_profile,query_first_utc_day,query_day_count,query_token_basis," + lines[0],
    ...lines.slice(1).map(line => metadata + line)].join("\r\n") + "\r\n";
  if (new TextEncoder().encode(output).byteLength > MAX_METRIC_EXPORT_BYTES) throw new Error("metric_export_limit");
  return output;
}
