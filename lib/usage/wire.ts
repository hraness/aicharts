import { err, isRecord, ok, type Result } from "../result";

export const DAY_MS = 86_400_000;
export const MAX_RECORDS = 4_096;
export const MAX_PACKET_BYTES = 884_760;
export const MAX_TOKEN_COUNT = 1_000_000_000_000n;
export type Provider = 1 | 2;
export type AuthMode = 0 | 1 | 2;
export type Evidence = 1 | 2;
export type Origin = 0 | 1 | 2;
export type IntervalKind = 1 | 2;
export type Id = Uint8Array;

export type Tokens = Readonly<{
  inputUncached: bigint;
  cacheRead: bigint;
  cacheWrite5m: bigint;
  cacheWrite1h: bigint;
  output: bigint;
  reasoningOutput: bigint;
}>;
export type Usage = Readonly<{
  id: Id; executionId: Id; accountId: Id; offsetMs: number;
  provider: Provider; authMode: AuthMode; evidence: Evidence;
  modelId: number; contextTier: 0; tokens: Tokens;
}>;
export type Prompt = Readonly<{
  id: Id; executionId: Id; accountId: Id; offsetMs: number;
  provider: Provider; origin: Origin; evidence: Evidence;
}>;
export type Interval = Readonly<{
  executionId: Id; accountId: Id; startMs: number; endMs: number;
  provider: Provider; kind: IntervalKind; evidence: Evidence;
  clockUncertaintyMs: number;
}>;
export type Batch = Readonly<{
  utcDay: number; registryRevision: number;
  usage: readonly Usage[]; prompts: readonly Prompt[]; intervals: readonly Interval[];
}>;
export type Registry = Readonly<{ revision: number; models: readonly (readonly [Provider, number])[] }>;
export type Policy = Readonly<{ firstDay: number; lastDay: number; registry: Registry }>;
export type WireError =
  | "invalid_policy" | "invalid_header" | "unsupported_version" | "reserved_nonzero"
  | "invalid_count" | "invalid_size" | "invalid_day" | "registry_mismatch"
  | "invalid_record" | "invalid_id" | "invalid_enum" | "invalid_offset"
  | "invalid_tokens" | "unknown_model" | "invalid_order" | "invalid_context_tier";

