import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { constants, type BigIntStats } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { mergeSessionReports, parseOtlpBody } from "../lib/usage/session-telemetry";
import { SESSION_REPORT_MAX_BYTES, SESSION_REPORT_PROFILE, type SessionReport } from "../lib/usage/session-contract";
import { decodeSessionReport, parseSessionReport } from "../lib/usage/sessions";

const MAX_BODY = SESSION_REPORT_MAX_BYTES;
export type MonitorOptions = Readonly<{ key: string; output: string; host: "127.0.0.1"; port: number }>;
const missing = (e: unknown) => e !== null && typeof e === "object" && "code" in e && e.code === "ENOENT";
const same = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.mode === b.mode && a.uid === b.uid && a.nlink === b.nlink;
const privateOwner = (s: BigIntStats) => s.uid === BigInt(process.getuid?.() ?? -1) && (s.mode & 0o077n) === 0n;
const privateRegular = (s: BigIntStats) => s.isFile() && privateOwner(s) && s.nlink === 1n;

async function readPrivate(path: string, maximum: number) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!privateRegular(before) || before.size > BigInt(maximum)) throw new Error("invalid_file");
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new Error("file_changed");
      offset += bytesRead;
    }
    if (!same(before, await handle.stat({ bigint: true })) || !same(before, await lstat(path, { bigint: true }))) throw new Error("file_changed");
    return { bytes, stamp: before };
  } finally { await handle.close(); }
}

