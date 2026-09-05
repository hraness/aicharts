import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const defaultRepositoryRoot = path.resolve(import.meta.dir, "..");
const dataPath = "data/gpt-subsidy.json";
const defaultVerificationUrl = "https://aicharts.io/gpt-subsidy";
const temporaryDirectoryPrefix = "aicharts-subsidy-publish-";
const gitTimeoutMs = 2 * 60_000;
const installTimeoutMs = 10 * 60_000;
const updateTimeoutMs = 18 * 60_000;
const snapshotCheckTimeoutMs = 2 * 60_000;
const checkTimeoutMs = 20 * 60_000;
const verificationTimeoutMs = 4 * 60_000;
const publishAttempts = 3;
const turnstileAlwaysPassSitekey = "1x00000000000000000000AA";

type RunOptions = Readonly<{
  allowFailure?: boolean;
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}>;

type TemporaryWorktree = Readonly<{
  parent: string;
  worktree: string;
}>;

type Candidate = TemporaryWorktree & Readonly<{
  commit: string | null;
  generatedAt: string;
}>;

export type PublishCandidateInput = Readonly<{
  candidateCommit: string;
  candidateWorktree: string;
  remoteHead: string;
  repositoryRoot: string;
}>;

export function publisherEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = { ...source };
  for (const name of [
    "AICHARTS_GPT_SUBSIDY_HOME",
    "AICHARTS_SUBSIDY_VERIFY_URL",
    "GPT_SUBSIDY_LEDGER_COMMAND",
    "TOKSCALE_CONFIG_DIR",
  ]) {
    delete environment[name];
  }
  return environment;
}

const noninteractiveEnvironment = {
  ...publisherEnvironment(),
  BUN_INSTALL_VERBOSE: "0",
  CI: "1",
  GCM_INTERACTIVE: "Never",
  GIT_ASKPASS: "/usr/bin/false",
  GIT_EDITOR: "true",
  GIT_SEQUENCE_EDITOR: "true",
  GIT_SSH_COMMAND: "ssh -oBatchMode=yes -oConnectTimeout=15",
  GIT_TERMINAL_PROMPT: "0",
  NO_COLOR: "1",
  SSH_ASKPASS: "/usr/bin/false",
} as const;

export function candidateCheckEnvironment(
  source: NodeJS.ProcessEnv = noninteractiveEnvironment,
): NodeJS.ProcessEnv {
  return {
    ...source,
    NEXT_PUBLIC_HRANESS_MAILING_TURNSTILE_SITEKEY:
      turnstileAlwaysPassSitekey,
  };
}

function commandResult(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    cwd: options.cwd ?? defaultRepositoryRoot,
    encoding: "utf8",
    env: options.environment ?? noninteractiveEnvironment,
    killSignal: "SIGTERM",
    maxBuffer: 32 * 1_024 * 1_024,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeoutMs ?? gitTimeoutMs,
  });
}

function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): string {
  const result = commandResult(command, args, options);
  if (result.error !== undefined) {
    throw new Error(`Could not run ${command}: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0 && options.allowFailure !== true) {
    const signal = result.signal === null ? "" : ` after signal ${result.signal}`;
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${String(result.status)}`
      + `${signal}.\n${result.stdout}${result.stderr}`,
    );
  }
  return normalizeCommandOutput(result.stdout);
}

export function normalizeCommandOutput(source: string): string {
  return source.trimEnd();
}

function nonemptyLines(source: string): string[] {
  return source.split("\n").map(line => line.trim()).filter(Boolean);
}

export function statusPaths(source: string): string[] {
  if (source.trim() === "") return [];
  return source.split("\n").map(line => line.slice(3));
}

export function canonicalRemote(remote: string): boolean {
  const value = remote.trim();
  return [
    /^https:\/\/github\.com\/hraness\/aicharts(?:\.git)?\/?$/u,
    /^git@github\.com:hraness\/aicharts(?:\.git)?$/u,
    /^ssh:\/\/git@github\.com\/hraness\/aicharts(?:\.git)?\/?$/u,
  ].some(pattern => pattern.test(value));
}

