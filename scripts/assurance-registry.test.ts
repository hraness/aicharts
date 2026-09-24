import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { checkAssuranceRegistry, numericConstant, repositoryReader, type RegistryReader } from "./assurance-registry";

const reader = repositoryReader(resolve(import.meta.dir, ".."));
function mutate(file: string, change: (original: string) => string): RegistryReader {
  return { ...reader, read: path => path === file ? change(reader.read(path)) : reader.read(path) };
}

describe("executable assurance inventory", () => {
  test("all catalog families, findings, source selectors and tables are accounted for", () => {
    const result = checkAssuranceRegistry(reader);
    expect(result.errors).toEqual([]);
    expect(result.counts).toMatchObject({ findings: 26, invariants: 16, metricFamilies: 17, clients: 55 });
    expect(result.counts.metrics).toBeGreaterThan(100);
    const findings = JSON.parse(reader.read("verify/assurance/obligations.json")).findings as { id: string; status: string }[];
    for (const finding of findings) {
      expect(result.gaps.some(gap => gap.startsWith(`${finding.id}:`))).toBe(finding.status === "open");
    }
  });
  test("cannot remove a finding, an invariant or an entire metric family", () => {
    const removed = checkAssuranceRegistry(mutate("verify/assurance/obligations.json", original => {
      const data = JSON.parse(original); data.findings.shift(); data.invariants.shift(); return JSON.stringify(data);
    }));
    expect(removed.errors).toContain("missing finding F01");
    expect(removed.errors).toContain("missing invariant S01");
    const family = checkAssuranceRegistry(mutate("verify/assurance/metrics.json", original => {
      const data = JSON.parse(original); const removed = data.metrics[0].family;
      data.metrics = data.metrics.filter((row: { family: string }) => row.family !== removed); return JSON.stringify(data);
    }));
    expect(family.errors).toContain("metrics: all 17 catalog families required");
  });
  test("a new owned SQL table requires a registered lifecycle", () => {
    const result = checkAssuranceRegistry(mutate("services/usage-worker/src/admission-schema.ts", original => `${original}\nCREATE TABLE unregistered_numeric_events (id INTEGER);`));
    expect(result.errors.some(error => error.includes("unregistered SQL table") && error.includes("unregistered_numeric_events"))).toBe(true);
  });
  test("runtime schema discovery includes nested Worker and new native modules but excludes test fixtures", () => {
    const root = mkdtempSync(resolve(tmpdir(), "aicharts-assurance-discovery-"));
    try {
      for (const path of ["services/usage-worker/src/nested/schema.ts", "services/usage-worker/src/nested/schema.test.ts", "crates/new-store/src/nested/store.rs", "crates/new-store/src/store_tests.rs"]) {
        const file = resolve(root, path); mkdirSync(resolve(file, ".."), { recursive: true }); writeFileSync(file, "");
      }
      expect(repositoryReader(root).sqlSources()).toEqual(["crates/new-store/src/nested/store.rs", "services/usage-worker/src/nested/schema.ts"]);
    } finally { rmSync(root, { recursive: true }); }
  });
  test("a conditional table declaration uses the same owner and discovery parser", () => {
    const result = checkAssuranceRegistry(mutate("services/usage-worker/src/admission-schema.ts", original => original.replaceAll("CREATE TABLE usage_admission_", "CREATE TABLE IF NOT EXISTS usage_admission_")));
    expect(result.errors).toEqual([]);
  });
  test("withdrawal and restore controls cannot inherit ordinary erasure retention", () => {
    const result = checkAssuranceRegistry(mutate("verify/assurance/surfaces.json", original => {
      const data = JSON.parse(original);
      data.surfaces.find((row: { id: string }) => row.id === "worker:leaderboard_index").retentionPolicy = "canonical-account-history";
      data.surfaces.find((row: { id: string }) => row.id === "worker:restore_fence").controlEvidence = false;
      return JSON.stringify(data);
    }));
    expect(result.errors).toContain("worker:leaderboard_index: authority controls require replay-safe retention");
    expect(result.errors).toContain("worker:restore_fence: known authority control cannot be unclassified");
    const removed = checkAssuranceRegistry(mutate("verify/assurance/surfaces.json", original => {
      const data = JSON.parse(original); data.surfaces = data.surfaces.filter((row: { id: string }) => row.id !== "r2:enrollment-namespace-anchors"); return JSON.stringify(data);
    }));
    expect(removed.errors).toContain("r2:enrollment-namespace-anchors: missing mandatory authority control");
  });
  test("a source or documentation link cannot qualify unexecuted metric acceptance cases", () => {
    let metricId = "";
    const result = checkAssuranceRegistry(mutate("verify/assurance/metrics.json", original => {
      const data = JSON.parse(original); data.metrics[0].status = "qualified"; metricId = data.metrics[0].id; return JSON.stringify(data);
    }));
    expect(result.errors).toContain(`${metricId}: qualification requires executed acceptance receipts`);
  });
  test("source capacity drift and vanished evidence refuse", () => {
    const drift = checkAssuranceRegistry(mutate("lib/usage/stats-contract.ts", source => source.replace("STATS_MAX_DAYS = 366", "STATS_MAX_DAYS = 367")));
    expect(drift.errors).toContain("stats-max-days: source capacity drift");
    const missing = checkAssuranceRegistry({ ...reader, exists: path => path !== "crates/aicharts-core/src/lib.rs" && reader.exists(path) });
    expect(missing.errors).toContain("F01: missing crates/aicharts-core/src/lib.rs");
  });
  test("an exempted capacity mismatch cannot silently survive repair", () => {
    const patched: RegistryReader = {
      ...reader,
      read: path => {
        const source = reader.read(path);
        if (path !== "verify/assurance/capacities.json") return source;
        const data = JSON.parse(source);
        const relation = data.relations.find((row: { right: string }) => row.right === "private-days-max-heads");
        relation.status = "known-defect"; relation.finding = "F10";
        return JSON.stringify(data);
      },
    };
    expect(checkAssuranceRegistry(patched).errors).toContain("max-admission-heads/private-days-max-heads: stale defect exemption");
  });
  test("reasoning cannot be counted as both a subset and a disjoint bucket", () => {
    const result = checkAssuranceRegistry(mutate("verify/assurance/profiles.json", original => {
      const data = JSON.parse(original); data.profiles[0].totalPartition.push("reasoning"); return JSON.stringify(data);
    }));
    expect(result.errors).toContain("imported-tokens-v1: subset double-count or missing parent");
  });
  test("numeric-source parsing never executes expressions and checks representability", () => {
    expect(numericConstant("const MAX_BYTES: usize = 256 * 1_024 * 1_024;", "MAX_BYTES")).toBe(268435456);
    expect(numericConstant("export const MAX_BYTES = 4 * 1024 * 1024;", "MAX_BYTES")).toBe(4194304);
    expect(numericConstant("const MAX_BYTES = process.exit(0);", "MAX_BYTES")).toBeNull();
    expect(numericConstant("const MAX_BYTES = 9007199254740992;", "MAX_BYTES")).toBeNull();
    expect(numericConstant("// const MAX_BYTES = 10;\nconst MAX_BYTES = 20;", "MAX_BYTES")).toBe(20);
    expect(numericConstant('const text = "const MAX_BYTES = 10;"; const MAX_BYTES = 20;', "MAX_BYTES")).toBe(20);
    expect(numericConstant('/* nested /* const MAX_BYTES = 10; */ */ const TEXT: &str = r#"const MAX_BYTES = 11;"#; const MAX_BYTES: usize = 20;', "MAX_BYTES", "rust")).toBe(20);
    expect(numericConstant("const MAX_BYTES: usize = 10; const MAX_BYTES: usize = 20;", "MAX_BYTES", "rust")).toBeNull();
  });
});
