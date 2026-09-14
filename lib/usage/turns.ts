import { err, ok, type Result } from "../result";
import { DAY_MS, MAX_TOKEN_COUNT, type Id, type Origin, type Provider } from "./wire";

export const MAX_TURN_RECORDS = 65_536;
export const MAX_TURN_RUNTIME_MS = 31 * DAY_MS;
export const MAX_TURN_TOOL_CALLS = 1_000_000;
const MAX_EPOCH_MS = 8_640_000_000_000_000;
const tokenKeys = ["inputUncached", "cacheRead", "cacheWrite5m", "cacheWrite1h", "output"] as const;

/** Complete direct-turn categories only. Reasoning is already inside output. */
export type TurnTokens = Readonly<Record<typeof tokenKeys[number], bigint>>;
export type TerminalTurn = Readonly<{
  id: Id; executionId: Id; accountId: Id; provider: Provider; origin: Origin;
  lineage: 0 | 1 | 2; // Unknown, root, subagent. Unknown is not a root.
  outcome: 1 | 2; // Completed, aborted. EOF cannot produce either.
  endedAtMs: number; startedAtMs: number | null; clockUncertaintyMs: number | null;
  tokens: TurnTokens | null; toolCalls: number | null;
}>;
export type TurnOriginFilter = 0 | 1 | 2 | 3; // All, human, automation, unknown.
export type TurnDayInput = Readonly<{
  observations: readonly TerminalTurn[];
  /** Established independently for the exact selected provider/account scope. */
  terminalCoverageComplete: boolean;
  originFilter: TurnOriginFilter;
}>;
export type TurnAverage = Readonly<{ numerator: bigint; denominatorTurns: number }>;
export type TurnMetric = Readonly<{
  sum: bigint; measuredTurns: number; unmeasuredTurns: number;
  observedAverage: TurnAverage | null; average: TurnAverage | null;
}>;
export type TurnDayRollup = Readonly<{
  utcDay: number; available: boolean; scope: "root_direct"; originFilter: TurnOriginFilter;
  terminalCoverageComplete: boolean;
  observedCompletedTurns: number; completedTurns: number | null;
  observedAbortedTurns: number; unclassifiedCompletedTurns: number;
  runtimeMs: TurnMetric; accountedTokens: TurnMetric; toolCalls: TurnMetric;
}>;
export type TurnError = "invalid_turn_day" | "invalid_turn_input" | "conflicting_turn";

/** Read data descriptors, never evaluate input accessors or admit extra content. */
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length) return null;
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    output[key] = descriptor.value;
  }
  return output;
}

function integer(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value <= maximum;
}

function identity(value: unknown, allowZero: boolean): Id | null {
  if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype) return null;
  const prototype = Object.getPrototypeOf(Uint8Array.prototype);
  if (Object.getOwnPropertyDescriptor(prototype, "length")!.get!.call(value) !== 16) return null;
  const buffer = Object.getOwnPropertyDescriptor(prototype, "buffer")!.get!.call(value);
  if (!(buffer instanceof ArrayBuffer) || Reflect.ownKeys(value).length !== 16) return null;
  const copy = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !integer(descriptor.value, 255)) return null;
    copy[index] = descriptor.value;
  }
  return allowZero || copy.some(byte => byte !== 0) ? copy : null;
}

function snapshotTurn(value: unknown, utcDay: number): TerminalTurn | null {
  const record = fields(value, ["id", "executionId", "accountId", "provider", "origin", "lineage", "outcome", "endedAtMs", "startedAtMs", "clockUncertaintyMs", "tokens", "toolCalls"]);
  if (!record) return null;
  const id = identity(record.id, false), executionId = identity(record.executionId, false), accountId = identity(record.accountId, true);
  if (!id || !executionId || !accountId || (record.provider !== 1 && record.provider !== 2)) return null;
  if (!integer(record.origin, 2) || !integer(record.lineage, 2) || (record.outcome !== 1 && record.outcome !== 2)) return null;
  if (!integer(record.endedAtMs, MAX_EPOCH_MS) || Math.floor(record.endedAtMs / DAY_MS) !== utcDay) return null;
  if (record.startedAtMs !== null && (!integer(record.startedAtMs, record.endedAtMs) || record.endedAtMs - record.startedAtMs > MAX_TURN_RUNTIME_MS)) return null;
  if (record.startedAtMs === null ? record.clockUncertaintyMs !== null : record.clockUncertaintyMs !== null && !integer(record.clockUncertaintyMs, 60_000)) return null;
  if (record.toolCalls !== null && !integer(record.toolCalls, MAX_TURN_TOOL_CALLS)) return null;
  let tokens: TurnTokens | null = null;
  if (record.tokens !== null) {
    const candidate = fields(record.tokens, tokenKeys);
    if (!candidate || tokenKeys.some(key => typeof candidate[key] !== "bigint" || (candidate[key] as bigint) < 0n || (candidate[key] as bigint) > MAX_TOKEN_COUNT)) return null;
    if (record.provider === 1 && (candidate.cacheWrite5m !== 0n || candidate.cacheWrite1h !== 0n)) return null;
    tokens = candidate as TurnTokens;
  }
  return { ...record, id, executionId, accountId, tokens } as TerminalTurn;
}