function requireCanonicalOrigin(repositoryRoot: string): void {
  if (run("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: repositoryRoot,
  }) !== "true") {
    throw new Error("Subsidy publishing requires a Git worktree.");
  }

  const fetchUrls = nonemptyLines(run(
    "git",
    ["remote", "get-url", "--all", "origin"],
    { cwd: repositoryRoot },
  ));
  const pushUrls = nonemptyLines(run(
    "git",
    ["remote", "get-url", "--push", "--all", "origin"],
    { cwd: repositoryRoot },
  ));
  if (
    fetchUrls.length !== 1
    || pushUrls.length !== 1
    || !canonicalRemote(fetchUrls[0] ?? "")
    || !canonicalRemote(pushUrls[0] ?? "")
  ) {
    throw new Error(
      "Refusing to publish unless origin has exactly one canonical hraness/aicharts "
      + `fetch URL and push URL; found ${String(fetchUrls.length)} fetch URL(s) and `
      + `${String(pushUrls.length)} push URL(s).`,
    );
  }
}

function fetchMain(repositoryRoot: string): void {
  run(
    "git",
    [
      "fetch",
      "--no-tags",
      "--prune",
      "--no-recurse-submodules",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ],
    { cwd: repositoryRoot },
  );
}

function remoteMain(repositoryRoot: string): string {
  return run("git", ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"], {
    cwd: repositoryRoot,
  });
}

function assertOwnedTemporaryParent(parent: string, base: string): void {
  const resolvedParent = path.resolve(parent);
  const resolvedBase = path.resolve(base);
  if (
    path.dirname(resolvedParent) !== resolvedBase
    || !path.basename(resolvedParent).startsWith(temporaryDirectoryPrefix)
  ) {
    throw new Error(`Refusing to remove unowned temporary path ${resolvedParent}.`);
  }
}

async function removeTemporaryWorktree(
  repositoryRoot: string,
  temporary: TemporaryWorktree,
  base: string,
): Promise<void> {
  assertOwnedTemporaryParent(temporary.parent, base);
  commandResult(
    "git",
    ["worktree", "remove", "--force", temporary.worktree],
    { allowFailure: true, cwd: repositoryRoot },
  );
  await rm(temporary.parent, { force: true, recursive: true });
  commandResult(
    "git",
    ["worktree", "prune", "--expire", "now"],
    { allowFailure: true, cwd: repositoryRoot },
  );
}

async function createTemporaryWorktree(
  repositoryRoot: string,
  revision: string,
  base = tmpdir(),
): Promise<TemporaryWorktree> {
  await mkdir(base, { recursive: true });
  const parent = await mkdtemp(path.join(base, temporaryDirectoryPrefix));
  const temporary = { parent, worktree: path.join(parent, "worktree") } as const;
  try {
    run(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "worktree",
        "add",
        "--detach",
        temporary.worktree,
        revision,
      ],
      { cwd: repositoryRoot },
    );
    return temporary;
  } catch (cause) {
    await removeTemporaryWorktree(repositoryRoot, temporary, base);
    throw cause;
  }
}

export async function withTemporaryWorktree<T>(input: Readonly<{
  operation: (worktree: string) => Promise<T> | T;
  repositoryRoot: string;
  revision: string;
  temporaryBaseDirectory?: string;
}>): Promise<T> {
  const base = input.temporaryBaseDirectory ?? tmpdir();
  const temporary = await createTemporaryWorktree(
    input.repositoryRoot,
    input.revision,
    base,
  );
  try {
    return await input.operation(temporary.worktree);
  } finally {
    await removeTemporaryWorktree(input.repositoryRoot, temporary, base);
  }
}

