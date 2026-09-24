import { expect, test } from "bun:test";
import { readCloudBaselineCorpus, runCloudBaseline } from "../../../../scripts/assurance-cloud-baseline";

const sourceRoot = process.env.AICHARTS_CLOUD_BASELINE_SOURCE_ROOT;
const sourceBundle = process.env.AICHARTS_CLOUD_BASELINE_SOURCE_BUNDLE;
if (Boolean(sourceRoot) === Boolean(sourceBundle)) throw new Error("Select exactly one AICHARTS_CLOUD_BASELINE_SOURCE_ROOT or AICHARTS_CLOUD_BASELINE_SOURCE_BUNDLE for explicit historical replay.");

test("the governed cloud corpus reproduces seven failures without claiming production assurance", async () => {
  const result = await runCloudBaseline({ sourceRoot, sourceBundle });
  expect(result.expectedCounterexamplesMatched).toBe(true);
  expect(result.productionInvariantStatus).toBe("known-failures");
  expect(result.findings.map(finding => finding.id)).toEqual(["F02", "F09", "F10", "F11", "F12", "F15", "F16"]);
  expect(result.findings.every(finding => !finding.actual.invariantHolds)).toBe(true);
});

test("changing the synthetic cache population invalidates its historical expectation", async () => {
  const corpus = await readCloudBaselineCorpus();
  if (corpus.inputs.metricRow === null || typeof corpus.inputs.metricRow !== "object" || !("tokens" in corpus.inputs.metricRow)) throw new Error("missing_metric_fixture");
  const row = corpus.inputs.metricRow;
  corpus.inputs.metricRow = { ...row, tokens: { input: "900", cacheRead: "100", cacheWrite: "0", output: "0", reasoning: "0" } };
  const result = await runCloudBaseline({ corpus, sourceRoot, sourceBundle });
  const finding = result.findings.find(finding => finding.id === "F15")!;
  expect(finding.actual.invariantHolds).toBe(true);
  expect(finding.baselineMatched).toBe(false);
  expect(result.expectedCounterexamplesMatched).toBe(false);
});

test("source fingerprint drift is rejected before the baseline is attributed", async () => {
  const corpus = await readCloudBaselineCorpus();
  corpus.sourceSha256["services/usage-worker/src/stats-state.ts"] = "0".repeat(64);
  await expect(runCloudBaseline({ corpus, sourceRoot, sourceBundle })).rejects.toThrow("baseline_source_fingerprint_mismatch:services/usage-worker/src/stats-state.ts");
});
