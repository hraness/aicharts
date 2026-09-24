import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parse } from "yaml";
import { assertPackages, safeToolPath, supportedPlatform, toolsManifestSchema, verifyFile } from "./assurance-tools";
import { sha256 } from "./assurance-proof-common";

const temporary: string[] = [];
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });
const fixture = async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "aicharts-tools-"));
  temporary.push(directory);
  return directory;
};
const manifest = JSON.parse(await readFile(new URL("../verify/tools/manifest.json", import.meta.url), "utf8"));

describe("formal tool provisioning admission", () => {
  test("only the two pinned host and architecture pairs are supported", () => {
    expect(supportedPlatform("darwin", "arm64")).toBe("darwin-arm64");
    expect(supportedPlatform("linux", "x64")).toBe("linux-x64");
    expect(() => supportedPlatform("linux", "arm64")).toThrow("unsupported_formal_platform");
    expect(() => supportedPlatform("win32", "x64")).toThrow("unsupported_formal_platform");
  });
  test("artifact configuration rejects traversal, external destinations, unreviewed origins and moving Rust channels", () => {
    expect(toolsManifestSchema.safeParse(manifest).success).toBe(true);
    for (const change of [
      (value: typeof manifest) => { value.common[0].installPath = "target/assurance-tools/../outside"; },
      (value: typeof manifest) => { value.common[0].cache = "/tmp/unmanaged"; },
      (value: typeof manifest) => { value.common[0].archiveRoot = "../outside"; },
      (value: typeof manifest) => { value.common[0].url = "https://example.com/tool.jar"; },
      (value: typeof manifest) => { value.common[0].url = "https://secret@github.com/tlaplus/tlaplus/releases/download/v1/a.jar"; },
      (value: typeof manifest) => { value.common[0].maxArchiveBytes = Number.MAX_SAFE_INTEGER; },
      (value: typeof manifest) => { value.rust[0].toolchain = "nightly"; },
      (value: typeof manifest) => { value.leanPackages[0].rev = "main"; },
    ]) {
      const changed = structuredClone(manifest); change(changed);
      expect(toolsManifestSchema.safeParse(changed).success).toBe(false);
    }
  });
  test("a destination cannot redirect installation through an existing symlink", async () => {
    const directory = await fixture();
    await mkdir(resolve(directory, "outside"));
    await mkdir(resolve(directory, "target"));
    await symlink(resolve(directory, "outside"), resolve(directory, "target/assurance-tools"));
    await expect(safeToolPath("target/assurance-tools/tool/bin", directory)).rejects.toThrow("tool_install_path_is_symlink");
  });
  test("cached bytes need the exact checksum and size bound before reuse", async () => {
    const file = resolve(await fixture(), "archive");
    await writeFile(file, "verified artifact");
    await verifyFile(file, sha256("verified artifact"), 100);
    await expect(verifyFile(file, sha256("different artifact"), 100)).rejects.toThrow("tool_checksum_mismatch");
    await expect(verifyFile(file, sha256("verified artifact"), 3)).rejects.toThrow("tool_file_size");
    await writeFile(file, "");
    await expect(verifyFile(file, sha256(""), 100)).rejects.toThrow("tool_file_size");
  });
  test("Lean dependency admission compares exact names, origins and commits", () => {
    const expected = [{ name: "mathlib", url: "https://github.com/leanprover-community/mathlib4.git", rev: "a".repeat(40) }];
    const actual = { packagesDir: ".lake/packages", packages: [{ ...expected[0], type: "git", subDir: null }] };
    expect(() => assertPackages(actual, expected)).not.toThrow();
    for (const changed of [
      { ...actual, packages: [] },
      { ...actual, packages: [actual.packages[0], actual.packages[0]] },
      { ...actual, packages: [{ ...actual.packages[0], rev: "b".repeat(40) }] },
      { ...actual, packages: [{ ...actual.packages[0], url: "https://example.com/mathlib" }] },
    ]) expect(() => assertPackages(changed, expected)).toThrow("lean_dependency_manifest_drift");
  });
  test("CI preserves Check and Menubar and requires formal results with failure artifacts", async () => {
    const workflow = parse(await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));
    expect(workflow.jobs.required.needs).toEqual(["check", "menubar", "formal"]);
    expect(workflow.jobs.required.steps[0].run).toContain('test "$FORMAL_RESULT" = success');
    expect(workflow.jobs.check.steps.some((step: { run?: string }) => step.run === "bun run check")).toBe(true);
    expect(workflow.jobs.menubar.steps.some((step: { run?: string }) => step.run?.includes("cargo build --release --locked"))).toBe(true);
    const steps = workflow.jobs.formal.steps;
    for (const step of steps) if (step.uses) expect(step.uses).toMatch(/@[0-9a-f]{40}$/u);
    expect(steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/upload-artifact@")).if).toBe("always()");
    for (const name of ["usage:formal:tla", "usage:formal:kani", "usage:formal:theorems"]) {
      expect(steps.some((step: { run?: string }) => step.run === `bun run ${name}`)).toBe(true);
    }
  });
});
