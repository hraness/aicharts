import type { CDPSession } from "playwright-core";
import { writeFile } from "node:fs/promises";

const COMMAND_MS = 10_000, TRACE_BYTES = 64 * 1024 * 1024, CDP_RESPONSE_BYTES = 16 * 1024 * 1024;
const pendingRootCommands = new WeakMap<CDPSession, number>();
export async function diagnosticCdp(root: CDPSession, method: Parameters<CDPSession["send"]>[0], params: Record<string, unknown> = {}, timeoutMs = COMMAND_MS): Promise<Record<string, unknown>> {
  const pending = pendingRootCommands.get(root) ?? 0;
  invariant(pending < 8 && timeoutMs > 0 && timeoutMs <= COMMAND_MS, "Root inspector command bound exceeded.");
  invariant(method.length <= 100 && Buffer.byteLength(JSON.stringify(params)) <= 32_768, "Inspector request exceeded its byte ceiling.");
  pendingRootCommands.set(root, pending + 1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = diagnosticRecord(await Promise.race([root.send(method, params), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Inspector command timed out: ${method}`)), timeoutMs);
    })]));
    invariant(Buffer.byteLength(JSON.stringify(result)) <= CDP_RESPONSE_BYTES, "Inspector reply exceeded its byte ceiling."); return result;
  } finally { clearTimeout(timer); pendingRootCommands.set(root, (pendingRootCommands.get(root) ?? 1) - 1); }
}
export function diagnosticRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("diagnostic_object_invalid");
  return value as Record<string, unknown>;
}
function invariant(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

/** A second inspector session on one target in our newly launched browser.
 * Playwright's page CDP session does not profile its dedicated worker. */
export class MetricWorkerCdp {
  #id = 0;
  #closed = false;
  #pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private constructor(private readonly root: CDPSession, readonly targetId: string, private readonly sessionId: string) {
    root.on("Target.receivedMessageFromTarget", this.#receive);
    root.on("Target.detachedFromTarget", this.#detached);
  }
  static async attach(root: CDPSession, targetId: string): Promise<MetricWorkerCdp> {
    const reply = await diagnosticCdp(root, "Target.attachToTarget", { targetId, flatten: false });
    invariant(typeof reply.sessionId === "string", "Worker inspector session was not admitted.");
    return new MetricWorkerCdp(root, targetId, reply.sessionId);
  }
  #receive = (event: { sessionId: string; message: string }) => {
    if (event.sessionId !== this.sessionId || this.#closed) return;
    let reply: Record<string, unknown>;
    try {
      invariant(event.message.length <= CDP_RESPONSE_BYTES && Buffer.byteLength(event.message) <= CDP_RESPONSE_BYTES, "Worker inspector reply exceeded its byte ceiling.");
      reply = diagnosticRecord(JSON.parse(event.message) as unknown);
    } catch { this.#finish(new Error("Worker inspector reply was invalid.")); return; }
    if (typeof reply.id !== "number") return;
    const owned = this.#pending.get(reply.id); if (owned === undefined) return;
    this.#pending.delete(reply.id); clearTimeout(owned.timer);
    if (reply.error !== undefined) owned.reject(new Error(`Worker inspector command refused: ${JSON.stringify(reply.error).slice(0, 500)}`));
    else {
      try { owned.resolve(diagnosticRecord(reply.result)); } catch { owned.reject(new Error("Worker inspector result was invalid.")); }
    }
  };
  #detached = (event: { sessionId: string }) => { if (event.sessionId === this.sessionId) this.#finish(new Error("Worker inspector target closed.")); };
  #finish(error: Error) {
    if (this.#closed) return;
    this.#closed = true; this.root.off("Target.receivedMessageFromTarget", this.#receive); this.root.off("Target.detachedFromTarget", this.#detached);
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.#pending.clear();
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    invariant(/^(?:Profiler\.(?:enable|disable|start|stop|setSamplingInterval)|Runtime\.getHeapUsage|HeapProfiler\.collectGarbage)$/u.test(method), "Unexpected diagnostic worker command.");
    invariant(!this.#closed && this.#pending.size < 8 && this.#id < 4096, "Worker inspector command bound exceeded.");
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error("Worker inspector command timed out.")); }, COMMAND_MS);
      this.#pending.set(id, { resolve, reject, timer });
      void diagnosticCdp(this.root, "Target.sendMessageToTarget", { sessionId: this.sessionId, message: JSON.stringify({ id, method, params }) }).catch(error => {
        const pending = this.#pending.get(id); if (pending === undefined) return;
        this.#pending.delete(id); clearTimeout(pending.timer); reject(error);
      });
    });
  }
  async close() {
    if (this.#closed) return;
    this.#finish(new Error("Worker inspector session disposed."));
    await diagnosticCdp(this.root, "Target.detachFromTarget", { sessionId: this.sessionId }).catch(() => undefined);
  }
}

export async function ownedMetricTargets(root: CDPSession, baseUrl: string): Promise<{ id: string; url: string }[]> {
  const reply = await diagnosticCdp(root, "Target.getTargets");
  invariant(Array.isArray(reply.targetInfos) && reply.targetInfos.length <= 64, "Owned browser target bound exceeded.");
  return reply.targetInfos.map(diagnosticRecord).filter(target => target.type === "worker").map(target => {
    invariant(typeof target.targetId === "string" && typeof target.url === "string", "Worker target identity invalid.");
    const url = new URL(target.url);
    invariant(url.origin === baseUrl && url.pathname.startsWith("/_next/static/"), "Unexpected worker target in the owned browser.");
    return { id: target.targetId, url: target.url };
  });
}

/** Streams a bounded Chrome trace after capture. Raw diagnostic artifacts
 * belong only to the isolated synthetic browser, never an attached user tab. */
export class MetricTrace {
  #finished = false;
  private constructor(private readonly root: CDPSession, private readonly path: string) {}
  static async start(root: CDPSession, path: string, memory: boolean) {
    await diagnosticCdp(root, "Tracing.start", { transferMode: "ReturnAsStream", streamFormat: "json", streamCompression: "none",
      traceConfig: { recordMode: "recordUntilFull", includedCategories: memory
        ? ["disabled-by-default-memory-infra", "memory-infra", "toplevel"]
        : ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8", "v8.execute", "toplevel", "blink.user_timing"] } });
    return new MetricTrace(root, path);
  }
  async finish(): Promise<Record<string, unknown>> {
    invariant(!this.#finished, "Trace already collected."); this.#finished = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let receive: (event: Record<string, unknown>) => void = () => undefined;
    const complete = new Promise<Record<string, unknown>>((resolve, reject) => {
      receive = resolve; this.root.once("Tracing.tracingComplete", receive);
      timer = setTimeout(() => reject(new Error("Owned trace did not drain.")), COMMAND_MS);
    });
    let stream: string | null = null;
    try {
      const [, reply] = await Promise.all([diagnosticCdp(this.root, "Tracing.end"), complete]);
      invariant(Buffer.byteLength(JSON.stringify(reply)) <= 32_768, "Trace completion metadata exceeded its ceiling.");
      await writeFile(`${this.path}.completion.json`, JSON.stringify(reply, null, 2) + "\n");
      if (typeof reply.stream === "string") stream = reply.stream;
      invariant(stream !== null, "Owned trace completion had no stream.");
      const parts: Buffer[] = []; let size = 0, done = false;
      const expires = Date.now() + COMMAND_MS;
      for (let count = 0; count < 128 && !done; count++) {
        invariant(Date.now() < expires, "Trace read exceeded its deadline.");
        const chunk = await diagnosticCdp(this.root, "IO.read", { handle: stream, size: 1024 * 1024 }, Math.max(1, expires - Date.now()));
        invariant(typeof chunk.data === "string" && typeof chunk.eof === "boolean", "Trace stream reply invalid.");
        const bytes = Buffer.from(chunk.data, chunk.base64Encoded === true ? "base64" : "utf8"); size += bytes.length;
        invariant(size <= TRACE_BYTES, "Trace exceeded its 64 MiB diagnostic ceiling."); parts.push(bytes); done = chunk.eof;
      }
      invariant(done, "Trace exceeded its chunk ceiling."); const bytes = Buffer.concat(parts);
      await writeFile(this.path, bytes);
      invariant(typeof reply.dataLossOccurred === "boolean", "Owned trace completion dataLossOccurred field invalid.");
      invariant(reply.dataLossOccurred === false, "Owned trace reported data loss; bounded raw data retained for diagnosis.");
      return diagnosticRecord(JSON.parse(bytes.toString("utf8")) as unknown);
    } finally {
      clearTimeout(timer); this.root.off("Tracing.tracingComplete", receive);
      if (stream !== null) await diagnosticCdp(this.root, "IO.close", { handle: stream }).catch(() => undefined);
    }
  }
}

export function summarizeCpuProfile(raw: unknown, window?: { fromUs: number; toUs: number }) {
  const profile = diagnosticRecord(raw);
  invariant(Array.isArray(profile.nodes) && Array.isArray(profile.samples) && Array.isArray(profile.timeDeltas)
    && profile.samples.length === profile.timeDeltas.length && profile.samples.length <= 1_000_000, "CPU profile shape invalid.");
  invariant(typeof profile.startTime === "number" && Number.isFinite(profile.startTime) && typeof profile.endTime === "number" && Number.isFinite(profile.endTime), "CPU profile clock invalid.");
  if (window) invariant(window.fromUs >= profile.startTime && window.toUs <= profile.endTime && window.fromUs < window.toUs, "CPU query window outside capture.");
  const nodes = new Map(profile.nodes.map(value => { const node = diagnosticRecord(value); return [node.id, node]; }));
  const time = new Map<unknown, number>(), counts = new Map<unknown, number>(); let at = profile.startTime, negativeDeltas = 0;
  // DevTools reconstructs timestamps and sorts paired samples: signed
  // deltas occur when the backend delivers samples out of timestamp order.
  // https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/models/cpu_profile/CPUProfileDataModel.ts
  const samples = profile.samples.map((id, index) => {
    const delta = (profile.timeDeltas as unknown[])[index];
    invariant(typeof delta === "number" && Number.isFinite(delta) && nodes.has(id), "CPU profile delta invalid.");
    if (delta < 0) negativeDeltas++; at += delta; invariant(Number.isFinite(at), "CPU sample timestamp invalid.");
    if (!window || (at >= window.fromUs && at <= window.toUs)) counts.set(id, (counts.get(id) ?? 0) + 1); return { id, at, index };
  }).sort((a, b) => a.at - b.at || a.index - b.index);
  for (let index = 0; index + 1 < samples.length; index++) {
    const current = samples[index], from = Math.max(current.at, window?.fromUs ?? current.at), to = Math.min(samples[index + 1].at, window?.toUs ?? samples[index + 1].at);
    if (to > from) time.set(current.id, (time.get(current.id) ?? 0) + to - from);
  }
  return { samples: profile.samples.length, startedAtUs: profile.startTime, finishedAtUs: profile.endTime,
    negativeDeltas, firstSampleAtUs: samples[0]?.at, lastSampleAtUs: samples.at(-1)?.at,
    window: window ?? null, samplesInWindow: [...counts.values()].reduce((sum, count) => sum + count, 0),
    selfTime: [...time].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([id, us]) => ({ nodeId: id, frame: nodes.get(id)?.callFrame, sampledIntervalMs: us / 1000 })),
    sampleFrequency: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([id, count]) => ({ nodeId: id, frame: nodes.get(id)?.callFrame, samples: count })),
    limitation: "Signed deltas are accumulated and sample/time pairs sorted. Intervals between consecutive samples are attributed to the earlier stack; capture edges are unassigned. These are sampled elapsed intervals, not exact CPU; idle samples and task gaps alone do not establish cooperative handoff delay." };
}

/** The one app-owned worker is traced only between its real query post/reply
 * marks. RunTask intervals include JS, GC and inspector work; gaps include
 * scheduling/transport and must not be relabeled exact cooperative wait. */
export function metricQueryTrace(trace: Record<string, unknown>) {
  invariant(Array.isArray(trace.traceEvents) && trace.traceEvents.length <= 1_000_000, "Query trace event bound exceeded.");
  const events = trace.traceEvents.map(diagnosticRecord), posts = events.filter(event => typeof event.name === "string" && event.name.startsWith("metric-query-post:") && typeof event.ts === "number");
  const workers = events.filter(event => event.name === "thread_name" && event.args !== null && typeof event.args === "object" && diagnosticRecord(event.args).name === "DedicatedWorker thread");
  if (posts.length !== 1 || workers.length !== 1) return { matched: false as const, reason: "Expected exactly one posted query and one dedicated worker in this isolated capture." };
  const post = posts[0], replies = events.filter(event => event.name === String(post.name).replace("metric-query-post:", "metric-query-reply:") && event.pid === post.pid && event.tid === post.tid && typeof event.ts === "number");
  if (replies.length !== 1 || Number(replies[0].ts) <= Number(post.ts)) return { matched: false as const, reason: "Query reply trace marker was missing, ambiguous or unordered." };
  const reply = replies[0];
  const window = { fromUs: Number(post.ts), toUs: Number(reply.ts) }, worker = workers[0];
  const tasks = events.filter(event => event.pid === worker.pid && event.tid === worker.tid && event.name === "RunTask" && event.ph === "X" && typeof event.ts === "number" && typeof event.dur === "number")
    .map(event => ({ from: Math.max(window.fromUs, Number(event.ts)), to: Math.min(window.toUs, Number(event.ts) + Number(event.dur)) }))
    .filter(value => value.to > value.from).sort((a, b) => a.from - b.from);
  let through = window.fromUs, activeUs = 0;
  for (const task of tasks) { activeUs += Math.max(0, task.to - Math.max(through, task.from)); through = Math.max(through, task.to); }
  return { matched: true as const, window, worker: { pid: worker.pid, tid: worker.tid }, taskCount: tasks.length, queryWireMs: (window.toUs - window.fromUs) / 1000,
    workerTaskMs: activeUs / 1000, nonTaskIntervalMs: (window.toUs - window.fromUs - activeUs) / 1000, maximumWorkerTaskMs: tasks.reduce((maximum, task) => Math.max(maximum, (task.to - task.from) / 1000), 0),
    limitation: "Clipped union of trace RunTask intervals, not pure CPU. Non-task intervals include transport and scheduling; profiler overhead remains in this instrumented sample." };
}

export function memoryProcessTotals(trace: Record<string, unknown>, ownedIds: ReadonlySet<number>) {
  invariant(Array.isArray(trace.traceEvents) && trace.traceEvents.length <= 1_000_000, "Memory trace event bound exceeded.");
  const values: unknown[] = [];
  for (const raw of trace.traceEvents) {
    const event = diagnosticRecord(raw); if (typeof event.pid !== "number" || !ownedIds.has(event.pid)) continue;
    if (event.args === null || typeof event.args !== "object") continue;
    const args = diagnosticRecord(event.args); if (args.dumps === null || typeof args.dumps !== "object") continue;
    const dumps = diagnosticRecord(args.dumps); if (dumps.process_totals === undefined) continue;
    invariant(values.length < 4096, "Memory process sample bound exceeded.");
    values.push({ pid: event.pid, timestampUs: event.ts, id: event.id ?? event.id2, rawProcessTotals: dumps.process_totals });
  }
  return { samples: values, limitation: "Raw Chrome memory-infra process totals retain their encoded units. Shared renderer/process footprint is not exclusive worker memory; sampled peaks are lower bounds." };
}
