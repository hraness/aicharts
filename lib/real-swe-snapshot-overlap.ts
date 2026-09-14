import type { CodingAgentRecord } from "./coding-agent-data";

/**
 * Real-SWE names each configuration as a model and its native harness. The
 * checked Artificial Analysis snapshot names the same harnesses slightly
 * differently, so the alias table is the only place a Real-SWE harness is
 * translated into a snapshot agent name. A harness without an alias can never
 * match a snapshot row.
 */
export const REAL_SWE_HARNESS_TO_SNAPSHOT_AGENT = {
  "Claude Code": "Claude Code",
  "Codex CLI": "Codex",
  "Gemini CLI": "Gemini CLI",
  "Grok Build": "Grok Build",
  "Kimi Code": "Kimi Code CLI",
  "Muse Code": "Muse Code",
} as const satisfies Record<string, string>;

export type RealSweHarness = keyof typeof REAL_SWE_HARNESS_TO_SNAPSHOT_AGENT;

export type RealSweConfiguration = Readonly<{
  harness: RealSweHarness;
  model: string;
}>;

export type RealSweSnapshotOverlap<Configuration extends RealSweConfiguration> = Readonly<{
  configuration: Configuration;
  record: CodingAgentRecord | undefined;
}>;

/**
 * Lowercases a model name and drops every character other than ASCII letters
 * and digits, so `GLM 5.3`, `GLM-5.3`, and `glm 5.3` compare equal.
 */
export function normalizeModelName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

/**
 * A snapshot model matches a Real-SWE model when the normalized names are
 * equal, or when the snapshot name continues with a non-digit qualifier such
 * as `Fable 5.1 (with fallback)`. A digit continuation such as `Kimi K3.5`
 * against `Kimi K3` is a different model and never matches.
 */
export function snapshotModelMatches(snapshotModel: string, realSweModel: string): boolean {
  const target = normalizeModelName(realSweModel);
  if (target.length === 0) return false;
  const candidate = normalizeModelName(snapshotModel);
  if (!candidate.startsWith(target)) return false;
  const next = candidate.charAt(target.length);
  return next === "" || !/[0-9]/u.test(next);
}

export function snapshotAgentForHarness(harness: RealSweHarness): string {
  return REAL_SWE_HARNESS_TO_SNAPSHOT_AGENT[harness];
}

function compareByHighestSetting(left: CodingAgentRecord, right: CodingAgentRecord): number {
  return right.settingRank - left.settingRank || left.id.localeCompare(right.id);
}

/**
 * Returns the checked snapshot rows whose harness and model names match a
 * Real-SWE configuration, highest stored effort setting first. Real-SWE does
 * not publish effort settings, so a match is a name overlap, not the same run.
 */
export function matchingSnapshotRecords(
  configuration: RealSweConfiguration,
  records: readonly CodingAgentRecord[],
): CodingAgentRecord[] {
  const agent = snapshotAgentForHarness(configuration.harness);
  return records
    .filter(record => (
      record.agent === agent && snapshotModelMatches(record.model, configuration.model)
    ))
    .sort(compareByHighestSetting);
}

export function realSweSnapshotOverlaps<Configuration extends RealSweConfiguration>(
  configurations: readonly Configuration[],
  records: readonly CodingAgentRecord[],
): RealSweSnapshotOverlap<Configuration>[] {
  return configurations.map(configuration => ({
    configuration,
    record: matchingSnapshotRecords(configuration, records)[0],
  }));
}
