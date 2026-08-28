import { describe, expect, test } from "bun:test";
import { parse } from "yaml";

const workflowPath = new URL("../.github/workflows/data-refresh.yml", import.meta.url);
const source = await Bun.file(workflowPath).text();
const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url);
const ciSource = await Bun.file(ciWorkflowPath).text();
const workflow = parse(source) as {
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    "timeout-minutes"?: number;
    env?: Record<string, string>;
    steps?: Array<Record<string, unknown>>;
  }>;
};
const ciWorkflow = parse(ciSource) as {
  on?: {
    pull_request?: { "paths-ignore"?: string[] };
    workflow_dispatch?: unknown;
  };
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

  test("publishes only the two owned snapshots through the protected-branch contract", () => {
    const publish = String(step("publish").run);
    expect(refresh["timeout-minutes"]).toBe(45);
    expect(refresh.env).toMatchObject({
      BENCHMARK_PATH: "data/coding-agents.json",
      REFRESH_BRANCH: "automation/model-data-refresh-${{ github.run_id }}-${{ github.run_attempt }}",
      RELEASE_RADAR_PATH: "data/model-release-radar.json",
      REQUIRED_CHECK_CONTEXT: "Required",
    });
    expect(String(step("snapshot").run)).toContain('"$BENCHMARK_PATH"');
    expect(String(step("snapshot").run)).toContain('"$RELEASE_RADAR_PATH"');
    expect(step("validation").run).toBe("bun run check");
    expect(publish).toContain(
      'git add -- "$BENCHMARK_PATH" "$RELEASE_RADAR_PATH"',
    );
    expect(publish).toContain('"HEAD:refs/heads/${REFRESH_BRANCH}"');
    expect(publish).toContain('gh pr create --base main');
    expect(publish).toContain('--commit "$head_sha" --event workflow_dispatch');
    expect(publish).toContain('gh workflow run ci.yml --ref "$REFRESH_BRANCH"');
    expect(publish).toContain('gh run watch "$ci_run_id" --exit-status');
    expect(publish).toContain('"repos/${GITHUB_REPOSITORY}/statuses/${head_sha}"');
    expect(publish).toContain('-f context="$REQUIRED_CHECK_CONTEXT"');
    expect(publish).toContain('gh pr merge "$pr_url" --auto --squash --delete-branch');
    expect(publish).toContain('for merge_attempt in {1..60}');
    expect(publish).toContain('if [[ "$merge_attempt" -lt 60 ]]; then sleep 5; fi');
    expect(publish).toContain('gh pr merge "$pr_url" --disable-auto || true');
    expect(publish).toContain('if [[ "$pr_state" != "MERGED" ]]');
    expect(publish.indexOf('echo "pr_url=${pr_url}"')).toBeLessThan(
      publish.indexOf('gh workflow run ci.yml --ref "$REFRESH_BRANCH"'),
    );
    expect(publish.indexOf('gh run watch "$ci_run_id" --exit-status')).toBeLessThan(
      publish.indexOf('"repos/${GITHUB_REPOSITORY}/statuses/${head_sha}"'),
    );
    expect(publish.indexOf('"repos/${GITHUB_REPOSITORY}/statuses/${head_sha}"')).toBeLessThan(
      publish.indexOf('gh pr merge "$pr_url" --auto'),
    );
    expect(publish).not.toContain("HEAD:main");
    expect(ciWorkflow.on).toHaveProperty("workflow_dispatch");
    expect(ciWorkflow.on?.pull_request?.["paths-ignore"]).toEqual([
      "data/coding-agents.json",
      "data/model-release-radar.json",
    ]);
  });

  test("retries transient installs and owns one durable self-healing alert", () => {
    expect(workflow.permissions).toMatchObject({
      actions: "write",
      contents: "write",
      issues: "write",
      "pull-requests": "write",
      statuses: "write",
    });
    expect(String(step("dependencies").run)).toContain("for attempt in 1 2 3");
    const health = steps.find(candidate => candidate.name === "Report health and manage the durable alert");
    expect(health).toBeDefined();
    expect(health).toMatchObject({ if: "always()" });
    expect(String(health?.run)).toContain("gh issue create");
    expect(String(health?.run)).toContain("gh issue edit");
    expect(String(health?.run)).toContain("gh issue close");
    expect(String(health?.run)).toContain('.status == "awaiting-benchmark"');
    expect(String(health?.run)).not.toContain('\\"awaiting-benchmark\\"');
  });
});