async function buildCandidate(
  repositoryRoot: string,
  remoteHead: string,
): Promise<Candidate> {
  const temporary = await createTemporaryWorktree(repositoryRoot, remoteHead);
  try {
    run(process.execPath, ["install", "--frozen-lockfile"], {
      cwd: temporary.worktree,
      timeoutMs: installTimeoutMs,
    });
    run(process.execPath, ["run", "scripts/update-gpt-subsidy.ts"], {
      cwd: temporary.worktree,
      timeoutMs: updateTimeoutMs,
    });
    run(process.execPath, [
      "run",
      "scripts/enrich-gpt-subsidy-attribution.ts",
    ], {
      cwd: temporary.worktree,
      timeoutMs: snapshotCheckTimeoutMs,
    });
    checkCandidateSnapshot(temporary.worktree);
    const changed = statusPaths(run(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: temporary.worktree },
    ));
    const generatedAt = await readGeneratedAt(temporary.worktree);
    if (changed.length === 0) {
      return { ...temporary, commit: null, generatedAt };
    }
    if (changed.length !== 1 || changed[0] !== dataPath) {
      throw new Error(`Collector changed files outside ${dataPath}: ${changed.join(", ")}.`);
    }

    checkCandidateRepository(temporary.worktree);
    const afterCheck = statusPaths(run(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: temporary.worktree },
    ));
    if (afterCheck.length !== 1 || afterCheck[0] !== dataPath) {
      throw new Error(`Repository checks changed unexpected files: ${afterCheck.join(", ")}.`);
    }

    const commit = createDataCommit({
      generatedAt,
      remoteHead,
      worktree: temporary.worktree,
    });
    return { ...temporary, commit, generatedAt };
  } catch (cause) {
    await removeTemporaryWorktree(repositoryRoot, temporary, tmpdir());
    throw cause;
  }
}

export function checkCandidateSnapshot(worktree: string): void {
  run(process.execPath, ["run", "subsidy:check"], {
    cwd: worktree,
    timeoutMs: snapshotCheckTimeoutMs,
  });
}

export function checkCandidateRepository(
  worktree: string,
  source: NodeJS.ProcessEnv = noninteractiveEnvironment,
): void {
  run(process.execPath, ["run", "check"], {
    cwd: worktree,
    environment: candidateCheckEnvironment(source),
    timeoutMs: checkTimeoutMs,
  });
}

async function readGeneratedAt(worktree: string): Promise<string> {
  const parsed: unknown = JSON.parse(await readFile(
    path.join(worktree, dataPath),
    "utf8",
  ));
  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
    || typeof (parsed as Record<string, unknown>).generatedAt !== "string"
  ) {
    throw new TypeError("Updated GPT subsidy data has no generatedAt timestamp.");
  }
  const generatedAt = (parsed as Record<string, unknown>).generatedAt as string;
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new TypeError("Updated GPT subsidy data has an invalid generatedAt timestamp.");
  }
  return generatedAt;
}

export function assertDataOnlyCommit(input: Readonly<{
  commit: string;
  expectedParent: string;
  worktree: string;
}>): void {
  const ancestry = run(
    "git",
    ["rev-list", "--parents", "-n", "1", input.commit],
    { cwd: input.worktree },
  ).split(/\s+/u);
  if (
    ancestry.length !== 2
    || ancestry[0] !== input.commit
    || ancestry[1] !== input.expectedParent
  ) {
    throw new Error(
      `Automation commit ${input.commit} must have exactly ${input.expectedParent} as its parent.`,
    );
  }

  const paths = nonemptyLines(run(
    "git",
    ["diff-tree", "--no-commit-id", "--name-only", "-r", input.commit],
    { cwd: input.worktree },
  ));
  if (paths.length !== 1 || paths[0] !== dataPath) {
    throw new Error(
      `Automation commit ${input.commit} changed files outside ${dataPath}: ${paths.join(", ")}.`,
    );
  }

  const status = statusPaths(run(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: input.worktree },
  ));
  if (status.length !== 0) {
    throw new Error(`Automation worktree remained dirty after commit: ${status.join(", ")}.`);
  }
}