const idKey = (value: Id): string => Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("");
function sameTurn(left: TerminalTurn, right: TerminalTurn): boolean {
  return idKey(left.executionId) === idKey(right.executionId) && idKey(left.accountId) === idKey(right.accountId)
    && left.provider === right.provider && left.origin === right.origin && left.lineage === right.lineage && left.outcome === right.outcome
    && left.endedAtMs === right.endedAtMs && left.startedAtMs === right.startedAtMs && left.clockUncertaintyMs === right.clockUncertaintyMs
    && left.toolCalls === right.toolCalls && (left.tokens === null || right.tokens === null ? left.tokens === right.tokens : tokenKeys.every(key => left.tokens![key] === right.tokens![key]));
}

type Sum = { sum: bigint; measuredTurns: number };
function metric(value: Sum, completed: number, enumerated: boolean): TurnMetric {
  const observedAverage = value.measuredTurns === 0 ? null : { numerator: value.sum, denominatorTurns: value.measuredTurns };
  return {
    ...value, unmeasuredTurns: completed - value.measuredTurns, observedAverage,
    average: enumerated && value.measuredTurns === completed ? observedAverage : null,
  };
}

/**
 * Current terminal heads only, not a correction resolver or a wire decoder.
 * Callers must establish lifecycle, root identity and complete direct attribution.
 * Omitted input means unsupported; an empty set alone does not prove an idle day.
 */
export function rollupTurnDay(utcDay: number, input?: unknown): Result<TurnDayRollup, TurnError> {
  // Preserve the enclosing AICU u32 day domain, including unsupported/empty days.
  if (!integer(utcDay, 0xffff_ffff)) return err("invalid_turn_day");
  try {
    const available = input !== undefined;
    const candidate = input === undefined
      ? { observations: [], terminalCoverageComplete: false, originFilter: 0 }
      : fields(input, ["observations", "terminalCoverageComplete", "originFilter"]);
    if (!candidate || typeof candidate.terminalCoverageComplete !== "boolean" || !integer(candidate.originFilter, 3)) return err("invalid_turn_input");
    const observations = candidate.observations;
    if (!Array.isArray(observations) || Object.getPrototypeOf(observations) !== Array.prototype) return err("invalid_turn_input");
    const length = Object.getOwnPropertyDescriptor(observations, "length")?.value;
    if (!integer(length, MAX_TURN_RECORDS) || Reflect.ownKeys(observations).length !== length + 1) return err("invalid_turn_input");
    const turns = new Map<string, TerminalTurn>();
    const executions = new Map<string, { provider: Provider; account: string; lineage: number }>();
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(observations, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return err("invalid_turn_input");
      const turn = snapshotTurn(descriptor.value, utcDay);
      if (!turn) return err("invalid_turn_input");
      const key = idKey(turn.id), previous = turns.get(key);
      if (previous && !sameTurn(previous, turn)) return err("conflicting_turn");
      const execution = idKey(turn.executionId), account = idKey(turn.accountId), previousExecution = executions.get(execution);
      if (previousExecution && (previousExecution.provider !== turn.provider || previousExecution.account !== account || previousExecution.lineage !== turn.lineage)) return err("conflicting_turn");
      executions.set(execution, { provider: turn.provider, account, lineage: turn.lineage });
      turns.set(key, turn);
    }
    const originFilter = candidate.originFilter as TurnOriginFilter;
    const runtime: Sum = { sum: 0n, measuredTurns: 0 }, tokens: Sum = { sum: 0n, measuredTurns: 0 }, tools: Sum = { sum: 0n, measuredTurns: 0 };
    let completed = 0, aborted = 0, unclassified = 0;
    for (const turn of turns.values()) {
      const matches = originFilter === 0 || turn.origin === (originFilter === 3 ? 0 : originFilter);
      const possibleOrigin = matches || (turn.origin === 0 && (originFilter === 1 || originFilter === 2));
      if (turn.outcome === 1 && turn.lineage !== 2 && possibleOrigin && (turn.lineage === 0 || !matches)) unclassified += 1;
      if (turn.lineage !== 1 || !matches) continue;
      if (turn.outcome === 2) { aborted += 1; continue; }
      completed += 1;
      if (turn.startedAtMs !== null && turn.clockUncertaintyMs === 0) {
        runtime.sum += BigInt(turn.endedAtMs - turn.startedAtMs); runtime.measuredTurns += 1;
      }
      if (turn.tokens !== null) {
        tokens.sum += tokenKeys.reduce((sum, key) => sum + turn.tokens![key], 0n); tokens.measuredTurns += 1;
      }
      if (turn.toolCalls !== null) { tools.sum += BigInt(turn.toolCalls); tools.measuredTurns += 1; }
    }
    const enumerated = candidate.terminalCoverageComplete && unclassified === 0;
    return ok({
      utcDay, available, scope: "root_direct", originFilter, terminalCoverageComplete: candidate.terminalCoverageComplete,
      observedCompletedTurns: completed, completedTurns: enumerated ? completed : null,
      observedAbortedTurns: aborted, unclassifiedCompletedTurns: unclassified,
      runtimeMs: metric(runtime, completed, enumerated), accountedTokens: metric(tokens, completed, enumerated), toolCalls: metric(tools, completed, enumerated),
    });
  } catch {
    return err("invalid_turn_input");
  }
}
