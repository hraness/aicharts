import { expect, test } from "bun:test";
import { ConformanceTrace, scheduleShuffle } from "./contracts";

test("conformance evidence retains each pre-mutation model snapshot", () => {
  const trace = new ConformanceTrace("receipt-fixture", 7), model = { revision: 1, rows: [10] }, actual = structuredClone(model);
  trace.compare("commit", { operation: "A" }, "ok", "ok", actual, model);
  model.revision = 2; model.rows.push(20); actual.rows[0] = 999;
  expect(trace.steps[0].expected).toEqual({ revision: 1, rows: [10] });
  expect(trace.steps[0].actual).toEqual({ revision: 1, rows: [10] });
});

test("semantic mismatches and missing action coverage cannot emit success evidence", () => {
  const trace = new ConformanceTrace("receipt-fixture", 7);
  expect(() => trace.compare("publish", {}, "ok", "recovery_required", { epoch: 1 }, { epoch: 0 }))
    .toThrow("CONFORMANCE:receipt-fixture:publish:outcome");
  expect(() => trace.compare("commit", {}, "ok", "ok", { revision: 2 }, { revision: 1 }))
    .toThrow("CONFORMANCE:receipt-fixture:commit:state");
  expect(trace.steps).toEqual([]);
  expect(() => trace.finish(["publish:recovery_required"])).toThrow("missing-coverage");
});

test("retained seed shuffling is deterministic and preserves every command", () => {
  const commands = ["A", "B", "A", "C"];
  expect(scheduleShuffle(0x20260923, commands)).toEqual(scheduleShuffle(0x20260923, commands));
  expect(scheduleShuffle(0x20260923, commands).sort()).toEqual([...commands].sort());
  expect(commands).toEqual(["A", "B", "A", "C"]);
});
