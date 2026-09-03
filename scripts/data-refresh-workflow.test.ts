import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";
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
const reviewCandidateMarker = "<!-- aicharts:first-party-release-candidate -->";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
    force: true,
    recursive: true,
  })));
});

function step(id: string): Record<string, unknown> {
  const found = steps.find(candidate => candidate.id === id);
  if (found === undefined) throw new Error(`Expected workflow step ${id}.`);
  return found;
}

function generatedReviewRow(
  canonicalUrl: string,
  model: string,
  provider = "Fixture Lab",
): string {
  return `- ${reviewCandidateMarker} [${model}](${canonicalUrl}) — ${provider}; first seen 2026-09-03T12:00:00.000Z.`;
}

type ReviewCandidateFixture = Readonly<{
  canonicalUrl: string;
  firstSeenAt: string;
  namedModels: readonly string[];
  providerName: string;
  status: "confirmed-release" | "needs-review" | "not-a-release";
}>;

function reviewCandidate(
  canonicalUrl: string,
  model: string,
  status: ReviewCandidateFixture["status"],
): ReviewCandidateFixture {
  return {
    canonicalUrl,
    firstSeenAt: "2026-09-03T12:00:00.000Z",
    namedModels: [model],
    providerName: "Fixture Lab",
    status,
  };
}