export function createDataCommit(input: Readonly<{
  generatedAt: string;
  remoteHead: string;
  worktree: string;
}>): string {
  run("git", ["add", "--", dataPath], { cwd: input.worktree });
  run(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=AI Charts Data Automation",
      "-c",
      "user.email=automation@aicharts.io",
      "commit",
      "--no-verify",
      "-m",
      `Update GPT subsidy observation ${input.generatedAt.slice(0, 10)}`,
    ],
    { cwd: input.worktree },
  );
  const commit = run("git", ["rev-parse", "HEAD"], { cwd: input.worktree });
  assertDataOnlyCommit({
    commit,
    expectedParent: input.remoteHead,
    worktree: input.worktree,
  });
  return commit;
}

export function publishCandidate(input: PublishCandidateInput): "published" | "raced" {
  fetchMain(input.repositoryRoot);
  if (remoteMain(input.repositoryRoot) !== input.remoteHead) return "raced";

  const push = commandResult(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "push",
      "--porcelain",
      "origin",
      `${input.candidateCommit}:refs/heads/main`,
    ],
    { cwd: input.candidateWorktree },
  );
  if (push.error !== undefined) {
    throw new Error(`Could not run git push: ${push.error.message}`, { cause: push.error });
  }
  if (push.status === 0) return "published";

  fetchMain(input.repositoryRoot);
  if (remoteMain(input.repositoryRoot) !== input.remoteHead) return "raced";
  throw new Error(
    `git push origin ${input.candidateCommit}:refs/heads/main failed with exit code `
    + `${String(push.status)}.\n${push.stdout}${push.stderr}`,
  );
}

export async function verifyLive(
  generatedAt: string,
  verificationUrl: string,
): Promise<void> {
  const deadline = Date.now() + verificationTimeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      const response = await fetch(verificationUrl, {
        cache: "no-store",
        headers: { "user-agent": "aicharts-subsidy-publisher/1" },
        redirect: "follow",
        signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, remaining))),
      });
      const html = await response.text();
      if (
        response.ok
        && html.includes("Subsidy for ChatGPT Pro 20x subscription")
        && html.includes(generatedAt)
      ) return;
    } catch {
      // A just-pushed production deployment may not be routable yet.
    }
    const delay = Math.min(10_000, deadline - Date.now());
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new Error(
    `The production subsidy page at ${verificationUrl} did not expose `
    + `${generatedAt} within four minutes.`,
  );
}

export async function verifyCurrentProduction(
  generatedAt: string,
  verificationUrl: string,
  verifier: (generatedAt: string, verificationUrl: string) => Promise<void> = verifyLive,
): Promise<void> {
  await verifier(generatedAt, verificationUrl);
}

async function main(): Promise<void> {
  const repositoryRoot = defaultRepositoryRoot;
  const verificationUrl = defaultVerificationUrl;
  requireCanonicalOrigin(repositoryRoot);

  for (let attempt = 1; attempt <= publishAttempts; attempt += 1) {
    fetchMain(repositoryRoot);
    const remoteHead = remoteMain(repositoryRoot);
    const candidate = await buildCandidate(repositoryRoot, remoteHead);
    try {
      if (candidate.commit === null) {
        await verifyCurrentProduction(candidate.generatedAt, verificationUrl);
        process.stdout.write(
          "The deduplicated GPT subsidy series is already current and verified in production.\n",
        );
        return;
      }

      const result = publishCandidate({
        candidateCommit: candidate.commit,
        candidateWorktree: candidate.worktree,
        remoteHead,
        repositoryRoot,
      });
      if (result === "raced") {
        if (attempt === publishAttempts) {
          throw new Error("origin/main kept advancing during subsidy publication.");
        }
        continue;
      }

      await verifyLive(candidate.generatedAt, verificationUrl);
      process.stdout.write(
        `Published and verified GPT subsidy data generated at ${candidate.generatedAt}.\n`,
      );
      return;
    } finally {
      await removeTemporaryWorktree(repositoryRoot, candidate, tmpdir());
    }
  }
}

if (import.meta.main) {
  await main();
}