const tokenKeys = ["inputUncached", "cacheRead", "cacheWrite5m", "cacheWrite1h", "output", "reasoningOutput"] as const;
const u32 = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
const provider = (value: unknown): value is Provider => value === 1 || value === 2;
const evidence = (value: unknown): value is Evidence => value === 1 || value === 2;
const threeWay = (value: unknown): value is 0 | 1 | 2 => value === 0 || value === 1 || value === 2;
const id = (value: unknown): value is Id => value instanceof Uint8Array && value.length === 16;
const nonzero = (value: Id): boolean => value.some(byte => byte !== 0);
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function compareIds(left: Id, right: Id): number {
  for (let index = 0; index < 16; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

export function compareIntervals(left: Interval, right: Interval): number {
  return compareIds(left.executionId, right.executionId) || left.kind - right.kind
    || left.startMs - right.startMs || left.endMs - right.endMs
    || compareIds(left.accountId, right.accountId) || left.provider - right.provider;
}

export function validatePolicy(value: unknown): value is Policy {
  if (!isRecord(value) || !u32(value.firstDay) || !u32(value.lastDay) || value.firstDay > value.lastDay) return false;
  if (!isRecord(value.registry) || !u32(value.registry.revision) || !Array.isArray(value.registry.models)) return false;
  const seen = new Set<string>();
  for (const entry of value.registry.models) {
    if (!Array.isArray(entry) || entry.length !== 2 || !provider(entry[0]) || !u32(entry[1])) return false;
    const key = `${entry[0]}:${entry[1]}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** Reasoning is a subset of output, not another billable token category. */
export function totalTokens(value: unknown): Result<bigint, WireError> {
  if (!isRecord(value) || !exact(value, tokenKeys)) return err("invalid_tokens");
  for (const key of tokenKeys) {
    if (typeof value[key] !== "bigint" || value[key] < 0n || value[key] > MAX_TOKEN_COUNT) return err("invalid_tokens");
  }
  const tokens = value as Tokens;
  if (tokens.reasoningOutput > tokens.output) return err("invalid_tokens");
  return ok(tokens.inputUncached + tokens.cacheRead + tokens.cacheWrite5m + tokens.cacheWrite1h + tokens.output);
}

function validCommon(value: Record<string, unknown>): WireError | null {
  if (!id(value.executionId) || !id(value.accountId)) return "invalid_id";
  if (!provider(value.provider) || !evidence(value.evidence)) return "invalid_enum";
  return null;
}

export function validateUsageBatch(value: unknown, policy: Policy): Result<Batch, WireError> {
  if (!validatePolicy(policy)) return err("invalid_policy");
  if (!isRecord(value) || !exact(value, ["utcDay", "registryRevision", "usage", "prompts", "intervals"])) return err("invalid_record");
  if (!u32(value.utcDay) || value.utcDay < policy.firstDay || value.utcDay > policy.lastDay) return err("invalid_day");
  if (value.registryRevision !== policy.registry.revision) return err("registry_mismatch");
  if (!Array.isArray(value.usage) || !Array.isArray(value.prompts) || !Array.isArray(value.intervals)) return err("invalid_record");
  const families = [value.usage, value.prompts, value.intervals];
  if (families.some(family => family.length > MAX_RECORDS) || families.every(family => family.length === 0)) return err("invalid_count");
  const models = new Set(policy.registry.models.map(([source, model]) => `${source}:${model}`));
  let previous: Id | null = null;
  for (const usage of value.usage) {
    if (!isRecord(usage) || !exact(usage, ["id", "executionId", "accountId", "offsetMs", "provider", "authMode", "evidence", "modelId", "contextTier", "tokens"])) return err("invalid_record");
    const commonError = validCommon(usage);
    if (commonError) return err(commonError);
    if (!id(usage.id) || !nonzero(usage.id)) return err("invalid_id");
    if (previous && compareIds(previous, usage.id) >= 0) return err("invalid_order");
    previous = usage.id;
    if (!u32(usage.offsetMs) || usage.offsetMs >= DAY_MS) return err("invalid_offset");
    if (!threeWay(usage.authMode)) return err("invalid_enum");
    if (!u32(usage.modelId) || (usage.modelId !== 0 && !models.has(`${usage.provider}:${usage.modelId}`))) return err("unknown_model");
    if (usage.contextTier !== 0) return err("invalid_context_tier");
    const total = totalTokens(usage.tokens);
    if (!total.ok || total.value === 0n) return err("invalid_tokens");
    const tokens = usage.tokens as Tokens;
    if (usage.provider === 1 && (tokens.cacheWrite5m !== 0n || tokens.cacheWrite1h !== 0n)) return err("invalid_tokens");
  }
  previous = null;
  for (const prompt of value.prompts) {
    if (!isRecord(prompt) || !exact(prompt, ["id", "executionId", "accountId", "offsetMs", "provider", "origin", "evidence"])) return err("invalid_record");
    const commonError = validCommon(prompt);
    if (commonError) return err(commonError);
    if (!id(prompt.id) || !nonzero(prompt.id)) return err("invalid_id");
    if (previous && compareIds(previous, prompt.id) >= 0) return err("invalid_order");
    previous = prompt.id;
    if (!u32(prompt.offsetMs) || prompt.offsetMs >= DAY_MS) return err("invalid_offset");
    if (!threeWay(prompt.origin)) return err("invalid_enum");
  }
  let previousInterval: Interval | null = null;
  for (const interval of value.intervals) {
    if (!isRecord(interval) || !exact(interval, ["executionId", "accountId", "startMs", "endMs", "provider", "kind", "evidence", "clockUncertaintyMs"])) return err("invalid_record");
    const commonError = validCommon(interval);
    if (commonError) return err(commonError);
    if (!nonzero(interval.executionId as Id)) return err("invalid_id");
    if (!u32(interval.startMs) || !u32(interval.endMs) || interval.startMs >= interval.endMs || interval.endMs > DAY_MS) return err("invalid_offset");
    if (interval.kind !== 1 && interval.kind !== 2) return err("invalid_enum");
    if (!u32(interval.clockUncertaintyMs) || interval.clockUncertaintyMs > 60_000) return err("invalid_offset");
    const typed = interval as Interval;
    if (previousInterval && compareIntervals(previousInterval, typed) >= 0) return err("invalid_order");
    previousInterval = typed;
  }
  return ok(value as Batch);
}

export function encodeUsageBatch(value: unknown, policy: Policy): Result<Uint8Array, WireError> {
  const checked = validateUsageBatch(value, policy);
  if (!checked.ok) return checked;
  const batch = checked.value;
  const bytes = new Uint8Array(24 + batch.usage.length * 112 + batch.prompts.length * 56 + batch.intervals.length * 48);
  const view = new DataView(bytes.buffer);
  bytes.set([65, 73, 67, 85]);
  view.setUint16(4, 1, true);
  view.setUint32(8, batch.utcDay, true);
  view.setUint16(12, batch.usage.length, true);
  view.setUint16(14, batch.prompts.length, true);
  view.setUint16(16, batch.intervals.length, true);
  view.setUint32(20, batch.registryRevision, true);
  let offset = 24;
  for (const usage of batch.usage) {
    bytes.set(usage.id, offset); bytes.set(usage.executionId, offset + 16); bytes.set(usage.accountId, offset + 32);
    view.setUint32(offset + 48, usage.offsetMs, true);
    view.setUint8(offset + 52, usage.provider); view.setUint8(offset + 53, usage.authMode);
    view.setUint16(offset + 54, usage.evidence, true); view.setUint32(offset + 56, usage.modelId, true);
    view.setUint16(offset + 60, usage.contextTier, true);
    tokenKeys.forEach((key, index) => view.setBigUint64(offset + 64 + index * 8, usage.tokens[key], true));
    offset += 112;
  }
  for (const prompt of batch.prompts) {
    bytes.set(prompt.id, offset); bytes.set(prompt.executionId, offset + 16); bytes.set(prompt.accountId, offset + 32);
    view.setUint32(offset + 48, prompt.offsetMs, true);
    view.setUint8(offset + 52, prompt.provider); view.setUint8(offset + 53, prompt.origin);
    view.setUint16(offset + 54, prompt.evidence, true);
    offset += 56;
  }
  for (const interval of batch.intervals) {
    bytes.set(interval.executionId, offset); bytes.set(interval.accountId, offset + 16);
    view.setUint32(offset + 32, interval.startMs, true); view.setUint32(offset + 36, interval.endMs, true);
    view.setUint8(offset + 40, interval.provider); view.setUint8(offset + 41, interval.kind);
    view.setUint16(offset + 42, interval.evidence, true); view.setUint32(offset + 44, interval.clockUncertaintyMs, true);
    offset += 48;
  }
  return ok(bytes);
}

export function decodeUsageBatch(input: unknown, policy: Policy): Result<Batch, WireError> {
  if (!validatePolicy(policy)) return err("invalid_policy");
  if (!(input instanceof Uint8Array) || input.byteLength < 24 || input.byteLength > MAX_PACKET_BYTES) return err("invalid_size");
  if (input[0] !== 65 || input[1] !== 73 || input[2] !== 67 || input[3] !== 85) return err("invalid_header");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (view.getUint16(4, true) !== 1) return err("unsupported_version");
  if (view.getUint16(6, true) !== 0 || view.getUint16(18, true) !== 0) return err("reserved_nonzero");
  const usageCount = view.getUint16(12, true), promptCount = view.getUint16(14, true), intervalCount = view.getUint16(16, true);
  if ([usageCount, promptCount, intervalCount].some(count => count > MAX_RECORDS) || usageCount + promptCount + intervalCount === 0) return err("invalid_count");
  if (input.byteLength !== 24 + usageCount * 112 + promptCount * 56 + intervalCount * 48) return err("invalid_size");
  const utcDay = view.getUint32(8, true), registryRevision = view.getUint32(20, true);
  if (utcDay < policy.firstDay || utcDay > policy.lastDay) return err("invalid_day");
  if (registryRevision !== policy.registry.revision) return err("registry_mismatch");
  const usage: Usage[] = [], prompts: Prompt[] = [], intervals: Interval[] = [];
  let offset = 24;
  const readId = (relative: number) => Uint8Array.from(input.subarray(offset + relative, offset + relative + 16));
  for (let index = 0; index < usageCount; index += 1) {
    if (view.getUint16(offset + 62, true) !== 0) return err("reserved_nonzero");
    usage.push({
      id: readId(0), executionId: readId(16), accountId: readId(32), offsetMs: view.getUint32(offset + 48, true),
      provider: view.getUint8(offset + 52) as Provider, authMode: view.getUint8(offset + 53) as AuthMode,
      evidence: view.getUint16(offset + 54, true) as Evidence, modelId: view.getUint32(offset + 56, true),
      contextTier: view.getUint16(offset + 60, true) as 0,
      tokens: {
        inputUncached: view.getBigUint64(offset + 64, true), cacheRead: view.getBigUint64(offset + 72, true),
        cacheWrite5m: view.getBigUint64(offset + 80, true), cacheWrite1h: view.getBigUint64(offset + 88, true),
        output: view.getBigUint64(offset + 96, true), reasoningOutput: view.getBigUint64(offset + 104, true),
      },
    });
    offset += 112;
  }
  for (let index = 0; index < promptCount; index += 1) {
    prompts.push({
      id: readId(0), executionId: readId(16), accountId: readId(32), offsetMs: view.getUint32(offset + 48, true),
      provider: view.getUint8(offset + 52) as Provider, origin: view.getUint8(offset + 53) as Origin,
      evidence: view.getUint16(offset + 54, true) as Evidence,
    });
    offset += 56;
  }
  for (let index = 0; index < intervalCount; index += 1) {
    intervals.push({
      executionId: readId(0), accountId: readId(16), startMs: view.getUint32(offset + 32, true), endMs: view.getUint32(offset + 36, true),
      provider: view.getUint8(offset + 40) as Provider, kind: view.getUint8(offset + 41) as IntervalKind,
      evidence: view.getUint16(offset + 42, true) as Evidence, clockUncertaintyMs: view.getUint32(offset + 44, true),
    });
    offset += 48;
  }
  return validateUsageBatch({ utcDay, registryRevision, usage, prompts, intervals }, policy);
}
