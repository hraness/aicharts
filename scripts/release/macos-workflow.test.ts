import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const source = readFileSync(new URL("../../.github/workflows/cli-macos.yml", import.meta.url), "utf8");
const workflow = parse(source);
type Step = { name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown> };
const steps = (job: string): Step[] => workflow.jobs[job].steps;
const named = (job: string, name: string) => {
  const step = steps(job).find(candidate => candidate.name === name);
  if (!step) throw new Error(`missing step ${name}`);
  return step;
};
const SECRETS = ["APPLE_DEVELOPER_ID_P12_BASE64", "APPLE_DEVELOPER_ID_P12_PASSWORD", "APPLE_NOTARY_KEY_P8_BASE64", "APPLE_NOTARY_KEY_ID", "APPLE_NOTARY_ISSUER_ID"];

describe("nonpublishing macOS qualification workflow", () => {
  test("runs only by explicit dispatch on canonical main and publishes nothing", () => {
    expect(workflow.on).toEqual({ workflow_dispatch: null });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(Object.keys(workflow.jobs)).toEqual(["build", "sign"]);
    for (const job of ["build", "sign"]) {
      expect(workflow.jobs[job].if).toBe("github.repository == 'hraness/aicharts' && github.ref == 'refs/heads/main'");
      expect(workflow.jobs[job]["runs-on"]).toBe("macos-15");
    }
    expect(source).not.toMatch(/id-token:|contents: write|attest-build-provenance|gh release|npm publish|wrangler deploy/u);
  });

  test("pins every action and checks out the dispatched commit without credentials", () => {
    for (const job of ["build", "sign"]) {
      for (const step of steps(job).filter(candidate => candidate.uses)) expect(step.uses).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40}$/u);
      const checkout = steps(job).find(step => step.uses?.startsWith("actions/checkout@"));
      expect(checkout?.with).toEqual({ ref: "${{ github.sha }}", "persist-credentials": false, "fetch-depth": 1 });
    }
  });

  test("keeps Apple credentials out of the build job and inside one signing step", () => {
    expect(workflow.jobs.build.environment).toBeUndefined();
    expect(JSON.stringify(workflow.jobs.build)).not.toContain("secrets.");
    expect(workflow.jobs.sign.environment).toBe("aicharts-apple-release");
    expect(workflow.jobs.sign.permissions).toEqual({ actions: "read", contents: "read" });
    const withSecrets = steps("sign").filter(step => JSON.stringify(step).includes("secrets."));
    expect(withSecrets.map(step => step.name)).toEqual(["Sign and notarize without executing the binary"]);
    expect(Object.keys(withSecrets[0].env ?? {})).toEqual(SECRETS);
    expect(withSecrets[0].run).toContain('python3 -I scripts/release/sign-macos.py sign "${RUNNER_TEMP}/aicharts-unsigned-input/');
    expect([...(source.match(/secrets\.[A-Z0-9_]+/gu) ?? [])].sort()).toEqual(SECRETS.map(name => `secrets.${name}`).sort());
  });

  test("binds the same-run unsigned artifact, cleans up credentials and runs the binary only after cleanup", () => {
    const names = steps("sign").map(step => step.name);
    const cleanup = named("sign", "Remove temporary signing credentials even on failure or cancellation");
    expect(cleanup.if).toBe("always()");
    expect(cleanup.run).toBe('python3 -I scripts/release/sign-macos.py cleanup "${RUNNER_TEMP}/aicharts-apple-signing"');
    expect(names.indexOf("Verify and run the signed binary after credential removal")).toBeGreaterThan(names.indexOf(cleanup.name));
    const bind = named("sign", "Download and bind the exact same-run unsigned artifact").run ?? "";
    expect(bind).toContain('(.workflow_run.id | tostring) == $run and .workflow_run.head_sha == $sha');
    expect(bind).toContain('.name == ("macos-unsigned-" + $sha + "-" + env.GITHUB_RUN_ATTEMPT)');
    expect(bind).toContain("python3 -I scripts/release/sign-macos.py extract-artifact");
    const verify = named("sign", "Verify and run the signed binary after credential removal").run ?? "";
    expect(verify).toContain("codesign --verify --strict --check-notarization");
    expect(verify).toContain('identifier "dev.hraness.aicharts" and anchor apple generic and certificate leaf[subject.OU] = "8AAP53VTW3"');
    expect(verify).toContain("node scripts/release/macos-smoke.mjs");
  });

  test("retains only bounded short-lived artifacts with names publication selects", () => {
    const unsigned = named("build", "Retain the exact unsigned input for the signing job");
    expect(unsigned.with?.name).toBe("macos-unsigned-${{ github.sha }}-${{ github.run_attempt }}");
    const signed = named("sign", "Retain the exact signed qualification artifacts");
    expect(signed.if).toBeUndefined();
    expect(signed.with?.name).toBe("macos-qualification-${{ github.sha }}-${{ github.run_attempt }}");
    expect(String(signed.with?.path).trim().split("\n")).toEqual([
      "signed-artifacts/aicharts-*-aarch64-apple-darwin.tar.gz",
      "signed-artifacts/aicharts-*-aarch64-apple-darwin.tar.gz.sha256",
      "signed-artifacts/aicharts-apple-notarization.json",
    ]);
    for (const step of [unsigned, signed]) {
      expect(step.with?.["if-no-files-found"]).toBe("error");
      expect(step.with?.["retention-days"]).toBe(7);
    }
    const build = named("build", "Build, smoke and package the unsigned binary").run ?? "";
    expect(build).toContain("cargo +1.97.1 build --release --locked -p aicharts-cli");
    expect(build).toContain("node scripts/release/macos-smoke.mjs");
    expect(build).toContain("node scripts/release/macos-notices.mjs");
    expect(build).toContain("python3 -I scripts/release/sign-macos.py package-unsigned");
  });
});
