import { err, ok, type Result } from "../result";
import { DEVIN_SESSION_MODELS, SESSION_MODELS } from "./session-contract";
import {
  RICH_FACT_KINDS, RICH_FACT_MAX_BYTES, RICH_FACT_MAX_COUNTER, RICH_FACT_MAX_EXECUTIONS,
  RICH_FACT_MAX_LINEAGE_DEPTH, RICH_FACT_MAX_RECORDS, RICH_FACT_MAX_WINDOW_MS, RICH_FACT_PROFILE,
  type RichDistribution, type RichFact, type RichFactError, type RichFactReport, type RichOwner,
  type RichPayload, type RichProvenance, type RichSelection, type RichTokenAggregation, type RichUsage, type RichWindow,
} from "./rich-fact-contract";

const MAX_TIME = 8_640_000_000_000_000;
const tokenFields = ["inputUncached", "cacheRead", "cacheWrite5m", "cacheWrite1h", "cacheWriteUnknown", "output"] as const;
const grains = ["usage_observation", "request", "response", "turn", "session"] as const;
const scopes = ["direct", "inclusive", "unknown"] as const;
const lineages = ["root", "child", "unknown"] as const;
const timingBasis = { inference: "stream_lifecycle", reply_wait: "human_boundary", approval_wait: "human_boundary", tool_wait: "tool_lifecycle", model_request: "request_lifecycle" } as const;
const fault = (code: RichFactError = "invalid_rich_facts"): never => { throw code; };
const oneOf = (value: unknown, values: readonly unknown[]) => values.includes(value);
const integer = (value: unknown, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value <= max;
const id = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{32}$/.test(value) && !/^0+$/.test(value);
const decimal = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,23})$/.test(value);
const nullableTime = (value: unknown): value is number | null => value === null || integer(value, MAX_TIME);
const uncertainty = (value: unknown) => value === null || integer(value, 60_000);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Fixed data descriptors only; no source accessor, sparse slot or extra field is evaluated. */
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) return fault();
  if (Reflect.ownKeys(value).length !== keys.length) return fault();
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return fault();
    output[key] = descriptor.value;
  }
  return output;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fault();
  const length: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!integer(length, RICH_FACT_MAX_RECORDS)) return fault("record_limit");
  if (Reflect.ownKeys(value).length !== length + 1) return fault();
  return Array.from({ length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return fault();
    return descriptor.value as unknown;
  });
}
function window(value: unknown): RichWindow {
  const v = fields(value, ["startMs", "endMs"]);
  if (!integer(v.startMs, MAX_TIME) || !integer(v.endMs, MAX_TIME) || v.endMs <= v.startMs || v.endMs - v.startMs > RICH_FACT_MAX_WINDOW_MS) return fault();
  return v as RichWindow;
}
function provenance(value: unknown): RichProvenance {
  const v = fields(value, ["profile", "version", "sourceId"]);
  if (!oneOf(v.profile, ["session-observations-v1", "terminal-turns-v1", "compaction-events-v1", "numeric-producer-v1"]) || v.version !== 1 || !id(v.sourceId)) return fault();
  return v as RichProvenance;
}
function owner(value: unknown): RichOwner {
  const v = fields(value, ["provider", "accountId", "executionId", "conversationId", "lineage", "parentExecutionId"]);
  if (!oneOf(v.provider, ["codex", "claude_code", "devin"]) || !id(v.executionId)
    || (v.accountId !== null && !id(v.accountId)) || (v.conversationId !== null && !id(v.conversationId))
    || !oneOf(v.lineage, lineages) || (v.lineage === "child" ? v.parentExecutionId !== null && (!id(v.parentExecutionId) || v.parentExecutionId === v.executionId) : v.parentExecutionId !== null)) return fault("invalid_lineage");
  return v as RichOwner;
}
function value(input: unknown, kind: RichFact["kind"], owned: RichOwner, atMs: number): RichPayload {
  let v: Record<string, unknown>;
  if (kind === "usage") {
    v = fields(input, ["kind", "grain", "observationId", "tokenScope", "model", "modelBasis", "tokens"]);
    if (!oneOf(v.grain, grains) || !oneOf(v.tokenScope, scopes)
      || (v.model !== null && !oneOf(v.model, SESSION_MODELS))
      || (v.model === null ? v.modelBasis !== "unknown" : !oneOf(v.modelBasis, ["request", "response"]))) return fault();
    if (v.model !== null && (owned.provider === "codex" ? !(v.model as string).startsWith("gpt-") : owned.provider === "claude_code" ? !(v.model as string).startsWith("claude-") : !oneOf(v.model, DEVIN_SESSION_MODELS))) return fault();
    if (v.grain === "session" && v.observationId !== owned.executionId) return fault();
    const tokens = fields(v.tokens, [...tokenFields, "reasoning"]);
    if (tokenFields.some(key => !decimal(tokens[key])) || (tokens.reasoning !== null && (!decimal(tokens.reasoning) || BigInt(tokens.reasoning) > BigInt(tokens.output as string)))) return fault();
    if (tokenFields.reduce((total, key) => total + BigInt(tokens[key] as string), 0n) > RICH_FACT_MAX_COUNTER) return fault();
    v.tokens = tokens;
  } else if (kind === "span") {
    v = fields(input, ["kind", "observationId", "phase", "basis", "startMs", "endMs", "clockUncertaintyMs"]);
    if (typeof v.phase !== "string" || !Object.hasOwn(timingBasis, v.phase) || v.basis !== timingBasis[v.phase as keyof typeof timingBasis]
      || !integer(v.startMs, MAX_TIME) || !integer(v.endMs, MAX_TIME) || v.endMs <= v.startMs || v.endMs !== atMs
      || v.endMs - v.startMs > RICH_FACT_MAX_WINDOW_MS || !uncertainty(v.clockUncertaintyMs)) return fault();
  } else if (kind === "request") {
    v = fields(input, ["kind", "observationId", "stage", "outcome", "requestedAtMs", "dispatchedAtMs", "terminalAtMs", "firstTokenAtMs", "lastTokenAtMs", "clockUncertaintyMs", "retryOf"]);
    const times = [v.requestedAtMs, v.dispatchedAtMs, v.firstTokenAtMs, v.lastTokenAtMs, v.terminalAtMs];
    if (!times.every(nullableTime) || !uncertainty(v.clockUncertaintyMs) || !oneOf(v.stage, ["requested", "dispatched", "terminal"])
      || !oneOf(v.outcome, ["unknown", "success", "error", "refusal", "cancel", "timeout"])
      || (v.retryOf !== null && (!id(v.retryOf) || v.retryOf === v.observationId))) return fault();
    const present = times.filter((time): time is number => time !== null);
    if (present.length === 0 || present.at(-1) !== atMs || present.some((time, index) => index > 0 && time < present[index - 1]!) || atMs - present[0]! > RICH_FACT_MAX_WINDOW_MS) return fault();
    if ((v.firstTokenAtMs !== null && v.dispatchedAtMs === null) || (v.lastTokenAtMs !== null && v.firstTokenAtMs === null)) return fault();
    if (v.stage === "requested" ? v.requestedAtMs === null || v.dispatchedAtMs !== null || v.terminalAtMs !== null
      : v.stage === "dispatched" ? v.dispatchedAtMs === null || v.terminalAtMs !== null : v.terminalAtMs === null) return fault();
    if (v.stage !== "terminal" && v.outcome !== "unknown") return fault();
  } else if (kind === "turn") {
    v = fields(input, ["kind", "observationId", "origin", "outcome", "startedAtMs", "endedAtMs", "clockUncertaintyMs", "toolCalls"]);
    if (!oneOf(v.origin, ["human", "automation", "unknown"]) || !oneOf(v.outcome, ["completed", "aborted"])
      || !nullableTime(v.startedAtMs) || v.endedAtMs !== atMs || !uncertainty(v.clockUncertaintyMs)
      || (v.startedAtMs === null ? v.clockUncertaintyMs !== null : v.startedAtMs > atMs || atMs - v.startedAtMs > RICH_FACT_MAX_WINDOW_MS)
      || (v.toolCalls !== null && !integer(v.toolCalls, 1_000_000))) return fault();
  } else if (kind === "tool") {
    v = fields(input, ["kind", "observationId", "stage", "outcome"]);
    if (!oneOf(v.stage, ["requested", "dispatched", "terminal"]) || !oneOf(v.outcome, ["unknown", "success", "error", "cancel", "timeout"]) || (v.stage !== "terminal" && v.outcome !== "unknown")) return fault();
  } else if (kind === "context") {
    v = fields(input, ["kind", "observationId", "tokens", "limitTokens"]);
    if (!decimal(v.tokens) || (v.limitTokens !== null && !decimal(v.limitTokens))) return fault();
  } else {
    v = fields(input, ["kind", "observationId", "action", "outcome", "beforeTokens", "afterTokens", "durationMs"]);
    if (!oneOf(v.action, ["provider_compact", "transcript_compact", "none"]) || !oneOf(v.outcome, ["applied", "planned", "failed", "skipped"])
      || !decimal(v.beforeTokens) || !decimal(v.afterTokens) || !integer(v.durationMs, RICH_FACT_MAX_WINDOW_MS)
      || (v.action === "none" && v.outcome === "applied")) return fault();
  }
  if (v.kind !== kind || !id(v.observationId)) return fault();
  return v as RichPayload;
}

