import { describe, expect, test } from "bun:test";
import { parse } from "yaml";

const workflowPath = new URL(
  "../.github/workflows/codex-auto-merge.yml",
  import.meta.url,
);
const source = await Bun.file(workflowPath).text();
const workflow = parse(source) as {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    if?: string;
    "runs-on"?: string;
    "timeout-minutes"?: number;
    steps?: Array<{
      env?: Record<string, string>;
      run?: string;
      uses?: string;
    }>;
  }>;
};

const job = workflow.jobs?.["enable-auto-merge"];
if (job === undefined) throw new Error("Expected the Codex auto-merge job.");
const steps = job.steps ?? [];

describe("Codex task auto-merge", () => {
  test("runs only from trusted base workflow events", () => {
    expect(workflow.on).toEqual({
      pull_request_target: {
        types: ["opened", "reopened", "synchronize", "ready_for_review"],
      },
    });
    expect(workflow.permissions).toEqual({
      contents: "write",
      "pull-requests": "write",
    });
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job["timeout-minutes"]).toBe(5);
  });

  test("admits only same-repository trusted codex branches targeting main", () => {
    const condition = String(job.if);
    expect(condition).toContain("github.event.pull_request.base.ref == 'main'");
    expect(condition).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(condition).toContain(
      "startsWith(github.event.pull_request.head.ref, 'codex/')",
    );
    expect(condition).toContain("github.event.pull_request.draft == false");
    expect(condition).toContain('["OWNER","MEMBER","COLLABORATOR"]');
  });

  test("never loads PR code and enables protected merge for the event head only", () => {
    expect(steps).toHaveLength(1);
    expect(steps.every(step => step.uses === undefined)).toBeTrue();
    const step = steps[0];
    expect(step?.env).toEqual({
      GH_REPO: "${{ github.repository }}",
      GH_TOKEN: "${{ github.token }}",
      PR_HEAD_SHA: "${{ github.event.pull_request.head.sha }}",
      PR_URL: "${{ github.event.pull_request.html_url }}",
    });

    const run = String(step?.run);
    expect(run).toContain('gh pr merge "$PR_URL"');
    expect(run).toContain('--repo "$GH_REPO"');
    expect(run).toContain('--match-head-commit "$PR_HEAD_SHA"');
    expect(run).toContain("--auto");
    expect(run).toContain("--squash");
    expect(run).toContain("--delete-branch");
    expect(run).not.toContain("--admin");
    expect(source).not.toContain("actions/checkout");
    expect(source).not.toContain("pull_request.head.repo.clone_url");
  });
});
