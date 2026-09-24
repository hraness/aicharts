import { MetricWorkerCore, type MetricWorkerReply } from "./metric-explorer-worker-core";

// A channel task yields to incoming query/cancel messages without the nested
// timer clamp. Terminating the owned worker destroys this channel and its data.
const channel = new MessageChannel();
let resume: (() => void) | null = null;
channel.port1.onmessage = () => { const done = resume; resume = null; done?.(); };
const worker = globalThis as unknown as { postMessage: (message: MetricWorkerReply, transfer?: Transferable[]) => void; onmessage: ((event: MessageEvent<unknown>) => void) | null };
const core = new MetricWorkerCore(message => worker.postMessage(message, message.kind === "result" ? [message.view] : []), () => new Promise<void>(done => { resume = done; channel.port2.postMessage(null); }));
worker.onmessage = event => core.receive(event.data);
