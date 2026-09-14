import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeSessionReport } from "../lib/usage/sessions";
import { startMonitor } from "./usage-session-monitor";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
function packet(output = 3, session = "session-a") {
  const base = 1_757_800_000_000_000_000n;
  const span = (id: string, name: string, start: bigint, end: bigint, attrs: unknown[], parentSpanId?: string) => ({ traceId: "0123456789abcdef0123456789abcdef", spanId: id, ...(parentSpanId ? { parentSpanId } : {}), name, startTimeUnixNano: String(start), endTimeUnixNano: String(end), attributes: attrs });
  const attr = (key: string, value: string | number) => ({ key, value: typeof value === "string" ? { stringValue: value } : { intValue: String(value) } });
  const interaction = span("0123456789abcdef", "claude_code.interaction", base, base + 1_000_000_000n, [attr("session.id", session)]);
  const llm = span("fedcba9876543210", "claude_code.llm_request", base + 100_000_000n, base + 500_000_000n, [attr("session.id", session), attr("model", "claude-sonnet-4-6"), attr("input_tokens", 2), attr("output_tokens", output), attr("cache_read_tokens", 1), attr("cache_creation_tokens", 1)], interaction.spanId);
  return { resourceSpans: [{ scopeSpans: [{ spans: [interaction, llm] }] }] };
}
async function setup() { const dir = await mkdtemp(join(tmpdir(), "aicharts-monitor-")); dirs.push(dir); await chmod(dir, 0o700); const key = join(dir, "key"), output = join(dir, "report.json"); await writeFile(key, new Uint8Array(32).fill(9), { mode: 0o600 }); return { dir, key, output }; }

describe("usage session monitor", () => {
  test("accepts, appends and replays immutable OTLP batches", async () => {
    const { key, output } = await setup(); const monitor = await startMonitor({ key, output, host: "127.0.0.1", port: 0 });
    try {
      const url = `http://127.0.0.1:${monitor.port}/v1/traces`, body = JSON.stringify(packet());
      const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body }); expect(first.status).toBe(200); expect(await first.json()).toEqual({});
      const second = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(packet(4, "session-b")) }); expect(second.status).toBe(200);
      const replay = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body }); expect(replay.status).toBe(200);
      const beforeConflict = await readFile(output, "utf8"); const conflict = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(packet(99)) }); expect(conflict.status).toBe(400); expect(await readFile(output, "utf8")).toBe(beforeConflict);
      const oversized = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "content-length": "8388609" }, body: "{}" }); expect(oversized.status).toBe(400);
      const report = decodeSessionReport(await readFile(output, "utf8")); expect(report?.sessions).toHaveLength(2); expect(report?.sessions.flatMap(session => session.usage)).toHaveLength(2);
    } finally { await monitor.stop(); }
  });
  test("refuses browser and wrong-method requests", async () => {
    const { key, output } = await setup(); const monitor = await startMonitor({ key, output, host: "127.0.0.1", port: 0 });
    try { const url = `http://127.0.0.1:${monitor.port}/v1/traces`, body = JSON.stringify(packet()); expect((await fetch(url, { method: "GET" })).status).toBe(404); expect((await fetch(url, { method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body })).status).toBe(404); expect((await fetch(url, { method: "POST", headers: { "content-type": "application/json", host: "wrong.test" }, body })).status).toBe(404); } finally { await monitor.stop(); }
  });
  test("refuses a competing owner lock", async () => {
    const { key, output } = await setup(); const first = await startMonitor({ key, output, host: "127.0.0.1", port: 0 });
    try { await expect(startMonitor({ key, output, host: "127.0.0.1", port: 0 })).rejects.toThrow(); } finally { await first.stop(); }
  });
  test("refuses symlinked key and output parent", async () => {
    const { dir, output } = await setup(), keyLink = join(dir, "key-link"), parentLink = join(dir, "linked"); await symlink(join(dir, "key"), keyLink); await symlink(dir, parentLink);
    await expect(startMonitor({ key: keyLink, output, host: "127.0.0.1", port: 0 })).rejects.toThrow();
    await expect(startMonitor({ key: join(dir, "key"), output: join(parentLink, "report.json"), host: "127.0.0.1", port: 0 })).rejects.toThrow();
  });
});
