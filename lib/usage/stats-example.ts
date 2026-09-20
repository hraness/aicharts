import { parseUsageStatsReport, statsRowKey, type UsageStatsRow, type UsageStatsReport } from "./stats-contract";

/** Synthetic numeric observations only; no local source or account is read. */
export function createUsageStatsExample(todayUtcDay: number): UsageStatsReport {
  const dayCount = Math.min(90, todayUtcDay + 1), firstUtcDay = todayUtcDay - dayCount + 1;
  const rows: UsageStatsRow[] = [];
  const clients = [
    { client: "codex", provider: "openai", model: "gpt-5", scale: 8 },
    { client: "claude", provider: "anthropic", model: "claude-sonnet-4", scale: 5 },
    { client: "cursor", provider: null, model: null, scale: 3 },
    { client: "devin-cli", provider: null, model: null, scale: 2 },
  ];
  for (let index = 0; index < dayCount; index++) {
    if (index % 13 === 0) continue;
    for (const [clientIndex, client] of clients.entries()) {
      const count = 5 + (index * 7 + clientIndex * 3) % 31;
      const scale = BigInt(client.scale * count * (18 + index % 9));
      rows.push({ utcDay: firstUtcDay + index, client: client.client, provider: client.provider, model: client.model,
        tokens: { input: (scale * 193n).toString(), cacheRead: (scale * 821n).toString(), cacheWrite: client.client === "claude" ? (scale * 123n).toString() : "0", output: (scale * 73n).toString(), reasoning: client.client === "codex" ? (scale * 31n).toString() : "0" },
        records: count, reportedCostMicrousd: client.client === "cursor" ? (scale * 125n).toString() : null,
        reportedCostRecords: client.client === "cursor" ? count : 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
        durationMs: client.client === "codex" ? (scale * 22n).toString() : null,
        timedRecords: client.client === "codex" ? count : 0, timedTokens: client.client === "codex" ? (scale * 1118n).toString() : "0",
        tokenBasis: "reported", breakdownCoverage: clientIndex > 1 ? "partial" : "complete" });
    }
  }
  rows.push({ utcDay: todayUtcDay, client: "freebuff", provider: null, model: null,
    tokens: { input: "45000", cacheRead: "0", cacheWrite: "0", output: "15000", reasoning: "0" }, records: 6,
    reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "estimated", breakdownCoverage: "partial" });
  rows.push({ utcDay: todayUtcDay, client: "warp", provider: null, model: null,
    tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, records: 12,
    reportedCostMicrousd: "12345000", reportedCostRecords: 12, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "unavailable", breakdownCoverage: "partial" });
  const generatedAtMs = (todayUtcDay + 1) * 86_400_000 - 1;
  const report = parseUsageStatsReport({ schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1,
    firstUtcDay, dayCount, generatedAtMs, revision: 0, updatedAtMs: null,
    sources: [...clients.map(({ client }) => client), "freebuff", "warp", "opencode"].map(client => ({ client,
      status: client === "opencode" ? "not_found" : "observed", tokenBasis: client === "freebuff" ? "estimated" : client === "warp" || client === "opencode" ? "unavailable" : "reported",
      records: rows.filter(row => row.client === client).reduce((sum, row) => sum + row.records, 0), warnings: 0,
      latestAtMs: rows.some(row => row.client === client) ? todayUtcDay * 86_400_000 : null })).sort((a, b) => a.client.localeCompare(b.client)),
    rows: rows.sort((a, b) => statsRowKey(a) < statsRowKey(b) ? -1 : 1) });
  if (report === null) throw new Error("Invalid checked synthetic stats example");
  return report;
}