async function readBody(request: Request): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^[1-9]\d{0,7}$/.test(length) || Number(length) > MAX_BODY)) throw new Error("invalid_body");
  if (!request.body) throw new Error("invalid_body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("body_timeout")), 10_000); });
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) break;
      if ((size += next.value.length) > MAX_BODY) throw new Error("body_limit");
      chunks.push(next.value);
    }
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (length !== null && Number(length) !== size) throw new Error("invalid_body");
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** One explicit private report, one writer and a loopback-only OTLP endpoint. */
export async function startMonitor(config: MonitorOptions): Promise<{ port: number; stop(): Promise<void> }> {
  if (config.host !== "127.0.0.1" || !Number.isInteger(config.port) || config.port < 0 || config.port > 65_535
    || !isAbsolute(config.key) || !isAbsolute(config.output) || resolve(config.key) === resolve(config.output)) throw new Error("invalid_options");
  const keyFile = await readPrivate(config.key, 32);
  if (keyFile.bytes.length !== 32 || keyFile.bytes.every(byte => byte === 0)) { keyFile.bytes.fill(0); throw new Error("invalid_key"); }
  const key = Uint8Array.from(keyFile.bytes);
  keyFile.bytes.fill(0);
  const namedParent = dirname(config.output);
  if ((await lstat(namedParent)).isSymbolicLink()) throw new Error("invalid_parent");
  const parent = await realpath(namedParent);
  // The private directory is the local custody boundary, not a hostile same-user sandbox.
  const parentHandle = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let lockHandle: Awaited<ReturnType<typeof open>> | null = null;
  let lockStamp: BigIntStats | null = null;
  const output = join(parent, basename(config.output)), lockPath = `${output}.lock`;
  const parentStamp = await parentHandle.stat({ bigint: true });
  const verifyParent = async () => {
    const current = await lstat(parent, { bigint: true });
    if (!current.isDirectory() || !privateOwner(current) || current.dev !== parentStamp.dev || current.ino !== parentStamp.ino
      || await realpath(namedParent) !== parent) throw new Error("parent_changed");
  };
  const release = async () => {
    try {
      if (lockStamp !== null) {
        await verifyParent(); const current = await lstat(lockPath, { bigint: true });
        if (same(current, lockStamp)) await unlink(lockPath);
      }
    } finally { await lockHandle?.close(); await parentHandle.close(); key.fill(0); }
  };
  try {
    if (!parentStamp.isDirectory() || !privateOwner(parentStamp)) throw new Error("invalid_parent");
    await verifyParent();
    lockHandle = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    lockStamp = await lockHandle.stat({ bigint: true });
    let expected: BigIntStats | null = null;
    let report: SessionReport = { schemaVersion: 1, profile: SESSION_REPORT_PROFILE, sessions: [] };
    try {
      const existing = await readPrivate(output, MAX_BODY); expected = existing.stamp;
      const parsed = decodeSessionReport(new TextDecoder("utf-8", { fatal: true }).decode(existing.bytes));
      if (!parsed) throw new Error("invalid_report");
      report = parsed;
    } catch (e) { if (!missing(e)) throw e; }
    const verifyOutput = async () => {
      await verifyParent();
      try { const current = await lstat(output, { bigint: true }); if (expected === null || !same(current, expected)) throw new Error("output_changed"); }
      catch (e) { if (expected !== null || !missing(e)) throw e; }
    };
    let active = false, failed = false, stopped = false;
    let activeWork = Promise.resolve();
    const publish = async (next: SessionReport) => {
      const text = JSON.stringify(next);
      if (new TextEncoder().encode(text).length > MAX_BODY) throw new Error("report_limit");
      await verifyOutput();
      const temporary = join(parent, `.${basename(output)}.${crypto.randomUUID()}.pending`);
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      let renamed = false;
      try {
        await handle.writeFile(text); await handle.sync(); await verifyOutput();
        // After rename an error is an uncertain publication; stop accepting batches.
        await rename(temporary, output); renamed = true; await parentHandle.sync();
        const written = await readPrivate(output, MAX_BODY);
        if (written.bytes.toString("utf8") !== text) throw new Error("output_changed");
        expected = written.stamp;
      } catch { failed = true; throw new Error("publication_failed"); }
      finally {
        await handle.close();
        if (!renamed) { await verifyParent(); await unlink(temporary).catch(() => {}); }
      }
    };
    const reply = (status: number) => new Response(status === 200 ? "{}" : null, { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    const server = Bun.serve({ hostname: "127.0.0.1", port: config.port, maxRequestBodySize: MAX_BODY, idleTimeout: 10,
      async fetch(request) {
        if (active || failed || stopped) return reply(503);
        const url = new URL(request.url);
        if (request.headers.get("host") !== `127.0.0.1:${server.port}` || url.pathname !== "/v1/traces" || url.search !== ""
          || request.method !== "POST" || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")
          || ["origin", "cookie", "authorization", "sec-fetch-site", "sec-fetch-mode", "content-encoding"].some(name => request.headers.has(name))) return reply(404);
        active = true;
        let finished: () => void = () => {};
        activeWork = new Promise<void>(done => { finished = done; });
        try {
          const incoming = await parseOtlpBody(await readBody(request), key);
          const merged = parseSessionReport(mergeSessionReports(report, incoming));
          if (merged === null) throw new Error("invalid_report");
          if (stopped) return reply(503);
          await publish(merged); report = merged; return reply(200);
        } catch { return reply(failed ? 503 : 400); }
        finally { active = false; finished(); }
      }, error() { return reply(400); },
    });
    let stopping: Promise<void> | null = null;
    return { port: server.port!, stop() {
      stopping ??= (async () => { stopped = true; try { await server.stop(true); await activeWork; } finally { await release(); } })();
      return stopping;
    } };
  } catch (e) { await release(); throw e; }
}

function options(argv: readonly string[]): MonitorOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if (!["--key-file", "--output", "--host", "--port"].includes(flag) || value === undefined || value.startsWith("--") || values.has(flag)) throw new Error("invalid_options");
    values.set(flag, value);
  }
  const key = values.get("--key-file"), output = values.get("--output"), port = values.get("--port") ?? "12701";
  if (!key || !output || !/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65_535 || (values.get("--host") ?? "127.0.0.1") !== "127.0.0.1") throw new Error("invalid_options");
  return { key: resolve(key), output: resolve(output), host: "127.0.0.1", port: Number(port) };
}
if (import.meta.main) {
  if (process.argv.slice(2).join(" ") === "--help") {
    console.log("bun scripts/usage-session-monitor.ts --key-file PRIVATE_KEY --output PRIVATE_REPORT [--port 12701]\nThe output parent must already be private. Receives Claude Code OTLP JSON at 127.0.0.1 only; no provider settings are changed.");
  } else {
    try {
      const monitor = await startMonitor(options(process.argv.slice(2)));
      console.log(`AI Charts session monitor: http://127.0.0.1:${monitor.port}/v1/traces`);
      const stop = () => { void monitor.stop().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; }); };
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
    } catch { console.error("AI Charts session monitor refused setup; check private paths and any existing writer lock."); process.exitCode = 1; }
  }
}
