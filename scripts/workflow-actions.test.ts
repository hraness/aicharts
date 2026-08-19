import { describe, expect, test } from "bun:test";
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDocument } from "yaml";

type JsonObject = Record<string, unknown>;
type WorkflowSource = Readonly<{ file: string; source: string }>;

const repositoryRoot = resolve(import.meta.dir, "..");
const workflowsDirectory = resolve(repositoryRoot, ".github/workflows");
const localReusableWorkflow = /^\.\/\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const remoteSegmentPattern = /^[A-Za-z0-9_.-]+$/u;

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as JsonObject;
}

function parseWorkflow(source: WorkflowSource): JsonObject {
  const document = parseDocument(source.source, {
    prettyErrors: true,
    uniqueKeys: true,
    version: "1.2",
  });
  if (document.errors.length > 0) {
    throw new TypeError(
      `${source.file} is not valid duplicate-free YAML: ${document.errors[0]?.message ?? "unknown parse error"}`,
    );
  }
  return object(document.toJS(), source.file);
}

function assertReference(
  value: unknown,
  context: string,
  kind: "job" | "step",
  workflowFiles: ReadonlySet<string>,
): number {
  if (typeof value !== "string") {
    throw new TypeError(`${context} must be a literal string.`);
  }
  if (value.startsWith("./")) {
    if (kind === "step") {
      throw new TypeError(
        `${context} uses a local action, which requires an explicit composite-action audit before it can be allowed.`,
      );
    }
    if (!localReusableWorkflow.test(value)) {
      throw new TypeError(`${context} is not a repository workflow path.`);
    }
    const target = value.slice(2);
    if (!workflowFiles.has(target)) {
      throw new TypeError(`${context} references missing workflow ${target}.`);
    }
    return 0;
  }
  const separator = value.lastIndexOf("@");
  const segments = separator > 0 ? value.slice(0, separator).split("/") : [];
  if (
    separator <= 0
    || !commitPattern.test(value.slice(separator + 1))
    || segments.length < 2
    || segments.some((segment) =>
      segment === "." || segment === ".." || !remoteSegmentPattern.test(segment))
  ) {
    throw new TypeError(
      `${context} must pin a nonlocal action or reusable workflow to one full lowercase 40-hex commit.`,
    );
  }
  return 1;
}

function assertCheckoutCredentials(step: JsonObject, context: string): void {
  if (
    typeof step.uses !== "string"
    || !step.uses.toLowerCase().startsWith("actions/checkout@")
  ) return;

  const inputs = step.with;
  if (
    typeof inputs !== "object"
    || inputs === null
    || Array.isArray(inputs)
    || (inputs as JsonObject)["persist-credentials"] !== false
  ) {
    throw new TypeError(
      `${context} must set with.persist-credentials to the boolean false.`,
    );
  }
}

function auditWorkflowSet(sources: readonly WorkflowSource[]): readonly string[] {
  const workflowFiles = new Set(sources.map(({ file }) => file));
  const remoteReferences: string[] = [];

  for (const source of sources) {
    const workflow = parseWorkflow(source);
    const jobs = object(workflow.jobs, `${source.file} jobs`);
    for (const [jobId, candidate] of Object.entries(jobs)) {
      const job = object(candidate, `${source.file} jobs.${jobId}`);
      if (Object.hasOwn(job, "uses")) {
        const remote = assertReference(
          job.uses,
          `${source.file} jobs.${jobId}.uses`,
          "job",
          workflowFiles,
        );
        if (remote === 1) remoteReferences.push(job.uses as string);
      }

      if (job.steps === undefined) continue;
      if (!Array.isArray(job.steps)) {
        throw new TypeError(`${source.file} jobs.${jobId}.steps must be an array.`);
      }
      for (const [index, candidateStep] of job.steps.entries()) {
        const step = object(
          candidateStep,
          `${source.file} jobs.${jobId}.steps[${String(index)}]`,
        );
        if (!Object.hasOwn(step, "uses")) continue;
        const remote = assertReference(
          step.uses,
          `${source.file} jobs.${jobId}.steps[${String(index)}].uses`,
          "step",
          workflowFiles,
        );
        if (remote === 1) remoteReferences.push(step.uses as string);
        assertCheckoutCredentials(
          step,
          `${source.file} jobs.${jobId}.steps[${String(index)}]`,
        );
      }
    }
  }

  if (remoteReferences.length === 0) {
    throw new TypeError("Workflow action audit found no semantic nonlocal references.");
  }
  return remoteReferences.toSorted();
}

