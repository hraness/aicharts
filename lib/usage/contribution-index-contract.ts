import { contributionCellKey, type ContributionCell } from "./contribution-rollups";

/** Shared page vocabulary has no storage or platform-crypto dependency. */
export const CONTRIBUTION_INDEX_MAX_PAGE_CELLS = 256;
export const CONTRIBUTION_INDEX_MAX_KEY_BYTES = 512;
export function contributionIndexKey(cell: ContributionCell): string {
  return `${String(cell.dimensions.utcDay).padStart(8, "0")}:${contributionCellKey(cell.dimensions)}`;
}
