#!/usr/bin/env node
// Runs a built macOS aicharts binary against an empty private home: version,
// local history status and report, and the read-only MCP handshake. Nothing
// here reads the runner's real agent folders or opens a network connection.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const MCP_TOOLS = ["usage_summary", "usage_daily", "usage_report", "usage_clients", "usage_history_status"];

export function smoke(binary, version) {
  const home = mkdtempSync(path.join(tmpdir(), "aicharts-macos-smoke-"));
  const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, AICHARTS_HOME: path.join(home, "aicharts"), HRANESS_SUPPORT_AUDIENCE: "off", NO_COLOR: "1", LC_ALL: "C" };
  const run = (args, input) => {
    const result = spawnSync(binary, args, { env, input, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`smoke_failed:${args.join(" ")}`);
    return result.stdout;
  };
  try {
    const reported = run(["--version"]).match(/^aicharts ([0-9]+\.[0-9]+\.[0-9]+)(?: \([0-9a-f]{7,40}\))?\n$/u)?.[1];
    if (reported !== version) throw new Error("smoke_failed:version");
    const status = JSON.parse(run(["history", "status", "--json"]));
    if (status.ok !== true || status.schema !== "aicharts.history-status/1" || status.data?.collecting !== "off" || status.data?.uploaded !== false) throw new Error("smoke_failed:history_status");
    const report = JSON.parse(run(["history", "report", "--json", "--days", "3"]));
    if (report.schemaVersion !== 2 || report.profile !== "client-stats-v2" || report.dayCount !== 3 || !Array.isArray(report.rows) || report.rows.length !== 0) throw new Error("smoke_failed:history_report");
    const requests = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "release-smoke", version: "1" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ];
    const replies = run(["mcp"], requests.map(request => JSON.stringify(request)).join("\n") + "\n").trim().split("\n").map(line => JSON.parse(line));
    const initialized = replies.find(reply => reply.id === 1), listed = replies.find(reply => reply.id === 2);
    if (initialized?.result?.serverInfo?.name !== "aicharts" || initialized.result.serverInfo.version !== version) throw new Error("smoke_failed:mcp_initialize");
    const tools = listed?.result?.tools?.map(tool => tool.name);
    if (JSON.stringify(tools) !== JSON.stringify(MCP_TOOLS)) throw new Error("smoke_failed:mcp_tools");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { binary: { type: "string" }, version: { type: "string" } } });
  if (!values.binary || !path.isAbsolute(values.binary) || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(values.version ?? "")) {
    console.error("usage: macos-smoke.mjs --binary /absolute/aicharts --version X.Y.Z");
    process.exit(2);
  }
  try {
    smoke(values.binary, values.version);
    console.log(`smoke passed: aicharts ${values.version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "smoke_failed");
    process.exit(1);
  }
}
