"use client";

import { useEffect, useMemo, useState } from "react";
import { createMetricSnapshot, disposeMetricSnapshot, evaluateMetricQuery, metricResultJson, type MetricQuery, type MetricReportMetadata } from "@/lib/usage/metric-explorer";
import type { UsageStatsReport } from "@/lib/usage/stats-contract";
import type { MetricReportSession } from "@/lib/usage/metric-explorer-session";
import { metricPresentation, type MetricPresentation } from "./stats-metric-presentation";
import { statsBoundRowsCsv } from "./stats-export";
import type { StatsRange } from "./stats-view";

export function useStatsMetricQuery(report: MetricReportMetadata | UsageStatsReport, session: MetricReportSession | undefined, query: MetricQuery) {
  const snapshot = useMemo(() => session === undefined ? createMetricSnapshot(report) : null, [report, session]);
  const inline = useMemo(() => {
    if (session !== undefined) return null;
    if (snapshot === null) throw new Error("validated_metric_report_invalid");
    const result = evaluateMetricQuery(snapshot, query); if (!result.ok) throw new Error(result.code);
    return { result: result.value, view: metricPresentation(result.value) };
  }, [snapshot, session, query]);
  const key = JSON.stringify(query);
  const [stored, setStored] = useState<{ session: MetricReportSession; key: string; view: MetricPresentation } | null>(null);
  const [failure, setFailure] = useState<{ session: MetricReportSession; key: string } | null>(null);
  useEffect(() => {
    if (session === undefined) return;
    const controller = new AbortController();
    void session.query(query, { signal: controller.signal }).then(view => {
      if (!controller.signal.aborted) { setStored({ session, key, view }); setFailure(null); }
    }, () => { if (!controller.signal.aborted) setFailure({ session, key }); });
    return () => controller.abort();
  }, [session, query, key]);
  const current = inline?.view ?? (stored !== null && stored.session === session ? stored.view : null);
  const error = session !== undefined && failure?.session === session && failure.key === key;
  const pending = session !== undefined && (stored === null || stored.session !== session || stored.key !== key);
  const placeholder = useMemo(() => {
    if (current !== null) return current;
    // Internal shape only, never rendered or exported as observed data. It
    // lets all hooks retain a stable order while the first worker view loads.
    const empty = createMetricSnapshot({ ...report, sources: [], rows: [] });
    if (empty === null) throw new Error("metric_metadata_invalid");
    const result = evaluateMetricQuery(empty, query);
    if (!result.ok) throw new Error(result.code);
    const value = metricPresentation(result.value); disposeMetricSnapshot(empty); return value;
  }, [current, report, query]);
  const prepare = async (format: "json" | "csv"): Promise<string | Blob> => {
    if (pending || current === null) throw new Error("metric_query_cancelled");
    if (session !== undefined) return session.export(current, format);
    if (inline === null) throw new Error("metric_result_invalid");
    return format === "json" ? metricResultJson(inline.result) : statsBoundRowsCsv(inline.result);
  };
  return { view: current ?? placeholder, current, pending, error, prepare, snapshot };
}

export function useStatsMetricDetail(snapshot: ReturnType<typeof createMetricSnapshot>, session: MetricReportSession | undefined,
  parent: MetricPresentation | null, pending: boolean, range: StatsRange | null) {
  const query = useMemo<MetricQuery | null>(() => parent === null || range === null ? null : ({ ...parent.query, ...range,
    groupBy: ["client", "model"], topK: 12, sortBy: "accounted-tokens", sortDirection: "desc" }), [parent, range]);
  const inline = useMemo(() => {
    if (snapshot === null || query === null) return null;
    const result = evaluateMetricQuery(snapshot, query); return result.ok ? metricPresentation(result.value).projection : null;
  }, [snapshot, query]);
  const [stored, setStored] = useState<{ parent: MetricPresentation; query: MetricQuery; view: MetricPresentation } | null>(null);
  useEffect(() => {
    if (session === undefined || query === null || parent === null || pending) return;
    const controller = new AbortController();
    void session.query(query, { slot: "detail", parent, signal: controller.signal }).then(view => {
      if (!controller.signal.aborted) setStored({ parent, query, view });
    }, () => { /* Missing detail remains unavailable; the parent is unchanged. */ });
    return () => controller.abort();
  }, [session, parent, query, pending]);
  return inline ?? (!pending && stored?.parent === parent && stored.query === query ? stored.view.projection : null);
}
