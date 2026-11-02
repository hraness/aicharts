import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Job = { name?: string; if?: string; needs?: string[]; steps: Step[] };
const workflow = parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")) as {
  on: Record<string, unknown>;
  jobs: Record<string, Job>;
};

describe("benchmark CI admission", () => {
  test("Required covers every concrete blocking job on every pull request", () => {
    expect(workflow.on).toHaveProperty("pull_request");
    const required = workflow.jobs.required!;
    expect(required.name).toBe("Required");
    expect(required.if).toBe("always()");
    const blocking = Object.keys(workflow.jobs).filter(name => name !== "required");
    expect(blocking.length).toBeGreaterThan(0);
    expect(required.needs?.toSorted()).toEqual(blocking.toSorted());
    for (const name of required.needs ?? []) {
      expect(workflow.jobs[name]?.steps.length).toBeGreaterThan(0);
    }
  });

  test("the actual Required shell rejects failed, cancelled, skipped, or missing results", () => {
    const gate = workflow.jobs.required!.steps[0]!;
    const variables = Object.keys(gate.env ?? {});
    expect(variables.length).toBeGreaterThan(0);
    const success = Object.fromEntries(variables.map(name => [name, "success"]));
    const run = (env: Record<string, string>) => Bun.spawnSync(["bash", "-c", gate.run!], {
      env: { PATH: process.env.PATH ?? "", ...env },
      stdout: "pipe", stderr: "pipe",
    }).exitCode;
    expect(run(success)).toBe(0);
    for (const name of variables) {
      for (const result of ["failure", "cancelled", "skipped", ""]) {
        expect(run({ ...success, [name]: result })).not.toBe(0);
      }
    }
  });

  test("the retained web build still exercises both browser suites", () => {
    const scripts = Object.values(workflow.jobs).flatMap(job => job.steps.map(step => step.run ?? "")).join("\n");
    for (const command of ["bun run check:cost-surfaces", "bun run check:generated", "bun run skill:check",
      "bun run typecheck", "bun run lint", "bun run test", "bun run build", "bun run test:browser",
      "node scripts/verify-public-site-browser.mjs"]) {
      expect(scripts).toContain(command);
    }
  });
});
