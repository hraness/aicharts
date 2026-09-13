import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const source = readFileSync(new URL("../../.github/workflows/cli-release.yml", import.meta.url), "utf8");
const workflow = parse(source);

describe("nonpublishing Linux qualification workflow", () => {
  test("runs only by explicit dispatch on the canonical main repository", () => {
    expect(workflow.on).toEqual({ workflow_dispatch: null });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(Object.keys(workflow.jobs)).toEqual(["qualify"]);
    expect(workflow.jobs.qualify.if).toBe("github.repository == 'hraness/aicharts' && github.ref == 'refs/heads/main'");
    expect(workflow.jobs.qualify["runs-on"]).toBe("ubuntu-22.04");
    expect(workflow.jobs.qualify["timeout-minutes"]).toBe(30);
    expect(source).not.toMatch(/secrets\.|id-token:|contents: write|attest-build-provenance|gh release|npm publish|wrangler deploy/u);
  });

  test("pins every action and selects one immutable checkout without credentials", () => {
    const actions = workflow.jobs.qualify.steps.filter((step: { uses?: string }) => step.uses);
    expect(actions).toHaveLength(5);
    for (const action of actions) expect(action.uses).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40}$/u);
    expect(actions[0].with).toEqual({ ref: "${{ github.sha }}", "persist-credentials": false, "fetch-depth": 1 });
  });

  test("keeps scratch private and retains only successful bounded outputs", () => {
    const steps = workflow.jobs.qualify.steps;
    const build = steps.find((step: { name: string }) => step.name === "Build, measure, and test a new installation");
    expect(build.run).toContain("mktemp -d");
    expect(build.run).toContain('node scripts/release/run-linux.mjs --repository "$GITHUB_WORKSPACE" --commit "$QUALIFICATION_COMMIT" --tree "$qualification_tree" --output "${qualification_scratch}/result"');
    const upload = steps.find((step: { name: string }) => step.name === "Retain the exact successful qualification artifacts");
    expect(upload.if).toBeUndefined(); // GitHub's success() default preserves failed-run custody.
    expect(upload.with["if-no-files-found"]).toBe("error");
    expect(upload.with["retention-days"]).toBe(7);
    expect(upload.with.path.trim().split("\n")).toEqual([
      "${{ env.QUALIFICATION_OUTPUT }}/assets/*",
      "${{ env.QUALIFICATION_OUTPUT }}/qualification.json",
    ]);
    const summary = steps.at(-1);
    expect(summary.if).toBe("always() && env.QUALIFICATION_OUTPUT != ''");
    expect(summary.with.path).toBe("${{ env.QUALIFICATION_OUTPUT }}/summary.json");
    expect(summary.with["retention-days"]).toBe(7);
  });
});
