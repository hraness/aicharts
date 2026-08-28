import { describe, expect, test } from "bun:test";
import { parse } from "yaml";

const workflowPath = new URL("../.github/workflows/data-refresh.yml", import.meta.url);
const source = await Bun.file(workflowPath).text();
const workflow = parse(source) as {
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    env?: Record<string, string>;
    steps?: Array<Record<string, unknown>>;
  }>;
};
const refresh = workflow.jobs?.refresh;
if (refresh === undefined) throw new Error("Expected the data-refresh job.");
const steps = refresh.steps ?? [];

function step(id: string): Record<string, unknown> {
  const found = steps.find(candidate => candidate.id === id);
  if (found === undefined) throw new Error(`Expected workflow step ${id}.`);
  return found;
}

describe("scheduled model-data refresh", () => {
  test("keeps benchmark and release discovery as independent failure domains", () => {
    expect(step("benchmark")).toMatchObject({
      "continue-on-error": true,
      run: "bun run data:refresh",
    });
    expect(step("release_radar")).toMatchObject({
      "continue-on-error": true,
      run: "bun run releases:refresh",
    });
    expect(step("release_reconcile")).toMatchObject({
      "continue-on-error": true,
      run: "bun run releases:reconcile",
    });
    expect(String(step("release_reconcile").if)).toContain(
      "steps.release_radar.outcome != 'success'",
    );
  });

  test("publishes only the two owned snapshots after full validation", () => {
    expect(refresh.env).toMatchObject({
      BENCHMARK_PATH: "data/coding-agents.json",
      RELEASE_RADAR_PATH: "data/model-release-radar.json",
    });
    expect(String(step("snapshot").run)).toContain('"$BENCHMARK_PATH"');
    expect(String(step("snapshot").run)).toContain('"$RELEASE_RADAR_PATH"');
    expect(step("validation").run).toBe("bun run check");
    expect(String(step("publish").run)).toContain(
      'git add -- "$BENCHMARK_PATH" "$RELEASE_RADAR_PATH"',
    );
  });

  test("retries transient installs and owns one durable self-healing alert", () => {
    expect(workflow.permissions).toMatchObject({ contents: "write", issues: "write" });
    expect(String(step("dependencies").run)).toContain("for attempt in 1 2 3");
    const health = steps.find(candidate => candidate.name === "Report health and manage the durable alert");
    expect(health).toBeDefined();
    expect(health).toMatchObject({ if: "always()" });
    expect(String(health?.run)).toContain("gh issue create");
    expect(String(health?.run)).toContain("gh issue edit");
    expect(String(health?.run)).toContain("gh issue close");
  });
});
