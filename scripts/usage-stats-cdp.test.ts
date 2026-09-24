import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CDPSession } from "playwright-core";
import { diagnosticCdp, memoryProcessTotals, metricQueryTrace, MetricTrace, MetricWorkerCdp, ownedMetricTargets, summarizeCpuProfile } from "./usage-stats-cdp";

class FakeCdp extends EventEmitter {
  run: (method: string, params: Record<string, unknown>) => Promise<unknown> = async () => ({});
  send(method: string, params: Record<string, unknown> = {}) { return this.run(method, params); }
  get port() { return this as unknown as CDPSession; }
}

describe("bounded synthetic worker diagnostics", () => {
  test("worker replies are session-bound and disposal rejects pending calls before late delivery", async () => {
    const root = new FakeCdp(); let sent: { id: number } | undefined;
    root.run = async (method, params) => {
      if (method === "Target.attachToTarget") return { sessionId: "owned-session" };
      if (method === "Target.sendMessageToTarget") sent = JSON.parse(String(params.message));
      return {};
    };
    const session = await MetricWorkerCdp.attach(root.port, "owned-target");
    const read = session.send("Runtime.getHeapUsage");
    root.emit("Target.receivedMessageFromTarget", { sessionId: "another-session", message: JSON.stringify({ id: sent!.id, result: { usedSize: 99 } }) });
    root.emit("Target.receivedMessageFromTarget", { sessionId: "owned-session", message: JSON.stringify({ id: sent!.id, result: { usedSize: 7 } }) });
    expect(await read).toEqual({ usedSize: 7 });
    const rejected = session.send("Profiler.stop").catch((error: unknown) => error);
    await session.close(); expect(await rejected).toEqual(new Error("Worker inspector session disposed."));
    root.emit("Target.receivedMessageFromTarget", { sessionId: "owned-session", message: JSON.stringify({ id: sent!.id, result: { profile: {} } }) });
    expect(root.listenerCount("Target.receivedMessageFromTarget")).toBe(0);
    expect(root.listenerCount("Target.detachedFromTarget")).toBe(0);
    expect(() => session.send("Runtime.evaluate")).toThrow("Unexpected diagnostic");
  });

  test("an uncooperative inspector command has a deadline", async () => {
    const root = new FakeCdp(); root.run = () => new Promise(() => undefined);
    await expect(diagnosticCdp(root.port, "Runtime.getHeapUsage", {}, 5)).rejects.toThrow("timed out");
  });

  test("target inventory refuses a worker outside the isolated local bundle", async () => {
    const root = new FakeCdp();
    root.run = async () => ({ targetInfos: [{ type: "page", targetId: "page", url: "http://127.0.0.1:47001/usage/details" },
      { type: "worker", targetId: "worker", url: "http://127.0.0.1:47001/_next/static/chunks/worker.js" }] });
    expect(await ownedMetricTargets(root.port, "http://127.0.0.1:47001")).toHaveLength(1);
    await expect(ownedMetricTargets(root.port, "http://127.0.0.1:47002")).rejects.toThrow("Unexpected worker");
  });

  test("CPU samples preserve paired ordering for signed deltas and reject malformed profiles", () => {
    const profile = { nodes: [{ id: 1, callFrame: { functionName: "fold" } }, { id: 2, callFrame: { functionName: "(idle)" } }],
      samples: [1, 2, 1], timeDeltas: [1000, 2000, 3000], startTime: 0, endTime: 6000 };
    const result = summarizeCpuProfile(profile);
    expect(result.selfTime).toEqual([{ nodeId: 2, frame: { functionName: "(idle)" }, sampledIntervalMs: 3 }, { nodeId: 1, frame: { functionName: "fold" }, sampledIntervalMs: 2 }]);
    const signed = summarizeCpuProfile({ ...profile, timeDeltas: [2000, -1000, 2000] });
    expect(signed.negativeDeltas).toBe(1); expect(signed.firstSampleAtUs).toBe(1000); expect(signed.lastSampleAtUs).toBe(3000);
    expect(signed.selfTime.map(value => value.sampledIntervalMs)).toEqual([1, 1]);
    expect(() => summarizeCpuProfile({ ...profile, timeDeltas: [1] })).toThrow("shape invalid");
    expect(() => summarizeCpuProfile({ ...profile, timeDeltas: [1, Number.NaN, 3] })).toThrow("delta invalid");
  });

  test("query-window CPU intervals exclude inspector startup and clip boundary samples", () => {
    const profile = { nodes: [{ id: 1, callFrame: { functionName: "inspector-start" } }, { id: 2, callFrame: { functionName: "fold" } }],
      samples: [1, 2, 2], timeDeltas: [1000, 4000, 5000], startTime: 0, endTime: 12_000 };
    const result = summarizeCpuProfile(profile, { fromUs: 6000, toUs: 9000 });
    expect(result.selfTime).toEqual([{ nodeId: 2, frame: { functionName: "fold" }, sampledIntervalMs: 3 }]);
    // An interval can overlap the query even when both endpoint samples lie outside it.
    expect(result.samplesInWindow).toBe(0);
    expect(() => summarizeCpuProfile(profile, { fromUs: 6000, toUs: 13_000 })).toThrow("outside capture");
  });

  test("query task attribution binds one marker pair and worker thread, unions overlaps and excludes setup", () => {
    const post = { name: "metric-query-post:1-7", pid: 1, tid: 2, ts: 10_000 };
    const reply = { name: "metric-query-reply:1-7", pid: 1, tid: 2, ts: 20_000 };
    const worker = { name: "thread_name", pid: 1, tid: 3, args: { name: "DedicatedWorker thread" } };
    const tasks = [[1000, 5000], [9000, 3000], [11_000, 3000], [17_000, 5000]].map(([ts, dur]) => ({ name: "RunTask", ph: "X", pid: 1, tid: 3, ts, dur }));
    const trace = { traceEvents: [post, reply, worker, ...tasks, { ...tasks[0], tid: 99, ts: 10_000, dur: 10_000 }] };
    const result = metricQueryTrace(trace);
    expect(result.matched).toBe(true); if (!result.matched) throw new Error(result.reason);
    expect(result.window).toEqual({ fromUs: 10_000, toUs: 20_000 });
    expect(result.worker).toEqual({ pid: 1, tid: 3 }); expect(result.taskCount).toBe(3);
    expect(result.queryWireMs).toBe(10); expect(result.workerTaskMs).toBe(7);
    expect(result.nonTaskIntervalMs).toBe(3); expect(result.maximumWorkerTaskMs).toBe(3);
    expect(metricQueryTrace({ traceEvents: [post, { ...reply, tid: 99 }, worker] }).matched).toBe(false);
    expect(metricQueryTrace({ traceEvents: [...trace.traceEvents, reply] }).matched).toBe(false);
    expect(metricQueryTrace({ traceEvents: [...trace.traceEvents, { ...worker, tid: 4 }] }).matched).toBe(false);
  });

  test("trace is drained and closed; memory summaries include only owned processes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "metric-trace-test-"));
    const root = new FakeCdp(); let closed = false;
    const trace = { traceEvents: [{ pid: 11, ts: 1, args: { dumps: { process_totals: { resident_set_bytes: "abc" } } } },
      { pid: 99, ts: 2, args: { dumps: { process_totals: { resident_set_bytes: "ffff" } } } }] };
    root.run = async method => {
      if (method === "Tracing.end") queueMicrotask(() => root.emit("Tracing.tracingComplete", { stream: "owned-stream", dataLossOccurred: false }));
      if (method === "IO.read") return { data: JSON.stringify(trace), eof: true };
      if (method === "IO.close") closed = true;
      return {};
    };
    try {
      const path = join(directory, "trace.json"), owned = await MetricTrace.start(root.port, path, true);
      expect(await owned.finish()).toEqual(trace); expect(closed).toBe(true);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(trace);
      expect(memoryProcessTotals(trace, new Set([11])).samples).toEqual([{ pid: 11, timestampUs: 1, id: undefined, rawProcessTotals: { resident_set_bytes: "abc" } }]);
      expect(root.listenerCount("Tracing.tracingComplete")).toBe(0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("known trace data loss retains exact completion and raw data, closes the stream, and still fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "metric-trace-loss-")), root = new FakeCdp(); let closed = false;
    const trace = { traceEvents: [] }, completion = { stream: "lossy-stream", dataLossOccurred: true };
    root.run = async method => {
      if (method === "Tracing.end") queueMicrotask(() => root.emit("Tracing.tracingComplete", completion));
      if (method === "IO.read") return { data: JSON.stringify(trace), eof: true };
      if (method === "IO.close") closed = true;
      return {};
    };
    try {
      const path = join(directory, "trace.json"), owned = await MetricTrace.start(root.port, path, true);
      await expect(owned.finish()).rejects.toThrow("reported data loss");
      expect(closed).toBe(true); expect(root.listenerCount("Tracing.tracingComplete")).toBe(0);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(trace);
      expect(JSON.parse(await readFile(`${path}.completion.json`, "utf8"))).toEqual(completion);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
