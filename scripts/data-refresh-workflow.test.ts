import { describe, expect, test } from "bun:test";
import { parse } from "yaml";

const workflowPath = new URL("../.github/workflows/data-refresh.yml", import.meta.url);
const source = await Bun.file(workflowPath).text();
const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url);
const ciSource = await Bun.file(ciWorkflowPath).text();
const workflow = parse(source) as {
  on?: {
    schedule?: Array<{ cron?: string }>;
    workflow_dispatch?: {
      inputs?: Record<string, Record<string, unknown>>;
    };
  };
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
  test("runs frequent discovery evidence and reserves AAI for full refreshes", () => {
    expect(workflow.on?.schedule).toEqual([
      { cron: "17 */4 * * *" },
      { cron: "43 10 * * *" },
    ]);
    expect(workflow.on?.workflow_dispatch?.inputs?.mode).toMatchObject({
      default: "full",
      options: ["full", "discovery"],
      required: true,
      type: "choice",
    });
    expect(refresh.env).toMatchObject({
      REFRESH_MODE: expect.stringContaining("github.event.schedule == '43 10 * * *'"),
      RUN_AAI_REFRESH: expect.stringContaining("inputs.mode == 'full'"),
    });
    expect(String(step("benchmark").if)).toContain("env.RUN_AAI_REFRESH == 'true'");
    expect(step("release_radar").if).toBe("steps.dependencies.outcome == 'success'");
    expect(step("deep_swe").if).toBe("steps.dependencies.outcome == 'success'");
    expect(step("release_reconcile").if).toBe("steps.dependencies.outcome == 'success'");
  });

  test("runs OpenRouter first, reconciles after AAI, and keeps direct DeepSWE independent", () => {
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
    expect(step("deep_swe")).toMatchObject({
      "continue-on-error": true,
      run: "bun run deepswe:refresh",
    });
    expect(step("release_reconcile").if).toBe("steps.dependencies.outcome == 'success'");
    expect(steps.indexOf(step("release_radar"))).toBeLessThan(steps.indexOf(step("benchmark")));
    expect(steps.indexOf(step("benchmark"))).toBeLessThan(steps.indexOf(step("release_reconcile")));
    expect(steps.indexOf(step("release_reconcile"))).toBeLessThan(steps.indexOf(step("deep_swe")));
  });

  test("publishes only the three owned snapshots through the protected-branch contract", () => {
    const publish = String(step("publish").run);
    expect(refresh["timeout-minutes"]).toBe(45);
    expect(refresh.env).toMatchObject({
      BENCHMARK_PATH: "data/coding-agents.json",
      DEEP_SWE_PATH: "data/deep-swe-evidence.json",
      REFRESH_BRANCH: "automation/model-data-refresh-${{ github.run_id }}-${{ github.run_attempt }}",
      RELEASE_RADAR_PATH: "data/model-release-radar.json",
      REQUIRED_CHECK_CONTEXT: "Required",
    });
    expect(String(step("snapshot").run)).toContain('"$BENCHMARK_PATH"');
    expect(String(step("snapshot").run)).toContain('"$DEEP_SWE_PATH"');
    expect(String(step("snapshot").run)).toContain('"$RELEASE_RADAR_PATH"');
    expect(step("validation").run).toBe("bun run check");
    expect(publish).toContain(
      'git add -- "$BENCHMARK_PATH" "$DEEP_SWE_PATH" "$RELEASE_RADAR_PATH"',
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
      "data/deep-swe-evidence.json",
      "data/model-release-radar.json",
    ]);
  });

  test("restores poll-metadata-only snapshots before deciding whether to publish", () => {
    const detect = String(step("snapshot").run);
    expect(detect).toContain("semantic_filter='del(.source.retrievedAt)'");
    expect(detect).toContain(
      "semantic_filter='walk(if type == \"object\" then del(.attemptedAt, .retrievedAt) else . end) | del(.identitySource.status)'",
    );
    expect(detect).not.toContain("del(.source.generatedAt)");
    expect(detect).toContain('git show "HEAD:${changed_file}" | jq -cS "$semantic_filter"');
    expect(detect).toContain('jq -cS "$semantic_filter" "$changed_file"');
    expect(detect).toContain('git restore --source=HEAD -- "$changed_file"');
    expect(detect.match(/changed_files="\$\(git diff --name-only\)"/gu)).toHaveLength(2);
    expect(detect.indexOf("git restore --source=HEAD")).toBeLessThan(
      detect.lastIndexOf('echo "changed=true"'),
    );
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
    expect(String(health?.run)).toContain("Direct DeepSWE");
    expect(String(health?.run)).toContain(
      '[[ "$RUN_AAI_REFRESH" == "true" && "$BENCHMARK_OUTCOME" != "success" ]]',
    );
    expect(String(health?.run)).toContain(
      '[[ "$RUN_AAI_REFRESH" != "true" && "$BENCHMARK_OUTCOME" != "skipped" ]]',
    );
    expect(String(health?.run)).toContain(
      '[[ -n "$issue_number" && "$RUN_AAI_REFRESH" == "true" ]]',
    );
    expect(String(health?.run)).toContain(
      "A healthy discovery run leaves the alert open until a full AAI refresh also passes.",
    );
    expect(String(health?.run)).not.toContain('\\"awaiting-benchmark\\"');
  });
});
