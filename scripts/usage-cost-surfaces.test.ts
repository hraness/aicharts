import { expect, test } from "bun:test";
import { checkUsageCostSurfaces } from "./usage-cost-surfaces.mjs";

const inventory = [{ id: "worker:heads", owner: "services/usage-worker/src/state.ts", table: "heads", kind: "authoritative", retentionPolicy: "canonical-account-history" },
  { id: "r2:bodies", owner: "services/usage-worker/src/objects.ts", table: null, kind: "authoritative", retentionPolicy: "canonical-account-history" }];
const capacities = [{ id: "max-heads", value: 100 }];
const costs = Object.fromEntries(inventory.map(row => [row.id, { owner: row.owner, kind: row.kind, assurancePolicy: row.retentionPolicy,
  budget: { capacityRefs: { "max-heads": 100 } } }]));
const sources = { "services/usage-worker/src/state.ts": "CREATE TABLE heads(id TEXT PRIMARY KEY)" };

test("owned SQL and immutable object families require matching cost/retention/capacity evidence", () => {
  expect(checkUsageCostSurfaces(sources, inventory, capacities, costs)).toEqual([]);
  expect(checkUsageCostSurfaces(sources, inventory, capacities, { "worker:heads": costs["worker:heads"] })).toContain("r2:bodies: cost/assurance surface ownership or retention drift");
  const changed = structuredClone(costs); changed["worker:heads"].budget.capacityRefs["max-heads"] = 99;
  expect(checkUsageCostSurfaces(sources, inventory, capacities, changed)).toContain("worker:heads: capacity drift for max-heads");
  changed["worker:heads"].assurancePolicy = "derived-projections";
  expect(checkUsageCostSurfaces(sources, inventory, capacities, changed)).toContain("worker:heads: cost/assurance surface ownership or retention drift");
});
test("a new declaration in a new source cannot hide behind an existing aggregate store entry", () => {
  const errors = checkUsageCostSurfaces({ ...sources, "services/usage-worker/src/new.ts": "CREATE TABLE IF NOT EXISTS forgotten (id INTEGER);" }, inventory, capacities, costs);
  expect(errors).toHaveLength(2);
  expect(errors.every((item: string) => item.includes("worker:forgotten"))).toBe(true);
});
test("a new object writer cannot hide behind an existing bucket registration", () => {
  const newWriter = { ...sources, "services/usage-worker/src/new-objects.ts": "return bucket.put(key, content);" };
  expect(checkUsageCostSurfaces(newWriter, inventory, capacities, costs))
    .toContain("services/usage-worker/src/new-objects.ts: object writer missing from assurance inventory");
  expect(checkUsageCostSurfaces({ ...sources, "services/usage-worker/src/objects.ts": "return bucket.put(key, content);" }, inventory, capacities, costs)).toEqual([]);
});
test("derived projections name the exact authoritative rebuild source and empty budgets refuse", () => {
  const entry = { ...inventory[0], kind: "derived", rebuildFrom: "committed journal" };
  expect(checkUsageCostSurfaces(sources, [entry], capacities, { "worker:heads": { ...costs["worker:heads"], kind: "derived", source: "object existence" } }))
    .toContain("worker:heads: rebuild source drift");
  expect(checkUsageCostSurfaces(sources, [inventory[0]], capacities, { "worker:heads": { ...costs["worker:heads"], budget: {} } }))
    .toContain("worker:heads: missing source-bound capacity references");
});
