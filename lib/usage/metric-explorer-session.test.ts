import { expect, test } from "bun:test";
import { createUsageStatsExample } from "./stats-example";
import { createMetricSnapshot, createMetricSnapshotJson, disposeMetricSnapshot, evaluateMetricQuery, evaluateMetricQueryCooperatively, metricReportMetadata, metricSnapshotDigest,
  type MetricQuery } from "./metric-explorer";
import { MetricWorkerCore, type MetricWorkerReply } from "./metric-explorer-worker-core";
import { MetricReportSession } from "./metric-explorer-session";
import { MAX_METRIC_VIEW_BYTES, decodeMetricPresentation, encodeMetricPresentation, metricPresentation, metricPresentationBytes } from "../../components/usage/stats-metric-presentation";

const report = createUsageStatsExample(20_700);
const query: MetricQuery = { schemaVersion: 1, firstUtcDay: report.firstUtcDay, dayCount: report.dayCount,
  filters: { client: "*", provider: "*", model: "*" }, basis: "reported", costKind: "reported", groupBy: ["client", "model"],
  metricIds: ["accounted-tokens", "cached-input-share", "effective-usd-per-million-total-tokens"], topK: 3, sortBy: "accounted-tokens", sortDirection: "desc" };
class LocalWorker extends EventTarget {
  stopped = 0;
  handoffs = 0;
  readonly core = new MetricWorkerCore(reply => queueMicrotask(() => this.deliver(reply)), async () => { this.handoffs++; await new Promise<void>(done => setTimeout(done, 0)); });
  postMessage(value: unknown) { queueMicrotask(() => this.core.receive(structuredClone(value))); }
  deliver(value: MetricWorkerReply) { this.dispatchEvent(new MessageEvent("message", { data: structuredClone(value) })); }
  terminate() { this.stopped++; this.core.close(); }
}

test("cooperative execution preserves every exact fold/cohort and cancels at a real handoff", async () => {
  const snapshot = createMetricSnapshot(report)!;
  for (const costKind of ["reported", "estimated"] as const) {
    let handoffs = 0;
    expect(await evaluateMetricQueryCooperatively(snapshot, { ...query, costKind }, () => true, async () => { handoffs++; }))
      .toEqual(evaluateMetricQuery(snapshot, { ...query, costKind }));
    expect(handoffs).toBeGreaterThan(0);
  }
  let current = true, handoffs = 0;
  expect(await evaluateMetricQueryCooperatively(snapshot, query, () => current, async () => { handoffs++; current = false; }))
    .toEqual({ ok: false, code: "metric_query_cancelled" });
  expect(handoffs).toBe(1);
  disposeMetricSnapshot(snapshot);
  expect(evaluateMetricQuery(snapshot, query)).toEqual({ ok: false, code: "metric_snapshot_invalid" });
  await expect(metricSnapshotDigest(snapshot)).rejects.toThrow("metric_snapshot_invalid");
});

test("JSON admission and compact presentation retain exact values without source rows or group/day cohort trees", () => {
  const snapshot = createMetricSnapshotJson(JSON.stringify(report))!, result = evaluateMetricQuery(snapshot, query);
  expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.code);
  const view = metricPresentation(result.value);
  expect(view.measures).toEqual(result.value.measures);
  expect(view.rowCount).toBe(result.value.rows.length);
  expect(view.projection.totals.tokens).toBe(result.value.fold.total);
  expect(view.groups.map(group => group.daysWithRecords)).toEqual(result.value.groups.map(group => group.fold.days.length));
  expect(Object.hasOwn(view, "rows")).toBe(false);
  expect(Object.hasOwn(view.groups[0], "fold")).toBe(false);
  expect(Object.hasOwn(metricReportMetadata(snapshot), "rows")).toBe(false);
  expect(metricPresentationBytes(view)).toBeLessThan(MAX_METRIC_VIEW_BYTES);
  expect(metricPresentationBytes({ ...view, projection: { ...view.projection, dailyTotals: new Map() } })).toBeLessThan(metricPresentationBytes(view));
  disposeMetricSnapshot(snapshot);
});

test("a session admits local Blob bytes, exports its own exact current selection, and closes custody once", async () => {
  const worker = new LocalWorker(), session = await MetricReportSession.open(new Blob([JSON.stringify(report)]), undefined, () => worker);
  expect(session.metadata.firstUtcDay).toBe(report.firstUtcDay);
  const view = await session.query(query), json = JSON.parse(await (await session.export(view, "json")).text());
  expect(json.measures[0].value.amount).toBe(view.measures[0].value?.kind === "integer" ? view.measures[0].value.amount.toString() : null);
  expect(json.snapshot.sha256).toMatch(/^[a-f0-9]{64}$/u);
  const csv = await (await session.export(view, { metricCsv: view.measures[0].id })).text();
  expect(csv.startsWith("metric_id,metric_version,unit,source_profile,snapshot_sha256,")).toBe(true);
  expect(csv).toContain(`\r\n${view.measures[0].id},1,`);
  expect(csv).toContain(`,${json.snapshot.sha256},`);
  await expect(session.export(view, { metricCsv: "not-a-metric" })).rejects.toThrow();
  await expect(session.export(view, "rows" as never)).rejects.toThrow();
  await expect(session.export({ ...view }, "json")).rejects.toThrow("cancelled");
  const detail = await session.query({ ...query, dayCount: 1 }, { slot: "detail", parent: view });
  expect(detail.query.dayCount).toBe(1);
  await expect(session.export(detail, "csv")).rejects.toThrow("cancelled");
  session.close(); session.close(); expect(worker.stopped).toBe(1);
  await expect(session.export(view, "json")).rejects.toThrow("cancelled");
});

