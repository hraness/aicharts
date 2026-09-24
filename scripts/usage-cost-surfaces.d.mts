type UsageSurface = Readonly<{ id: string; owner: string; table: string | null; kind: string; retentionPolicy: string; rebuildFrom?: string | null }>;
type UsageCapacity = Readonly<{ id: string; value: number }>;
type UsageCost = Readonly<{ owner: string; kind: string; assurancePolicy?: string; source?: string;
  budget?: Readonly<{ capacityRefs?: Readonly<Record<string, number>> }> }>;
export function usageSqlSources(root: string): string[];
export function checkUsageCostSurfaces(sources: Readonly<Record<string, string>>, inventory: readonly UsageSurface[],
  capacities: readonly UsageCapacity[], costs: Readonly<Record<string, UsageCost>>): string[];
export function inspectUsageCostSurfaces(root: string, costs: Readonly<Record<string, UsageCost>>): string[];
