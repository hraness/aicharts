import { describe, expect, test } from "bun:test";
import { mergeSessionReports, parseOtlpTraces } from "./session-telemetry";

const key = new Uint8Array(32).fill(7);
const ns = "1757800000000000000";
function attr(key: string, stringValue?: string, intValue?: number) { return { key, value: stringValue !== undefined ? { stringValue } : { intValue: String(intValue) } }; }
type TestSpan = { traceId: string; spanId: string; parentSpanId?: string; name: string; startTimeUnixNano: string; endTimeUnixNano: string; attributes: ReturnType<typeof attr>[] };
function packet(output = 20): { resourceSpans: Array<{ resource: { attributes: ReturnType<typeof attr>[] }; scopeSpans: Array<{ spans: TestSpan[] }> }> } {
  return { resourceSpans: [{ resource: { attributes: [attr("session.id", "sess-a")] }, scopeSpans: [{ spans: [
    { traceId: "0123456789abcdef0123456789abcdef", spanId: "0000000000000001", name: "claude_code.interaction", startTimeUnixNano: ns, endTimeUnixNano: "1757800003000000000", attributes: [] },
    { traceId: "0123456789abcdef0123456789abcdef", spanId: "0000000000000002", parentSpanId: "0000000000000001", name: "claude_code.tool", startTimeUnixNano: "1757800001000000000", endTimeUnixNano: "1757800002000000000", attributes: [] },
    { traceId: "0123456789abcdef0123456789abcdef", spanId: "0000000000000003", parentSpanId: "0000000000000002", name: "claude_code.tool.execution", startTimeUnixNano: "1757800001000000000", endTimeUnixNano: "1757800002000000000", attributes: [] },
    { traceId: "0123456789abcdef0123456789abcdef", spanId: "0000000000000004", parentSpanId: "0000000000000001", name: "claude_code.llm_request", startTimeUnixNano: "1757800002000000000", endTimeUnixNano: "1757800003000000000", attributes: [attr("model", "claude-sonnet-4-6"), attr("input_tokens", undefined, 10), attr("output_tokens", undefined, output), attr("cache_read_tokens", undefined, 0), attr("cache_creation_tokens", undefined, 0)] },
  ] }] }] };
}
describe("Claude Code OTLP adapter", () => {
  test("preserves current-epoch nanoseconds and documented tool/model spans", async () => {
    const report = await parseOtlpTraces(packet(), key); const session = report.sessions[0];
    expect(session.window).toEqual({ startMs: 1757800000000, endMs: 1757800003000 });
    expect(session.spans.some(span => span.kind === "tool_wait")).toBe(true);
    const humanPacket = packet() as { resourceSpans: Array<{ scopeSpans: Array<{ spans: unknown[] }> }> }; humanPacket.resourceSpans[0].scopeSpans[0].spans.push({ traceId: "0123456789abcdef0123456789abcdef", spanId: "0000000000000005", parentSpanId: "0000000000000002", name: "claude_code.tool.blocked_on_user", startTimeUnixNano: "1757800001000000000", endTimeUnixNano: "1757800001500000000", attributes: [attr("decision", "accept"), attr("source", "user_temporary")] });
    const human = await parseOtlpTraces(humanPacket, key); expect(human.sessions[0].spans.some(span => span.kind === "approval_wait")).toBe(true);
    expect(session.usage[0]).toMatchObject({ model: "claude-sonnet-4-6", modelBasis: "request", inputTokens: 10, outputTokens: 20 });
  });
  test("replay is idempotent and conflicting immutable span aborts", async () => {
    const first = await parseOtlpTraces(packet(), key), replay = await parseOtlpTraces(packet(), key);
    expect(mergeSessionReports(first, replay)).toEqual(first);
    const changed = await parseOtlpTraces(packet(21), key);
    expect(() => mergeSessionReports(first, changed)).toThrow("conflicting_span");
  });
  test("ignores unallowlisted attributes and unsupported spans", async () => {
    const value = packet() as { resourceSpans: Array<{ scopeSpans: Array<{ spans: unknown[] }> }> }; value.resourceSpans[0].scopeSpans[0].spans.push({ traceId: "0123456789abcdef0123456789abcdef", spanId: "0000000000000006", name: "claude_code.tool.execution", startTimeUnixNano: ns, endTimeUnixNano: "1757800000001000000", attributes: [attr("content", "secret")] });
    const report = await parseOtlpTraces(value, key); expect(JSON.stringify(report)).not.toContain("secret");
  });
  test("counts requests before their parent turn exports and separates subagents", async () => {
    const value = packet(), spans = value.resourceSpans[0].scopeSpans[0].spans;
    const rootRequest = spans[3], childRequest = { ...rootRequest, spanId: "0000000000000007", attributes: [...rootRequest.attributes, attr("agent_id", "child-a")] };
    value.resourceSpans[0].scopeSpans[0].spans = [rootRequest, childRequest];
    const report = await parseOtlpTraces(value, key);
    expect(report.sessions).toHaveLength(2);
    expect(report.sessions[0].conversationId).toBe(report.sessions[1].conversationId);
    expect(report.sessions[0].sessionId).not.toBe(report.sessions[1].sessionId);
    expect(report.sessions.map(s => s.usage[0].outputTokens)).toEqual([20, 20]);
    expect(report.sessions.flatMap(s => s.spans).map(s => s.kind)).toEqual(["model_request", "model_request"]);
  });
  test("does not turn automated decisions or question tools into human or inference time", async () => {
    const value = packet(), spans = value.resourceSpans[0].scopeSpans[0].spans;
    spans[1].attributes.push(attr("tool_name", "AskUserQuestion"));
    spans.push({ ...spans[2], spanId: "0000000000000008", name: "claude_code.tool.blocked_on_user", attributes: [attr("source", "config"), attr("decision", "accept")] });
    const report = await parseOtlpTraces(value, key);
    expect(report.sessions[0].spans.map(s => s.kind)).toEqual(["model_request"]);
  });
  test("rejects conflicting actor identity before deduplication", async () => {
    const value = packet(), spans = value.resourceSpans[0].scopeSpans[0].spans;
    spans.push({ ...spans[3], attributes: [...spans[3].attributes, attr("agent_id", "child-a")] });
    await expect(parseOtlpTraces(value, key)).rejects.toThrow("conflicting_span");
  });
  test("missing cache counters do not invent zero usage and malformed counters abort", async () => {
    const value = packet(), span = value.resourceSpans[0].scopeSpans[0].spans[3];
    span.attributes = span.attributes.filter(a => a.key !== "cache_read_tokens");
    const report = await parseOtlpTraces(value, key);
    expect(report.sessions[0].usage).toEqual([]);
    expect(report.sessions[0].spans.some(s => s.kind === "model_request")).toBe(true);
    span.attributes.push(attr("cache_read_tokens", undefined, -1));
    await expect(parseOtlpTraces(value, key)).rejects.toThrow("invalid_traces");
  });
  test("uses only the selected key view and rejects malformed IDs", async () => {
    const storage = new Uint8Array(64).fill(3); storage.set(key, 16);
    expect(await parseOtlpTraces(packet(), storage.subarray(16, 48))).toEqual(await parseOtlpTraces(packet(), key));
    const value = packet(); value.resourceSpans[0].scopeSpans[0].spans[0].traceId = "00000000000000000000000000000000";
    await expect(parseOtlpTraces(value, key)).rejects.toThrow("invalid_traces");
  });
  test("rejects malformed present parent identities", async () => {
    for (const parentSpanId of [null, 1, {}, []]) {
      const value = packet(); Object.assign(value.resourceSpans[0].scopeSpans[0].spans[3], { parentSpanId });
      await expect(parseOtlpTraces(value, key)).rejects.toThrow("invalid_traces");
    }
  });
});