function heads(facts: readonly RichFact[]): RichFact[] {
  const revisions = new Map<string, RichFact>(), latest = new Map<string, RichFact>();
  const identities = new Map<string, string>();
  for (const fact of facts) {
    const revisionKey = `${fact.id}:${fact.revision}`, repeated = revisions.get(revisionKey), previous = latest.get(fact.id);
    if (repeated && !same(repeated, fact)) return fault("conflicting_fact");
    if (previous && (previous.kind !== fact.kind || !same(previous.owner, fact.owner) || !same(previous.provenance, fact.provenance))) return fault("conflicting_owner");
    if (fact.value !== null) {
      const identity = JSON.stringify([fact.value.observationId, ...(fact.value.kind === "usage" ? [fact.value.grain, fact.value.tokenScope] : [])]);
      if (identities.has(fact.id) && identities.get(fact.id) !== identity) return fault("conflicting_fact");
      identities.set(fact.id, identity);
    }
    revisions.set(revisionKey, fact);
    if (!previous || fact.revision > previous.revision) latest.set(fact.id, fact);
  }
  return [...latest.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function validateHeads(facts: readonly RichFact[]): void {
  const owners = new Map<string, RichOwner>(), observations = new Set<string>();
  const retries = new Map<string, string | null>();
  for (const fact of facts) {
    const previous = owners.get(fact.owner.executionId);
    if (previous && !same(previous, fact.owner)) return fault("conflicting_owner");
    owners.set(fact.owner.executionId, fact.owner);
    if (owners.size > RICH_FACT_MAX_EXECUTIONS) return fault("record_limit");
    if (fact.value === null) continue;
    const key = `${fact.owner.executionId}:${fact.kind}:${fact.value.observationId}${fact.value.kind === "usage" ? `:${fact.value.grain}:${fact.value.tokenScope}` : ""}`;
    if (observations.has(key)) return fault("conflicting_fact");
    observations.add(key);
    if (fact.value.kind === "request") retries.set(`${fact.owner.executionId}:${fact.value.observationId}`,
      fact.value.retryOf === null ? null : `${fact.owner.executionId}:${fact.value.retryOf}`);
  }
  for (const owned of owners.values()) {
    const seen = new Set<string>();
    let current: RichOwner | undefined = owned;
    while (current) {
      if (seen.has(current.executionId) || seen.size > RICH_FACT_MAX_LINEAGE_DEPTH) return fault("invalid_lineage");
      seen.add(current.executionId);
      if (current.parentExecutionId !== null && seen.size > RICH_FACT_MAX_LINEAGE_DEPTH) return fault("invalid_lineage");
      const parent: RichOwner | undefined = current.parentExecutionId === null ? undefined : owners.get(current.parentExecutionId);
      if (parent && (parent.provider !== owned.provider || parent.accountId !== owned.accountId || parent.conversationId !== owned.conversationId)) return fault("conflicting_owner");
      current = parent;
    }
  }
  for (const key of retries.keys()) {
    const seen = new Set<string>();
    let current: string | null | undefined = key;
    while (current !== null && current !== undefined) {
      if (seen.has(current) || seen.size > RICH_FACT_MAX_LINEAGE_DEPTH) return fault("invalid_lineage");
      seen.add(current);
      current = retries.get(current);
    }
  }
}
function errorCode(cause: unknown): RichFactError {
  return oneOf(cause, ["invalid_rich_facts", "body_limit", "record_limit", "conflicting_fact", "conflicting_owner", "invalid_lineage", "incompatible_source"]) ? cause as RichFactError : "invalid_rich_facts";
}

export function parseRichFactReport(input: unknown): Result<RichFactReport, RichFactError> {
  try {
    const root = fields(input, ["schemaVersion", "profile", "provenance", "window", "coverage", "facts"]);
    if (root.schemaVersion !== 1 || root.profile !== RICH_FACT_PROFILE) return fault();
    const source = provenance(root.provenance), retained = window(root.window), coverage = fields(root.coverage, RICH_FACT_KINDS);
    if (RICH_FACT_KINDS.some(kind => !oneOf(coverage[kind], ["unsupported", "partial", "complete"]))) return fault();
    const facts = array(root.facts).map(input => {
      const row = fields(input, ["id", "revision", "provenance", "owner", "kind", "atMs", "value"]);
      if (!id(row.id) || !integer(row.revision, 0xffff_ffff) || !oneOf(row.kind, RICH_FACT_KINDS)
        || !integer(row.atMs, MAX_TIME) || row.atMs < retained.startMs || row.atMs >= retained.endMs) return fault();
      const p = provenance(row.provenance), o = owner(row.owner), kind = row.kind as RichFact["kind"];
      if (!same(p, source)) return fault("incompatible_source");
      if (coverage[kind] === "unsupported" && row.value !== null) return fault();
      return { ...row, provenance: p, owner: o, value: row.value === null ? null : value(row.value, kind, o, row.atMs) } as RichFact;
    });
    validateHeads(heads(facts));
    const report: RichFactReport = { schemaVersion: 1, profile: RICH_FACT_PROFILE, provenance: source, window: retained, coverage: coverage as RichFactReport["coverage"], facts };
    if (new TextEncoder().encode(JSON.stringify(report)).length > RICH_FACT_MAX_BYTES) return fault("body_limit");
    return ok(report);
  } catch (cause) { return err(errorCode(cause)); }
}
export function decodeRichFactReport(text: unknown): Result<RichFactReport, RichFactError> {
  if (typeof text !== "string") return err("invalid_rich_facts");
  if (text.length > RICH_FACT_MAX_BYTES || new TextEncoder().encode(text).length > RICH_FACT_MAX_BYTES) return err("body_limit");
  try { return parseRichFactReport(JSON.parse(text) as unknown); } catch { return err("invalid_rich_facts"); }
}

/** Merge only an identical source epoch/window. Cross-profile overlap needs an explicit join contract. */
export function mergeRichFactReports(leftInput: unknown, rightInput: unknown): Result<RichFactReport, RichFactError> {
  const left = parseRichFactReport(leftInput), right = parseRichFactReport(rightInput);
  if (!left.ok) return left;
  if (!right.ok) return right;
  if (!same(left.value.provenance, right.value.provenance) || !same(left.value.window, right.value.window) || !same(left.value.coverage, right.value.coverage)) return err("incompatible_source");
  const revisions = new Map<string, RichFact>();
  for (const fact of [...left.value.facts, ...right.value.facts]) {
    const key = `${fact.id}:${fact.revision}`, previous = revisions.get(key);
    if (previous && !same(previous, fact)) return err("conflicting_fact");
    revisions.set(key, fact);
  }
  return parseRichFactReport({ ...left.value, facts: [...revisions.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.revision - b.revision) });
}

/** Exact nearest-rank order statistics; each quantity gets its own measured denominator. */
function distribution(values: readonly (bigint | null)[]): RichDistribution {
  const measured = values.filter((v): v is bigint => v !== null).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const sum = measured.reduce((a, b) => a + b, 0n);
  const percentile = (n: number) => measured[Math.ceil(measured.length * n / 100) - 1] ?? null;
  return { measured: measured.length, unmeasured: values.length - measured.length, sum,
    observedMean: measured.length === 0 ? null : { numerator: sum, denominator: BigInt(measured.length) },
    minimum: measured[0] ?? null, median: percentile(50), p90: percentile(90), p95: percentile(95), p99: percentile(99), maximum: measured.at(-1) ?? null };
}
function selection(input: unknown, report: RichFactReport): RichSelection {
  const v = fields(input, ["window", "grain", "tokenScope", "lineage", "executionId"]), selected = window(v.window);
  if (selected.startMs < report.window.startMs || selected.endMs > report.window.endMs || !oneOf(v.grain, grains) || !oneOf(v.tokenScope, scopes)
    || !oneOf(v.lineage, [...lineages, "all"]) || (v.executionId !== null && !id(v.executionId))) return fault();
  return { ...v, window: selected } as RichSelection;
}

/** Inclusive totals need complete root paths proving the selected executions are disjoint. */
function tokenAggregation(all: readonly RichFact[], active: readonly RichFact[], selected: RichSelection): RichTokenAggregation {
  const executions = new Set(active.filter(fact => fact.value?.kind === "usage" && fact.value.grain === selected.grain && fact.value.tokenScope === selected.tokenScope)
    .map(fact => fact.owner.executionId));
  if (executions.size <= 1 || selected.tokenScope === "direct") return { eligible: true, reason: null };
  if (selected.tokenScope === "unknown") return { eligible: false, reason: "unknown_token_scope" };
  // Retained owner evidence remains useful even outside the selected time/lineage cohort.
  const owners = new Map(all.map(fact => [fact.owner.executionId, fact.owner]));
  let incomplete = false;
  for (const executionId of executions) {
    let current = owners.get(executionId)!;
    // Report admission has already ruled out cycles and paths longer than 64 edges.
    while (current.lineage !== "root") {
      if (current.lineage === "unknown" || current.parentExecutionId === null) { incomplete = true; break; }
      if (executions.has(current.parentExecutionId)) return { eligible: false, reason: "overlapping_executions" };
      const parent = owners.get(current.parentExecutionId);
      if (!parent) { incomplete = true; break; }
      current = parent;
    }
  }
  return incomplete ? { eligible: false, reason: "incomplete_lineage" } : { eligible: true, reason: null };
}

export function summarizeRichFacts(input: unknown, selectedInput: unknown) {
  const parsed = parseRichFactReport(input);
  if (!parsed.ok) return parsed;
  try {
    const report = parsed.value, selected = selection(selectedInput, report);
    const all = heads(report.facts);
    const current = all.filter(fact => fact.atMs >= selected.window.startMs && fact.atMs < selected.window.endMs
      && (selected.executionId === null || fact.owner.executionId === selected.executionId));
    const active = current.filter(fact => fact.value !== null && (selected.lineage === "all" || fact.owner.lineage === selected.lineage));
    const aggregation = tokenAggregation(all, active, selected);
    const values = active.map(fact => fact.value!);
    const usageCohort = new Map<string, RichUsage | null>();
    for (const fact of active) {
      const v = fact.value!;
      const identity = `${fact.owner.executionId}:${v.kind === "usage" && v.grain === "session" ? fact.owner.executionId : v.observationId}`;
      if (v.kind === "usage" && v.grain === selected.grain) {
        if (!usageCohort.has(identity)) usageCohort.set(identity, null);
        if (v.tokenScope === selected.tokenScope) usageCohort.set(identity, v);
      } else if ((selected.grain === "turn" && v.kind === "turn") || (selected.grain === "request" && v.kind === "request")) {
        if (!usageCohort.has(identity)) usageCohort.set(identity, null);
      }
    }
    const usages = [...usageCohort.values()];
    const requests = values.filter(v => v.kind === "request"), turns = values.filter(v => v.kind === "turn"), tools = values.filter(v => v.kind === "tool");
    const spans = values.filter(v => v.kind === "span"), contexts = values.filter(v => v.kind === "context"), compactions = values.filter(v => v.kind === "compaction");
    const duration = (start: number | null, end: number | null, uncertain: number | null) => start !== null && end !== null && uncertain === 0 ? BigInt(end - start) : null;
    const states = (items: readonly ({ stage: string; outcome: string })[]) => ({
      requested: items.filter(v => v.stage === "requested").length,
      dispatched: items.filter(v => v.stage === "dispatched").length,
      terminal: items.filter(v => v.stage === "terminal").length,
      success: items.filter(v => v.outcome === "success").length,
      error: items.filter(v => v.outcome === "error").length,
      refusal: items.filter(v => v.outcome === "refusal").length,
      cancel: items.filter(v => v.outcome === "cancel").length,
      timeout: items.filter(v => v.outcome === "timeout").length,
      unknownOutcome: items.filter(v => v.outcome === "unknown").length,
    });
    return ok({
      profile: report.profile, provenance: report.provenance, selection: selected,
      observedOnly: true as const, sourceCoverage: report.coverage,
      retractedFacts: current.filter(fact => fact.value === null).length,
      excludedUnknownLineage: selected.lineage === "all" || selected.lineage === "unknown" ? 0 : current.filter(fact => fact.value !== null && fact.owner.lineage === "unknown").length,
      tokenAggregation: aggregation,
      tokens: aggregation.eligible ? {
        input: distribution(usages.map(v => v === null ? null : BigInt(v.tokens.inputUncached) + BigInt(v.tokens.cacheRead) + BigInt(v.tokens.cacheWrite5m) + BigInt(v.tokens.cacheWrite1h) + BigInt(v.tokens.cacheWriteUnknown))),
        output: distribution(usages.map(v => v === null ? null : BigInt(v.tokens.output))),
        total: distribution(usages.map(v => v === null ? null : tokenFields.reduce((sum, field) => sum + BigInt(v.tokens[field]), 0n))),
        reasoning: distribution(usages.map(v => v === null || v.tokens.reasoning === null ? null : BigInt(v.tokens.reasoning))),
        cacheWriteUnknown: distribution(usages.map(v => v === null ? null : BigInt(v.tokens.cacheWriteUnknown))),
      } : null,
      requests: { ...states(requests), retries: requests.filter(v => v.retryOf !== null).length,
        latencyMs: distribution(requests.map(v => duration(v.dispatchedAtMs, v.terminalAtMs, v.clockUncertaintyMs))),
        firstTokenMs: distribution(requests.map(v => duration(v.dispatchedAtMs, v.firstTokenAtMs, v.clockUncertaintyMs))),
        generationMs: distribution(requests.map(v => duration(v.firstTokenAtMs, v.lastTokenAtMs, v.clockUncertaintyMs))),
      },
      turns: { completed: turns.filter(v => v.outcome === "completed").length, aborted: turns.filter(v => v.outcome === "aborted").length,
        unknownOrigin: turns.filter(v => v.origin === "unknown").length,
        runtimeMs: distribution(turns.map(v => duration(v.startedAtMs, v.endedAtMs, v.clockUncertaintyMs))),
        completedRuntimeMs: distribution(turns.filter(v => v.outcome === "completed").map(v => duration(v.startedAtMs, v.endedAtMs, v.clockUncertaintyMs))),
        completedToolCalls: distribution(turns.filter(v => v.outcome === "completed").map(v => v.toolCalls === null ? null : BigInt(v.toolCalls))),
      },
      tools: states(tools),
      spans: Object.fromEntries(Object.keys(timingBasis).map(phase => [phase, distribution(spans.filter(v => v.phase === phase).map(v => duration(v.startMs, v.endMs, v.clockUncertaintyMs)))])),
      context: { tokens: distribution(contexts.map(v => BigInt(v.tokens))), limits: distribution(contexts.map(v => v.limitTokens === null ? null : BigInt(v.limitTokens))) },
      compactions: { applied: compactions.filter(v => v.outcome === "applied").length, planned: compactions.filter(v => v.outcome === "planned").length,
        failed: compactions.filter(v => v.outcome === "failed").length, skipped: compactions.filter(v => v.outcome === "skipped").length,
        beforeTokens: distribution(compactions.filter(v => v.outcome === "applied").map(v => BigInt(v.beforeTokens))),
        afterTokens: distribution(compactions.filter(v => v.outcome === "applied").map(v => BigInt(v.afterTokens))),
        estimatedReclaimedTokens: distribution(compactions.filter(v => v.outcome === "applied").map(v => { const difference = BigInt(v.beforeTokens) - BigInt(v.afterTokens); return difference > 0n ? difference : 0n; })),
        appliedDurationMs: distribution(compactions.filter(v => v.outcome === "applied").map(v => BigInt(v.durationMs))),
      },
    });
  } catch (cause) { return err(errorCode(cause)); }
}