test("latest requests and aborts cancel prior continuations instead of admitting stale result/export authority", async () => {
  const worker = new LocalWorker(), session = await MetricReportSession.open(report, undefined, () => worker);
  const old = session.query(query); const oldOutcome = old.then(() => "accepted", () => "cancelled");
  const latest = session.query({ ...query, filters: { ...query.filters, client: "codex" } });
  expect(await oldOutcome).toBe("cancelled");
  const view = await latest; expect(view.query.filters.client).toBe("codex");
  const abort = new AbortController(), pending = session.query(query, { signal: abort.signal });
  abort.abort(); await expect(pending).rejects.toThrow("cancelled");
  await expect(session.export(view, "json")).rejects.toThrow("cancelled");
  session.close(); expect(worker.stopped).toBe(1);
});

test("closing during Blob admission releases the worker and rejects the pending source", async () => {
  const worker = new LocalWorker(), abort = new AbortController();
  const opening = MetricReportSession.open(new Blob([JSON.stringify(report)]), abort.signal, () => worker);
  abort.abort(); await expect(opening).rejects.toThrow("cancelled");
  expect(worker.stopped).toBe(1);
});

test("an aborted admission releases custody before a replacement can create its worker", async () => {
  const worker = new LocalWorker(), abort = new AbortController();
  const opening = MetricReportSession.open(new Blob([JSON.stringify(report)]), abort.signal, () => worker);
  const outcome = opening.catch(() => null);
  abort.abort();
  // Deliberately no await: a newer input can start in the same browser task.
  expect(worker.stopped).toBe(1);
  expect(await outcome).toBeNull();
});

test("an abort after result delivery still cancels the awaiting query continuation", async () => {
  const controller = new AbortController();
  class AbortingWorker extends LocalWorker {
    override deliver(value: MetricWorkerReply) {
      super.deliver(value);
      if (value.kind === "result") controller.abort();
    }
  }
  const worker = new AbortingWorker(), session = await MetricReportSession.open(report, undefined, () => worker);
  await expect(session.query(query, { signal: controller.signal })).rejects.toThrow("cancelled");
  session.close(); expect(worker.stopped).toBe(1);
});

test("compact decoding preserves exact projections and rejects corrupt quantities, unknown fields and map aliases", () => {
  const snapshot = createMetricSnapshot(report)!, result = evaluateMetricQuery(snapshot, query);
  if (!result.ok) throw new Error(result.code);
  const view = metricPresentation(result.value), bytes = encodeMetricPresentation(view);
  expect(decodeMetricPresentation(bytes)).toEqual(view);
  type Corruptible = { rows?: unknown; groups: { measures: { id: string }[] }[];
    projection: { totals: { tokens: unknown; records: unknown }; dailyTotals: { $metricMap: unknown[] }; calendar: { cells: unknown[] } } };
  const corrupt = (mutate: (value: Corruptible) => void) => {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Corruptible; mutate(value);
    return new TextEncoder().encode(JSON.stringify(value)).buffer;
  };
  for (const mutate of [
    (value: Corruptible) => { value.rows = [{ prompt: "untrusted" }]; },
    (value: Corruptible) => { value.projection.totals.tokens = { $metricInteger: "-1" }; },
    (value: Corruptible) => { value.projection.totals.records = "12"; },
    (value: Corruptible) => { value.groups[0].measures[0].id = "unknown"; },
    (value: Corruptible) => { value.projection.dailyTotals.$metricMap.push(value.projection.dailyTotals.$metricMap[0]); },
    (value: Corruptible) => { value.projection.calendar.cells[0] = { utcDay: -1 }; },
  ]) expect(() => decodeMetricPresentation(corrupt(mutate))).toThrow();
  expect(() => decodeMetricPresentation(new ArrayBuffer(MAX_METRIC_VIEW_BYTES + 1))).toThrow("metric_view_limit");
  disposeMetricSnapshot(snapshot);
});

test("worker metadata and result identity cannot be rebound to another report", async () => {
  class CorruptWorker extends LocalWorker {
    constructor(readonly kind: "metadata" | "snapshot") { super(); }
    override deliver(value: MetricWorkerReply) {
      if (value.kind === "ready" && this.kind === "metadata") {
        value = { ...value, metadata: { ...value.metadata, sources: [{ ...value.metadata.sources[0], client: "unknown-client" }] } };
      } else if (value.kind === "result" && this.kind === "snapshot") {
        const view = decodeMetricPresentation(value.view);
        const bytes = encodeMetricPresentation({ ...view, snapshot: { ...view.snapshot, revision: view.snapshot.revision + 1 } });
        value = { ...value, view: bytes, viewBytes: bytes.byteLength };
      }
      super.deliver(value);
    }
  }
  const badMetadata = new CorruptWorker("metadata");
  await expect(MetricReportSession.open(report, undefined, () => badMetadata)).rejects.toThrow("invalid_report");
  expect(badMetadata.stopped).toBe(1);
  const badResult = new CorruptWorker("snapshot"), session = await MetricReportSession.open(report, undefined, () => badResult);
  await expect(session.query(query)).rejects.toThrow("cancelled"); expect(badResult.stopped).toBe(1);
});

test("superseding a main result invalidates its detail authority and captured export", async () => {
  const worker = new LocalWorker(), session = await MetricReportSession.open(report, undefined, () => worker);
  const old = await session.query(query);
  const next = await session.query({ ...query, filters: { ...query.filters, client: "codex" } });
  await expect(session.query({ ...query, dayCount: 1 }, { slot: "detail", parent: old })).rejects.toThrow("cancelled");
  await expect(session.export(old, "json")).rejects.toThrow("cancelled");
  expect(JSON.parse(await (await session.export(next, "json")).text()).query.filters.client).toBe("codex");
  session.close();
});
