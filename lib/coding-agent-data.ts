import type { Result } from "./result";
import { parseResult, z } from "./schema";

const nullableScoreSchema = z.number().finite().min(0).max(100).nullable();
const nullablePositiveSchema = z.number().finite().nonnegative().nullable();

export const codingAgentRecordSchema = z.object({
  id: z.string().min(1),
  agent: z.string().min(1),
  model: z.string().min(1),
  modelLabel: z.string().min(1),
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  seriesId: z.string().min(1),
  seriesLabel: z.string().min(1),
  setting: z.string().min(1),
  settingRank: z.number().int().nonnegative(),
  completeIndex: z.boolean(),
  benchmarks: z.object({
    aaIndex: nullableScoreSchema,
    deepSwe: nullableScoreSchema,
    terminalBench: nullableScoreSchema,
    sweAtlas: nullableScoreSchema,
  }).strict(),
  economics: z.object({
    costUsd: nullablePositiveSchema,
    durationSeconds: nullablePositiveSchema,
  }).strict(),
  usage: z.object({
    totalTokens: nullablePositiveSchema,
  }).strict(),
}).strict();

export const codingAgentSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    name: z.literal("Artificial Analysis"),
    url: z.string().url(),
    retrievedAt: z.string().datetime({ offset: true }),
    method: z.literal("next-flight"),
  }).strict(),
  records: z.array(codingAgentRecordSchema).min(1),
}).strict();

export type CodingAgentRecord = z.infer<typeof codingAgentRecordSchema>;
export type CodingAgentSnapshot = z.infer<typeof codingAgentSnapshotSchema>;

export function codingAgentRecordKey(record: Pick<CodingAgentRecord, "seriesId" | "setting">): string {
  return JSON.stringify([record.seriesId, record.setting]);
}

export function parseCodingAgentSnapshot(value: unknown): Result<CodingAgentSnapshot, z.ZodError> {
  return parseResult(codingAgentSnapshotSchema, value);
}
