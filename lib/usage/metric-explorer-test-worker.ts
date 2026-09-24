import { MetricWorkerCore, type MetricWorkerReply } from "./metric-explorer-worker-core";

/** Deterministic private port for boundary tests; it runs the actual actor
 * parser and only replaces browser scheduling/structured cloning. */
export class TestMetricWorker extends EventTarget {
  stopped = 0;
  readonly core = new MetricWorkerCore(reply => queueMicrotask(() => this.deliver(reply)), async () => { await Promise.resolve(); });
  postMessage(value: unknown) { queueMicrotask(() => this.core.receive(structuredClone(value))); }
  deliver(value: MetricWorkerReply) { this.dispatchEvent(new MessageEvent("message", { data: structuredClone(value) })); }
  terminate() { this.stopped++; this.core.close(); }
}