async function executeWorkflowShell(
  script: string,
  options: Readonly<{
    candidates: readonly ReviewCandidateFixture[];
    extraEnvironment?: Readonly<Record<string, string>>;
    issueBody: string;
    issueComments?: string;
  }>,
): Promise<Readonly<{
  log: string;
  status: number | null;
  stderr: string;
  stdout: string;
}>> {
  const root = await mkdtemp(path.join(tmpdir(), "aicharts-refresh-workflow-test-"));
  temporaryRoots.push(root);
  const fakeBin = path.join(root, "bin");
  const fakeGh = path.join(fakeBin, "gh");
  const ghLog = path.join(root, "gh.log");
  const radarPath = path.join(root, "first-party-release-radar.json");
  const summaryPath = path.join(root, "summary.md");
  await mkdir(fakeBin, { recursive: true });
  await writeFile(radarPath, `${JSON.stringify({
    candidates: options.candidates,
    sources: [],
  }, null, 2)}\n`, "utf8");
  const fakeGhSource = [
    "#!/bin/bash",
    "set -e",
    "",
    'case "${1:-}:${2:-}" in',
    "  issue:list)",
    '    case "$*" in',
    '      *"Data refresh is unhealthy"*) printf \'%s\' "${FAKE_HEALTH_ISSUE_NUMBER:-}" ;;',
    '      *"First-party releases need review"*) printf \'%s\\n\' "${FAKE_REVIEW_ISSUE_NUMBER:-42}" ;;',
    '      *) echo "Unexpected issue-list query: $*" >&2; exit 91 ;;',
    "    esac",
    "    ;;",
    "  issue:view)",
    '    printf \'%s\' "${FAKE_ISSUE_BODY:-}"',
    "    ;;",
    "  api:--paginate)",
    '    printf \'%s\' "${FAKE_ISSUE_COMMENTS:-}"',
    "    ;;",
    "  issue:comment|issue:close|issue:create|issue:edit)",
    '    action="$2"',
    "    shift 2",
    '    body=""',
    '    while [[ "$#" -gt 0 ]]; do',
    '      case "$1" in',
    "        --body|--comment)",
    "          shift",
    '          body="${1:-}"',
    "          ;;",
    "      esac",
    "      shift || true",
    "    done",
    "    {",
    '      printf \'ACTION:%s\\n\' "$action"',
    '      printf \'%s\\n\' "$body"',
    "      printf '%s\\n' '---END---'",
    '    } >> "$FAKE_GH_LOG"',
    "    ;;",
    "  *)",
    '    echo "Unexpected gh command: $*" >&2',
    "    exit 92",
    "    ;;",
    "esac",
    "",
  ].join("\n");
  await writeFile(fakeGh, fakeGhSource, "utf8");
  await chmod(fakeGh, 0o755);

  const result = spawnSync(
    "/bin/bash",
    ["-e", "-o", "pipefail", "-c", script],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        BENCHMARK_OUTCOME: "skipped",
        CHECKOUT_OUTCOME: "success",
        DEEP_SWE_OUTCOME: "success",
        DEPENDENCIES_OUTCOME: "success",
        DETECT_OUTCOME: "success",
        FAKE_GH_LOG: ghLog,
        FAKE_ISSUE_BODY: options.issueBody,
        FAKE_ISSUE_COMMENTS: options.issueComments ?? "",
        FIRST_PARTY_CHANGED: "false",
        FIRST_PARTY_RELEASE_OUTCOME: "success",
        FIRST_PARTY_RELEASE_PATH: radarPath,
        FIRST_PARTY_REVIEW_OUTCOME: "success",
        GITHUB_REPOSITORY: "hraness/aicharts",
        GITHUB_RUN_ID: "12345",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_STEP_SUMMARY: summaryPath,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        PUBLISH_OUTCOME: "skipped",
        REFRESH_MODE: "discovery",
        RELEASE_OUTCOME: "success",
        RELEASE_RECONCILE_OUTCOME: "success",
        RUN_AAI_REFRESH: "false",
        SETUP_BUN_OUTCOME: "success",
        SETUP_NODE_OUTCOME: "success",
        SNAPSHOT_CHANGED: "false",
        TERMINAL_BENCH_OUTCOME: "success",
        TERMINAL_BENCH_SCIENCE_OUTCOME: "success",
        VALIDATION_OUTCOME: "skipped",
        ...options.extraEnvironment,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    },
  );
  const log = await readFile(ghLog, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  });
  return {
    log,
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
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
      NEXT_PUBLIC_HRANESS_MAILING_TURNSTILE_SITEKEY: "1x00000000000000000000AA",
      REFRESH_MODE: expect.stringContaining("github.event.schedule == '43 10 * * *'"),
      RUN_AAI_REFRESH: expect.stringContaining("inputs.mode == 'full'"),
    });
    expect(String(step("benchmark").if)).toContain("env.RUN_AAI_REFRESH == 'true'");
    expect(step("release_radar").if).toBe("steps.dependencies.outcome == 'success'");
    expect(step("first_party_releases").if).toBe("steps.dependencies.outcome == 'success'");
    expect(step("deep_swe").if).toBe("steps.dependencies.outcome == 'success'");
    expect(step("terminal_bench").if).toBe("steps.dependencies.outcome == 'success'");
    expect(step("terminal_bench_science").if).toBe("steps.dependencies.outcome == 'success'");
    expect(step("release_reconcile").if).toBe("steps.dependencies.outcome == 'success'");
  });

  test("keeps each discovery and benchmark source independently observable", () => {
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
    expect(step("first_party_releases")).toMatchObject({
      "continue-on-error": true,
      run: "bun run first-party-releases:refresh",
    });
    expect(step("first_party_review")).toMatchObject({
      "continue-on-error": true,
      env: {
        GH_REPO: "${{ github.repository }}",
        GH_TOKEN: "${{ github.token }}",
      },
      if: "always() && steps.dependencies.outcome == 'success'",
    });
    expect(step("terminal_bench")).toMatchObject({
      "continue-on-error": true,
      env: { GITHUB_TOKEN: "${{ github.token }}" },
      run: "bun run terminal-bench:refresh",
    });
    expect(step("terminal_bench_science")).toMatchObject({
      "continue-on-error": true,
      env: { GITHUB_TOKEN: "${{ github.token }}" },
      run: "bun run terminal-bench-science:refresh",
    });
    expect(step("release_reconcile").if).toBe("steps.dependencies.outcome == 'success'");
    expect(steps.indexOf(step("first_party_releases"))).toBeLessThan(
      steps.indexOf(step("first_party_review")),
    );
    expect(steps.indexOf(step("first_party_review"))).toBeLessThan(
      steps.indexOf(step("release_radar")),
    );
    expect(steps.indexOf(step("release_radar"))).toBeLessThan(
      steps.indexOf(step("benchmark")),
    );
    expect(steps.indexOf(step("benchmark"))).toBeLessThan(steps.indexOf(step("release_reconcile")));
    expect(steps.indexOf(step("release_reconcile"))).toBeLessThan(steps.indexOf(step("deep_swe")));
  });

  test("publishes only the six owned snapshots through the protected-branch contract", () => {
    const publish = String(step("publish").run);
    expect(refresh["timeout-minutes"]).toBe(45);
    expect(refresh.env).toMatchObject({
      BENCHMARK_PATH: "data/coding-agents.json",
      DEEP_SWE_PATH: "data/deep-swe-evidence.json",
      FIRST_PARTY_RELEASE_PATH: "data/first-party-release-radar.json",
      REFRESH_BRANCH: "automation/model-data-refresh-${{ github.run_id }}-${{ github.run_attempt }}",
      RELEASE_RADAR_PATH: "data/model-release-radar.json",
      REQUIRED_CHECK_CONTEXT: "Required",
      TERMINAL_BENCH_PATH: "data/terminal-bench.json",
      TERMINAL_BENCH_SCIENCE_PATH: "data/terminal-bench-science.json",
    });
    expect(String(step("snapshot").run)).toContain('"$BENCHMARK_PATH"');
    expect(String(step("snapshot").run)).toContain('"$DEEP_SWE_PATH"');
    expect(String(step("snapshot").run)).toContain('"$FIRST_PARTY_RELEASE_PATH"');
    expect(String(step("snapshot").run)).toContain('"$RELEASE_RADAR_PATH"');
    expect(String(step("snapshot").run)).toContain('"$TERMINAL_BENCH_PATH"');
    expect(String(step("snapshot").run)).toContain('"$TERMINAL_BENCH_SCIENCE_PATH"');
    expect(step("validation").run).toBe("bun run check");
    expect(publish).toContain(
      'git add -- "$BENCHMARK_PATH" "$DEEP_SWE_PATH" "$FIRST_PARTY_RELEASE_PATH" "$RELEASE_RADAR_PATH" "$TERMINAL_BENCH_PATH" "$TERMINAL_BENCH_SCIENCE_PATH"',
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
      "data/first-party-release-radar.json",
      "data/model-release-radar.json",
      "data/terminal-bench.json",
      "data/terminal-bench-science.json",
    ]);
  });

  test("restores poll-metadata-only snapshots before deciding whether to publish", () => {
    const detect = String(step("snapshot").run);
    expect(detect).toContain("semantic_filter='del(.source.retrievedAt)'");
    expect(detect).toContain("semantic_filter='del(.sources[].retrievedAt)'");
    expect(detect).toContain(
      "semantic_filter='walk(if type == \"object\" then del(.attemptedAt, .retrievedAt) else . end) | del(.identitySource.status)'",
    );
    expect(detect).not.toContain("del(.source.generatedAt)");
    expect(detect).toContain('git show "HEAD:${changed_file}" | jq -cS "$semantic_filter"');
    expect(detect).toContain('jq -cS "$semantic_filter" "$changed_file"');
    expect(detect).toContain('git restore --source=HEAD -- "$changed_file"');
    expect(detect).toContain('echo "first_party_changed=false" >> "$GITHUB_OUTPUT"');
    expect(detect).toContain('echo "first_party_changed=true" >> "$GITHUB_OUTPUT"');
    expect(detect).toContain('git diff --quiet -- "$FIRST_PARTY_RELEASE_PATH"');
    expect(detect.match(/changed_files="\$\(git diff --name-only\)"/gu)).toHaveLength(2);
    expect(detect.indexOf("git restore --source=HEAD")).toBeLessThan(
      detect.lastIndexOf('echo "changed=true"'),
    );
  });

  test("retries transient installs and owns separate health and editorial queues", () => {
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
    expect(String(health?.run)).toContain("First-party releases need review");
    expect(String(health?.run)).toContain('.status == "awaiting-benchmark"');
    expect(String(health?.run)).toContain("Direct DeepSWE");
    expect(String(health?.run)).toContain("First-party release sources");
    expect(String(health?.run)).toContain("First-party review alert");
    expect(String(health?.run)).toContain("Terminal-Bench 4");
    expect(String(health?.run)).toContain("Terminal-Bench-Science 0.1");
    expect(String(health?.run)).toContain("$TERMINAL_BENCH_SCIENCE_OUTCOME");
    expect(String(health?.run)).toContain(
      '[[ "$RUN_AAI_REFRESH" == "true" && "$BENCHMARK_OUTCOME" != "success" ]]',
    );
    expect(String(health?.run)).toContain(
      '[[ "$RUN_AAI_REFRESH" != "true" && "$BENCHMARK_OUTCOME" != "skipped" ]]',
    );
    expect(String(health?.run)).toContain(
      '[[ "$FIRST_PARTY_RELEASE_OUTCOME" == "success" && "$FIRST_PARTY_REVIEW_OUTCOME" != "success" ]]',
    );
    expect(String(health?.run)).toContain(
      '[[ -n "$issue_number" && "$RUN_AAI_REFRESH" == "true" ]]',
    );
    expect(String(health?.run)).toContain(
      "A healthy discovery run leaves the alert open until a full AAI refresh also passes.",
    );
    expect(String(health?.run)).not.toContain('\\"awaiting-benchmark\\"');
  });

  test("persists positive first-party review alerts before unrelated benchmark work", () => {
    const review = step("first_party_review");
    const reviewRun = String(review.run);

    expect(reviewRun).toContain('.status == "needs-review"');
    expect(reviewRun).toContain("gh issue create");
    expect(reviewRun).toContain("gh issue comment");
    expect(reviewRun).toContain("--paginate");
    expect(reviewRun).toContain('review_issue_comments="$(gh api --paginate');
    expect(reviewRun).toContain('review_history="${review_issue_body}"');
    expect(reviewRun).toContain("Queue entries are append-only");
    expect(reviewRun).toContain(reviewCandidateMarker);
    expect(reviewRun).toContain(
      "sed -nE 's|^- <!-- aicharts:first-party-release-candidate -->",
    );
    expect(reviewRun).toContain('grep -Fxq -- "$review_url"');
    expect(reviewRun).not.toContain("grep -oE '\\]\\(https://");
    expect(reviewRun).not.toContain(".[:25]");
    expect(reviewRun).not.toContain("gh issue edit");
    expect(reviewRun).not.toContain("gh issue close");
    expect(reviewRun).not.toContain("DETECT_OUTCOME");
    expect(reviewRun).not.toContain("VALIDATION_OUTCOME");
    expect(reviewRun).not.toContain("PUBLISH_OUTCOME");
    expect(reviewRun).not.toContain("TERMINAL_BENCH_OUTCOME");
    expect(reviewRun).not.toContain("TERMINAL_BENCH_SCIENCE_OUTCOME");
  });

  test("executes append-only reconciliation using generated rows rather than human links", async () => {
    const retainedUrl = "https://lab.example/releases/model-a";
    const newUrl = "https://lab.example/releases/model-b";
    const humanUrl = "https://notes.example/context";
    const result = await executeWorkflowShell(String(step("first_party_review").run), {
      candidates: [
        reviewCandidate(retainedUrl, "Model A", "needs-review"),
        reviewCandidate(newUrl, "Model B", "needs-review"),
      ],
      issueBody: [
        "Durable queue",
        "",
        generatedReviewRow(retainedUrl, "Model A"),
        "",
        `A human mentioned [Model B separately](${newUrl}); that is not a generated queue row.`,
      ].join("\n"),
      issueComments: `Human-only context: [background](${humanUrl})`,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.log).toContain("ACTION:comment");
    expect(result.log).toContain(generatedReviewRow(newUrl, "Model B"));
    expect(result.log).not.toContain(generatedReviewRow(retainedUrl, "Model A"));
    expect(result.log).not.toContain(humanUrl);
  });

  test("closes the editorial review issue only when every queued URL has a published disposition", () => {
    const health = steps.find(candidate => candidate.name === "Report health and manage the durable alert");
    const healthRun = String(health?.run);
    const reviewStart = healthRun.indexOf("review_snapshot_published=false");
    const unhealthyStart = healthRun.indexOf('if [[ "$unhealthy" == "true" ]]');
    const reviewBlock = healthRun.slice(reviewStart, unhealthyStart);

    expect(reviewStart).toBeGreaterThan(-1);
    expect(unhealthyStart).toBeGreaterThan(reviewStart);
    expect(reviewBlock).toContain(
      '[[ "$FIRST_PARTY_CHANGED" == "false" || ( "$FIRST_PARTY_CHANGED" == "true" && "$PUBLISH_OUTCOME" == "success" ) ]]',
    );
    expect(reviewBlock).toContain(
      'gh issue view "$review_issue_number" --json body',
    );
    expect(reviewBlock).toContain("--paginate");
    expect(reviewBlock).toContain('review_issue_comments="$(gh api --paginate');
    expect(reviewBlock).toContain('review_issue_body="${review_issue_body}"');
    expect(reviewBlock).toContain(reviewCandidateMarker);
    expect(reviewBlock).toContain(
      "sed -nE 's|^- <!-- aicharts:first-party-release-candidate -->",
    );
    expect(reviewBlock).not.toContain("grep -oE '\\]\\(https://");
    expect(reviewBlock).toContain("review_url_count=$((review_url_count + 1))");
    expect(reviewBlock).toContain(
      'any(.candidates[]; .canonicalUrl == $url and .status != "needs-review")',
    );
    expect(reviewBlock).toContain('[[ "$review_url_count" -eq 0 ]]');
    expect(reviewBlock).toContain('[[ "$review_queue_resolved" == "true" ]]');
    expect(reviewBlock).toContain("gh issue close");
    expect(reviewBlock).not.toContain("gh issue create");
    expect(reviewBlock).not.toContain("gh issue edit");
    expect(reviewBlock).toContain(
      "First-party review issue left open because this run did not prove a published disposition for every queued URL.",
    );
  });

  test("executes closure against generated rows while ignoring human Markdown links", async () => {
    const resolvedUrl = "https://lab.example/releases/model-a";
    const result = await executeWorkflowShell(
      String(steps.find(candidate => (
        candidate.name === "Report health and manage the durable alert"
      ))?.run),
      {
        candidates: [reviewCandidate(resolvedUrl, "Model A", "confirmed-release")],
        issueBody: [
          generatedReviewRow(resolvedUrl, "Model A"),
          "",
          "A maintainer added [a design note](https://notes.example/design) by hand.",
        ].join("\n"),
        issueComments: "A reviewer added [supporting context](https://notes.example/context).",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.log).toContain("ACTION:close");
    expect(result.log).toContain(
      "Every candidate retained in this review queue has a published disposition",
    );
  });

  test("executes closure conservatively when a generated comment row is unresolved", async () => {
    const resolvedUrl = "https://lab.example/releases/model-a";
    const unresolvedUrl = "https://lab.example/releases/model-b";
    const result = await executeWorkflowShell(
      String(steps.find(candidate => (
        candidate.name === "Report health and manage the durable alert"
      ))?.run),
      {
        candidates: [reviewCandidate(resolvedUrl, "Model A", "confirmed-release")],
        issueBody: generatedReviewRow(resolvedUrl, "Model A"),
        issueComments: [
          "A paginated comment retained another candidate:",
          generatedReviewRow(unresolvedUrl, "Model B"),
          "Human-only [context](https://notes.example/context).",
        ].join("\n"),
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.log).not.toContain("ACTION:close");
    expect(result.stdout).toContain(
      "First-party review issue left open because this run did not prove a published disposition for every queued URL.",
    );
  });
});
