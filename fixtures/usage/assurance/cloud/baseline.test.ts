import { expect, test } from "bun:test";
import { readCloudBaselineCorpus } from "../../../../scripts/assurance-cloud-baseline";

test("the checked historical corpus is bounded, source-attributed and explicitly expects failures", async () => {
  const corpus = await readCloudBaselineCorpus();
  expect(Object.keys(corpus.findings)).toEqual(["F02", "F09", "F10", "F11", "F12", "F15", "F16"]);
  expect(Object.values(corpus.findings).every(finding => finding.expected.invariantHolds === false)).toBe(true);
  expect(corpus.claim).toContain("no production invariant");
  expect(Object.keys(corpus.sourceSha256)).toContain("tsconfig.json");
  // No current production module is imported or required to retain a failure.
  // Historical execution and negative controls live in explicit .check.ts.
});
