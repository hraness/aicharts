import type { ArtificialAnalysisIntelligenceRecord } from "./artificial-analysis-intelligence-data";
import {
  closestCodingRowsBelow,
  componentContrasts,
  frontierDescent,
  type CodingRowBelow,
  type ComponentContrast,
} from "./claude-opus-5-5-placement";
import type { CodingAgentRecord } from "./coding-agent-data";
import { aaIndexCostFrontier } from "./coding-agent-snapshot-rows";
import { GPT_6_SOL_CODING_CONFIGURATION } from "./gpt-6-sol-placement";
import {
  codingAgentPlacement,
  codingAgentRecordsFor,
  competitionRank,
  intelligencePlacement,
  matchesCodingConfiguration,
  type CodingAgentPlacement,
  type CodingConfiguration,
  type CostedCodingAgentRecord,
  type IntelligencePlacement,
} from "./snapshot-placement";

/**
 * GPT-6.1 Sol bindings of the shared snapshot placement helpers. The coding
 * chart stores every Codex effort setting; the placed row is the highest
 * AA Index among those settings. The Intelligence Index binding is the
 * headline max row only, for a two-unit cost callout, never a pooled rank.
 */

export const GPT_6_1_SOL_CODING_CONFIGURATION = {
  agent: "Codex",
  model: "GPT-6.1 Sol",
  providerId: "openai",
} as const;

export const CLAUDE_SONNET_55_CODING_CONFIGURATION = {
  agent: "Claude Code",
  model: "Sonnet 5.5",
  providerId: "anthropic",
} as const;

export const CLAUDE_OPUS_55_CODING_CONFIGURATION = {
  agent: "Claude Code",
  model: "Opus 5.5",
  providerId: "anthropic",
} as const;

export const GPT_6_1_SOL_INTELLIGENCE_SLUG = "gpt-6-1-sol" as const;

export type Gpt61SolCodingAgentPlacement = CodingAgentPlacement & Readonly<{
  /** Highest-scoring other costed rows at or under the placed row’s AA Index, highest first. */
  closestBelow: readonly CodingRowBelow[];
  /** Gap from the placed row to the best other row on each AA Index component. */
  componentContrasts: readonly ComponentContrast[];
  /** Highest-scoring Claude Code · Sonnet 5.5 and Claude Code · Opus 5.5 rows, highest AA Index first. */
  contrastRows: readonly CostedCodingAgentRecord[];
  /** One-based rank by cost per task among costed rows; 1 is the costliest row. */
  costRank: number;
  /** Rows carrying an AA Index and a positive cost. */
  costedCount: number;
  /** Cost-frontier vertices with a lower AA Index than the placed row, highest AA Index first. */
  frontierBelow: readonly CodingRowBelow[];
  /** Highest-scoring Codex · GPT-6 Sol row, when the snapshot still stores one. */
  previousGeneration: CostedCodingAgentRecord | undefined;
  /** Codex · GPT-6.1 Sol settings that sit on the coding-agent cost frontier, setting order. */
  settingsOnFrontier: readonly CostedCodingAgentRecord[];
  /** Every Codex · GPT-6.1 Sol row with an index and a cost, cheapest setting first. */
  settings: readonly CostedCodingAgentRecord[];
}>;

export type Gpt61SolIntelligencePlacement = IntelligencePlacement;

function compareSettingRank(
  left: CostedCodingAgentRecord,
  right: CostedCodingAgentRecord,
): number {
  return left.settingRank - right.settingRank || left.id.localeCompare(right.id);
}

function highestCostedRow(
  records: readonly CodingAgentRecord[],
  configuration: CodingConfiguration,
): CostedCodingAgentRecord | undefined {
  return codingAgentRecordsFor(records, configuration)[0];
}

/** Every Codex · GPT-6.1 Sol row that carries an AA Index and a cost, highest AA Index first. */
export function gpt61SolCodingAgentRecords(
  records: readonly CodingAgentRecord[],
): readonly CostedCodingAgentRecord[] {
  return codingAgentRecordsFor(records, GPT_6_1_SOL_CODING_CONFIGURATION);
}

/** Codex · GPT-6.1 Sol rows in setting order, so an effort table can walk low to max. */
export function gpt61SolCodingSettings(
  records: readonly CodingAgentRecord[],
): readonly CostedCodingAgentRecord[] {
  return gpt61SolCodingAgentRecords(records).toSorted(compareSettingRank);
}

export function gpt61SolCodingAgentPlacement(
  records: readonly CodingAgentRecord[],
  pointWindow = 1,
): Gpt61SolCodingAgentPlacement | undefined {
  const placement = codingAgentPlacement(
    records,
    GPT_6_1_SOL_CODING_CONFIGURATION,
    GPT_6_SOL_CODING_CONFIGURATION,
    pointWindow,
  );
  if (placement === undefined) return undefined;
  const contrastRows = [
    highestCostedRow(records, CLAUDE_SONNET_55_CODING_CONFIGURATION),
    highestCostedRow(records, CLAUDE_OPUS_55_CODING_CONFIGURATION),
  ].flatMap(row => row === undefined ? [] : [row]);
  const settings = gpt61SolCodingSettings(records);
  const frontierIds = new Set(aaIndexCostFrontier(records).map(point => point.record.id));
  const costed = records.filter((record): record is CostedCodingAgentRecord => (
    record.benchmarks.aaIndex !== null
    && record.economics.costUsd !== null
    && record.economics.costUsd > 0
  ));
  return {
    ...placement,
    closestBelow: closestCodingRowsBelow(records, placement.record),
    componentContrasts: componentContrasts(records, placement.record),
    contrastRows,
    costRank: competitionRank(
      placement.record.economics.costUsd,
      costed.map(candidate => candidate.economics.costUsd),
    ),
    costedCount: costed.length,
    frontierBelow: frontierDescent(records, placement.record),
    previousGeneration: highestCostedRow(records, GPT_6_SOL_CODING_CONFIGURATION),
    settings,
    settingsOnFrontier: settings.filter(record => frontierIds.has(record.id)),
  };
}

/**
 * The Intelligence Index max row only. Notes that need a cost contrast call
 * this; they must not rank it with coding-agent scores.
 */
export function gpt61SolIntelligencePlacement(
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  pointWindow = 1,
): Gpt61SolIntelligencePlacement | undefined {
  return intelligencePlacement(records, GPT_6_1_SOL_INTELLIGENCE_SLUG, pointWindow);
}

export function matchesGpt61SolCoding(
  record: Pick<CodingAgentRecord, "agent" | "model" | "providerId">,
): boolean {
  return matchesCodingConfiguration(record, GPT_6_1_SOL_CODING_CONFIGURATION);
}