async function repositoryWorkflowSources(): Promise<WorkflowSource[]> {
  const entries = await readdir(workflowsDirectory, { withFileTypes: true });
  const names = entries
    .filter(({ name }) => /\.ya?ml$/u.test(name))
    .map((entry) => {
      if (!entry.isFile()) {
        throw new TypeError(`${entry.name} must be a regular workflow file.`);
      }
      return entry.name;
    })
    .toSorted();

  return Promise.all(names.map(async (name) => {
    const path = resolve(workflowsDirectory, name);
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 1_048_576) {
      throw new TypeError(`${name} must be a bounded regular workflow file.`);
    }
    return {
      file: `.github/workflows/${name}`,
      source: await readFile(path, "utf8"),
    };
  }));
}

const commit = "1".repeat(40);
const pinned = `oven-sh/setup-bun@${commit}`;
const pinnedCheckout = `actions/checkout@${commit}`;

describe("workflow action supply chain", () => {
  test("pins every repository action and discards checkout credentials", async () => {
    expect(auditWorkflowSet(await repositoryWorkflowSources())).toEqual([
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
    ]);
  });

  test("recognizes block, flow, quoted, and reusable-workflow references", () => {
    const sources: WorkflowSource[] = [
      {
        file: ".github/workflows/caller.yml",
        source: `jobs:\n  block:\n    steps:\n      - uses: ${pinned}\n      - { "uses": ${pinned} }\n  remote:\n    uses: owner/repository/.github/workflows/check.yml@${commit}\n  local:\n    uses: ./.github/workflows/local.yaml\n`,
      },
      {
        file: ".github/workflows/local.yaml",
        source: "jobs:\n  check:\n    steps:\n      - run: true\n",
      },
    ];
    expect(auditWorkflowSet(sources)).toEqual([
      pinned,
      pinned,
      `owner/repository/.github/workflows/check.yml@${commit}`,
    ]);
  });

  test("rejects mutable, dynamic, non-string, local-step, and missing references", () => {
    const invalid = [
      "jobs:\n  test:\n    steps:\n      - { uses: actions/checkout@main }\n",
      "jobs:\n  test:\n    steps:\n      - \"uses\": ${{ matrix.action }}\n",
      "jobs:\n  test:\n    steps:\n      - uses: { owner: actions }\n",
      "jobs:\n  test:\n    steps:\n      - uses: ./action\n",
      "jobs:\n  test:\n    uses: ./.github/workflows/missing.yml\n",
      `jobs:\n  test:\n    steps:\n      - uses: owner/repository/../action@${commit}\n`,
    ];
    for (const source of invalid) {
      expect(() => auditWorkflowSet([
        { file: ".github/workflows/invalid.yml", source },
      ])).toThrow();
    }
  });

  test("requires boolean false for every case-equivalent checkout", () => {
    const invalid = [
      `jobs:\n  test:\n    steps:\n      - uses: ${pinnedCheckout}\n`,
      `jobs:\n  test:\n    steps:\n      - uses: Actions/Checkout@${commit}\n`,
      `jobs:\n  test:\n    steps:\n      - uses: ${pinnedCheckout}\n        with:\n          persist-credentials: "false"\n`,
      `jobs:\n  test:\n    steps:\n      - uses: ${pinnedCheckout}\n        with:\n          fetch-depth: 1\n`,
    ];
    for (const source of invalid) {
      expect(() => auditWorkflowSet([
        { file: ".github/workflows/invalid.yml", source },
      ])).toThrow("persist-credentials");
    }

    expect(auditWorkflowSet([{
      file: ".github/workflows/valid.yml",
      source: `jobs:\n  exact:\n    steps:\n      - uses: ${pinnedCheckout}\n        with:\n          persist-credentials: false\n  mixed-case:\n    steps:\n      - uses: Actions/Checkout@${commit}\n        with:\n          persist-credentials: false\n`,
    }])).toEqual([
      `Actions/Checkout@${commit}`,
      pinnedCheckout,
    ]);
  });

  test("ignores unrelated uses and rejects malformed, duplicate, invalid, and vacuous workflows", () => {
    expect(auditWorkflowSet([{
      file: ".github/workflows/valid.yml",
      source: `on:\n  workflow_call:\n    inputs:\n      uses:\n        type: string\nenv:\n  uses: ignored\njobs:\n  test:\n    steps:\n      - with:\n          uses: ignored\n        uses: ${pinned}\n`,
    }])).toEqual([pinned]);

    const invalid = [
      "jobs: [",
      "jobs:\n  test:\n    steps: []\n  test:\n    steps: []\n",
      "jobs:\n  test:\n    steps:\n      - run: true\n",
      "jobs:\n  test:\n    steps: invalid\n",
    ];
    for (const source of invalid) {
      expect(() => auditWorkflowSet([
        { file: ".github/workflows/invalid.yml", source },
      ])).toThrow();
    }
  });
});
