import { spawn, spawnSync } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  assertDataOnlyCommit,
  candidateCheckEnvironment,
  canonicalRemote,
  checkCandidateRepository,
  checkCandidateSnapshot,
  createDataCommit,
  normalizeCommandOutput,
  publishCandidate,
  publisherEnvironment,
  statusPaths,
  verifyCurrentProduction,
  withTemporaryWorktree,
} from "./publish-gpt-subsidy";

const temporaryRoots: string[] = [];
const repositoryRoot = path.resolve(import.meta.dir, "..");

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed with ${String(result.status)}.\n`
      + `${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function commit(cwd: string, message: string): string {
  git(
    cwd,
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Publisher Test",
    "-c",
    "user.email=publisher-test@example.test",
    "commit",
    "-m",
    message,
  );
  return git(cwd, "rev-parse", "HEAD");
}

async function repositoryFixture(): Promise<Readonly<{
  competitor: string;
  initialHead: string;
  remote: string;
  root: string;
  source: string;
}>> {
  const root = await mkdtemp(path.join(tmpdir(), "aicharts-publisher-test-"));
  temporaryRoots.push(root);
  const remote = path.join(root, "remote.git");
  const source = path.join(root, "source");
  const competitor = path.join(root, "competitor");

  await mkdir(source);
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(source, "init", "--initial-branch=main");
  await writeFile(path.join(source, "tracked.txt"), "initial\n", "utf8");
  git(source, "add", "tracked.txt");
  const initialHead = commit(source, "Initial fixture");
  git(source, "remote", "add", "origin", remote);
  git(source, "push", "--set-upstream", "origin", "main");
  git(root, "clone", remote, competitor);

  return { competitor, initialHead, remote, root, source };
}

async function invalidSnapshotFixture(
  mutate: (snapshot: Record<string, unknown>) => void,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "aicharts-publisher-snapshot-test-"));
  temporaryRoots.push(root);
  const requiredPaths = [
    "data/gpt-subsidy-measurement.json",
    "data/gpt-subsidy-pricing.json",
    "lib/gpt-subsidy-data.ts",
    "lib/gpt-subsidy-manifests.ts",
    "lib/result.ts",
    "lib/schema.ts",
    "scripts/aicharts_gpt_subsidy_ledger.rs",
    "scripts/check-gpt-subsidy-data.ts",
    "scripts/update-gpt-subsidy.ts",
  ] as const;
  for (const relativePath of requiredPaths) {
    const destination = path.join(root, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(repositoryRoot, relativePath), destination);
  }
  const snapshot = JSON.parse(await readFile(
    path.join(repositoryRoot, "data/gpt-subsidy.json"),
    "utf8",
  )) as Record<string, unknown>;
  mutate(snapshot);
  await Promise.all([
    writeFile(
      path.join(root, "data/gpt-subsidy.json"),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({
        private: true,
        scripts: { "subsidy:check": "bun run scripts/check-gpt-subsidy-data.ts" },
        type: "module",
      }, null, 2)}\n`,
      "utf8",
    ),
    symlink(path.join(repositoryRoot, "node_modules"), path.join(root, "node_modules"), "dir"),
  ]);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
    force: true,
    recursive: true,
  })));
});

describe("GPT subsidy publisher boundaries", () => {
  test("keeps the dedicated-checkout launcher valid POSIX shell", () => {
    const script = path.join(import.meta.dir, "gpt-subsidy-automation.sh");
    const syntax = spawnSync("/bin/sh", ["-n", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    expect(syntax.status).toBe(0);
    expect(syntax.stderr).toBe("");

    const invalidMode = spawnSync(script, ["invalid"], {
      encoding: "utf8",
      env: { ...process.env, HOME: tmpdir() },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    expect(invalidMode.status).toBe(64);
    expect(invalidMode.stderr).toContain("Usage:");
  });

  test("recovers an incomplete lock without removing a live lock", async () => {
    try {
      await access("/usr/bin/lockf");
    } catch {
      return;
    }
    const root = await mkdtemp(path.join(tmpdir(), "aicharts-launcher-lock-test-"));
    temporaryRoots.push(root);
    const stateRoot = path.join(root, "state");
    const checkout = path.join(stateRoot, "repository");
    const fakeBin = path.join(root, "bin");
    const fakeGit = path.join(fakeBin, "git");
    const lockFile = path.join(stateRoot, "run.lock");
    await mkdir(path.join(checkout, ".git"), { recursive: true });
    await mkdir(fakeBin);
    await writeFile(fakeGit, `#!/bin/sh
if [ -n "\${AICHARTS_GPT_SUBSIDY_HOME:-}" ] \
  || [ -n "\${AICHARTS_SUBSIDY_VERIFY_URL:-}" ] \
  || [ -n "\${GPT_SUBSIDY_LEDGER_COMMAND:-}" ] \
  || [ -n "\${TOKSCALE_CONFIG_DIR:-}" ]; then
  printf '%s\\n' 'unsafe inherited publishing override' >&2
  exit 96
fi
case " $* " in
  *" remote get-url --all origin "*|*" remote get-url --push --all origin "*)
    printf '%s\\n' 'https://github.com/hraness/aicharts.git'
    ;;
  *" symbolic-ref --quiet --short HEAD "*) printf '%s\\n' 'main' ;;
  *" status --porcelain=v1 --untracked-files=all "*) exit 0 ;;
  *" rev-parse --verify HEAD^{commit} "*|*" rev-parse --verify refs/remotes/origin/main^{commit} "*)
    printf '%s\\n' '1111111111111111111111111111111111111111'
    ;;
  *" fetch "*|*" merge "*) exit 0 ;;
  *) printf '%s\\n' "unexpected fake git command: $*" >&2; exit 97 ;;
esac
`, "utf8");
    await chmod(fakeGit, 0o755);

    const script = path.join(import.meta.dir, "gpt-subsidy-automation.sh");
    const environment = {
      ...process.env,
      AICHARTS_SUBSIDY_LOCK_HELD: "1",
      AICHARTS_SUBSIDY_AUTOMATION_ROOT: stateRoot,
      AICHARTS_GPT_SUBSIDY_HOME: "/fixture/home",
      AICHARTS_SUBSIDY_VERIFY_URL: "https://fixture.invalid/",
      GPT_SUBSIDY_LEDGER_COMMAND: '["/fixture/ledger"]',
      HOME: root,
      PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      TOKSCALE_CONFIG_DIR: "/fixture/cache",
    };

    await writeFile(lockFile, "", "utf8");
    const recovered = spawnSync(script, ["prepare"], {
      encoding: "utf8",
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    expect(recovered.status).toBe(0);
    expect(await readFile(lockFile, "utf8")).toBe("");

    const holder = spawn(
      "/usr/bin/lockf",
      ["-k", lockFile, "/bin/sleep", "1"],
      { stdio: "ignore" },
    );
    try {
      let locked = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const probe = spawnSync(
          "/usr/bin/lockf",
          ["-k", "-s", "-t", "0", lockFile, "/usr/bin/true"],
          { stdio: "ignore", timeout: 1_000 },
        );
        if (probe.status === 75) {
          locked = true;
          break;
        }
        await Bun.sleep(25);
      }
      expect(locked).toBe(true);

      const contended = spawnSync(script, ["prepare"], {
        encoding: "utf8",
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
      });
      expect(contended.status).toBe(75);
      expect(contended.stderr).toContain("already running");
    } finally {
      if (holder.exitCode === null) {
        await new Promise<void>(resolve => holder.once("close", () => resolve()));
      }
    }
  });

  test("rejects a clean dedicated main checkout that is ahead of origin", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aicharts-launcher-ahead-test-"));
    temporaryRoots.push(root);
    const stateRoot = path.join(root, "state");
    const checkout = path.join(stateRoot, "repository");
    const fakeBin = path.join(root, "bin");
    const fakeGit = path.join(fakeBin, "git");
    await mkdir(path.join(checkout, ".git"), { recursive: true });
    await mkdir(fakeBin);
    await writeFile(fakeGit, `#!/bin/sh
case " $* " in
  *" remote get-url --all origin "*|*" remote get-url --push --all origin "*)
    printf '%s\\n' 'https://github.com/hraness/aicharts.git'
    ;;
  *" symbolic-ref --quiet --short HEAD "*) printf '%s\\n' 'main' ;;
  *" status --porcelain=v1 --untracked-files=all "*) exit 0 ;;
  *" fetch "*|*" merge "*) exit 0 ;;
  *" rev-parse --verify HEAD^{commit} "*)
    printf '%s\\n' '2222222222222222222222222222222222222222'
    ;;
  *" rev-parse --verify refs/remotes/origin/main^{commit} "*)
    printf '%s\\n' '1111111111111111111111111111111111111111'
    ;;
  *) printf '%s\\n' "unexpected fake git command: $*" >&2; exit 97 ;;
esac
`, "utf8");
    await chmod(fakeGit, 0o755);

    const script = path.join(import.meta.dir, "gpt-subsidy-automation.sh");
    const result = spawnSync(script, ["prepare"], {
      encoding: "utf8",
      env: {
        ...process.env,
        AICHARTS_SUBSIDY_AUTOMATION_ROOT: stateRoot,
        AICHARTS_SUBSIDY_LOCK_HELD: "1",
        HOME: root,
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    expect(result.status).toBe(65);
    expect(result.stderr).toContain("not exactly origin/main");
  });

  test("rejects a forged internal invocation without the kernel lock", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aicharts-launcher-forged-lock-test-"));
    temporaryRoots.push(root);
    const stateRoot = path.join(root, "state");
    await mkdir(stateRoot, { recursive: true });
    const script = path.join(import.meta.dir, "gpt-subsidy-automation.sh");
    const result = spawnSync(
      script,
      ["__aicharts_subsidy_locked", "prepare"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          AICHARTS_SUBSIDY_AUTOMATION_ROOT: stateRoot,
          HOME: root,
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
      },
    );
    expect(result.status).toBe(65);
    expect(result.stderr).toContain("Invalid internal GPT subsidy lock invocation");
  });

  test("rejects a forged inner descriptor while another process owns the lock", async () => {
    try {
      await access("/usr/bin/lockf");
    } catch {
      return;
    }
    const root = await mkdtemp(path.join(tmpdir(), "aicharts-launcher-owner-test-"));
    temporaryRoots.push(root);
    const stateRoot = path.join(root, "state");
    const lockFile = path.join(stateRoot, "run.lock");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(lockFile, "", "utf8");
    const holder = spawn(
      "/usr/bin/lockf",
      ["-k", lockFile, "/bin/sleep", "1"],
      { stdio: "ignore" },
    );
    try {
      let locked = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const probe = spawnSync(
          "/usr/bin/lockf",
          ["-k", "-s", "-t", "0", lockFile, "/usr/bin/true"],
          { stdio: "ignore", timeout: 1_000 },
        );
        if (probe.status === 75) {
          locked = true;
          break;
        }
        await Bun.sleep(25);
      }
      expect(locked).toBe(true);

      const descriptor = await open(lockFile, "a");
      try {
        const script = path.join(import.meta.dir, "gpt-subsidy-automation.sh");
        const forged = spawnSync(
          script,
          ["__aicharts_subsidy_locked", "prepare", "3"],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              AICHARTS_SUBSIDY_AUTOMATION_ROOT: stateRoot,
              HOME: root,
            },
            stdio: ["ignore", "pipe", "pipe", descriptor.fd],
            timeout: 10_000,
          },
        );
        expect(forged.status).toBe(65);
        expect(forged.stderr).toContain("does not own the publisher lock");
      } finally {
        await descriptor.close();
      }
    } finally {
      if (holder.exitCode === null) {
        await new Promise<void>(resolve => holder.once("close", () => resolve()));
      }
    }
  });

  test("removes publishing-only fixture overrides from child processes", () => {
    const environment = publisherEnvironment({
      AICHARTS_GPT_SUBSIDY_HOME: "/fixture/home",
      AICHARTS_SUBSIDY_VERIFY_URL: "https://fixture.invalid/",
      GPT_SUBSIDY_LEDGER_COMMAND: '["/fixture/ledger"]',
      NODE_ENV: "test",
      PATH: "/usr/bin:/bin",
      TOKSCALE_CONFIG_DIR: "/fixture/cache",
    });
    expect(environment).toEqual({ NODE_ENV: "test", PATH: "/usr/bin:/bin" });
  });

  test("uses the public Turnstile test key only for candidate repository checks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aicharts-publisher-check-env-test-"));
    temporaryRoots.push(root);
    await Promise.all([
      writeFile(path.join(root, "package.json"), `${JSON.stringify({
        private: true,
        scripts: { check: "bun run check-environment.ts" },
        type: "module",
      }, null, 2)}\n`, "utf8"),
      writeFile(path.join(root, "check-environment.ts"), `
if (process.env.NEXT_PUBLIC_HRANESS_MAILING_TURNSTILE_SITEKEY !== "1x00000000000000000000AA") {
  throw new Error("candidate check did not receive the public Turnstile test key");
}
`, "utf8"),
    ]);

    const source = {
      CI: "1",
      NEXT_PUBLIC_HRANESS_MAILING_TURNSTILE_SITEKEY: "invalid-parent-value",
      NODE_ENV: "test",
      PATH: process.env.PATH,
    } satisfies NodeJS.ProcessEnv;
    expect(candidateCheckEnvironment(source)).toEqual({
      ...source,
      NEXT_PUBLIC_HRANESS_MAILING_TURNSTILE_SITEKEY: "1x00000000000000000000AA",
    });
    checkCandidateRepository(root, source);
    expect(source.NEXT_PUBLIC_HRANESS_MAILING_TURNSTILE_SITEKEY)
      .toBe("invalid-parent-value");
  });

  test("requires production verification before accepting an unchanged series", async () => {
    const calls: Array<[string, string]> = [];
    await verifyCurrentProduction(
      "2026-08-25T00:17:00.000Z",
      "https://aicharts.io/gpt-subsidy",
      (generatedAt, verificationUrl) => {
        calls.push([generatedAt, verificationUrl]);
        return Promise.resolve();
      },
    );
    expect(calls).toEqual([[
      "2026-08-25T00:17:00.000Z",
      "https://aicharts.io/gpt-subsidy",
    ]]);

    await expect(verifyCurrentProduction(
      "2026-08-25T00:17:00.000Z",
      "https://aicharts.io/gpt-subsidy",
      () => Promise.reject(new Error("production mismatch")),
    )).rejects.toThrow("production mismatch");
  });

  test("rejects an invalid title before accepting a no-op candidate", async () => {
    const root = await invalidSnapshotFixture((snapshot) => {
      snapshot.title = "Subsidy estimate";
    });
    expect(() => checkCandidateSnapshot(root)).toThrow("GPT subsidy data is invalid");
  });

  test("rejects an unknown top-level key before accepting a no-op candidate", async () => {
    const root = await invalidSnapshotFixture((snapshot) => {
      snapshot.unexpected = "preserved by the updater";
    });
    expect(() => checkCandidateSnapshot(root)).toThrow("GPT subsidy data is invalid");
  });

  test("accepts only canonical AI Charts GitHub remotes", () => {
    for (const remote of [
      "https://github.com/hraness/aicharts.git",
      "https://github.com/hraness/aicharts/",
      "git@github.com:hraness/aicharts.git",
      "ssh://git@github.com/hraness/aicharts.git",
    ]) {
      expect(canonicalRemote(remote)).toBe(true);
    }

    for (const remote of [
      "https://github.com/another/aicharts.git",
      "https://github.example/hraness/aicharts.git",
      "https://github.com@evil.example/hraness/aicharts.git",
      "https://github.com/hraness/aicharts.git?write=elsewhere",
      "file:///tmp/aicharts",
      "",
    ]) {
      expect(canonicalRemote(remote)).toBe(false);
    }
  });

  test("extracts only paths from porcelain status rows", () => {
    expect(statusPaths("")).toEqual([]);
    const commandOutput = normalizeCommandOutput(
      " M data/gpt-subsidy.json\n?? unexpected.txt\n",
    );
    expect(commandOutput.startsWith(" M ")).toBeTrue();
    expect(statusPaths(commandOutput))
      .toEqual(["data/gpt-subsidy.json", "unexpected.txt"]);
  });

  test("detects a main race without dirtying or advancing the source checkout", async () => {
    const fixture = await repositoryFixture();
    const worktreeBase = path.join(fixture.root, "worktrees");
    let temporaryParent = "";

    await withTemporaryWorktree({
      operation: async (worktree) => {
        temporaryParent = path.dirname(worktree);
        await writeFile(path.join(worktree, "candidate.txt"), "candidate\n", "utf8");
        git(worktree, "add", "candidate.txt");
        const candidateCommit = commit(worktree, "Candidate update");

        await writeFile(
          path.join(fixture.competitor, "competitor.txt"),
          "concurrent update\n",
          "utf8",
        );
        git(fixture.competitor, "add", "competitor.txt");
        const competitorCommit = commit(fixture.competitor, "Concurrent update");
        git(fixture.competitor, "push", "origin", "main");

        expect(publishCandidate({
          candidateCommit,
          candidateWorktree: worktree,
          remoteHead: fixture.initialHead,
          repositoryRoot: fixture.source,
        })).toBe("raced");
        expect(git(fixture.remote, "rev-parse", "refs/heads/main"))
          .toBe(competitorCommit);
      },
      repositoryRoot: fixture.source,
      revision: fixture.initialHead,
      temporaryBaseDirectory: worktreeBase,
    });

    expect(git(fixture.source, "rev-parse", "HEAD")).toBe(fixture.initialHead);
    expect(git(fixture.source, "status", "--porcelain=v1", "--untracked-files=all"))
      .toBe("");
    expect(git(fixture.source, "worktree", "list", "--porcelain"))
      .not.toContain(temporaryParent);
    await expect(access(temporaryParent)).rejects.toThrow();
  }, 15_000);

  test("publishes the candidate commit while leaving the source checkout untouched", async () => {
    const fixture = await repositoryFixture();
    const worktreeBase = path.join(fixture.root, "successful-worktrees");
    let candidateCommit = "";

    await withTemporaryWorktree({
      operation: async (worktree) => {
        await writeFile(path.join(worktree, "candidate.txt"), "candidate\n", "utf8");
        git(worktree, "add", "candidate.txt");
        candidateCommit = commit(worktree, "Candidate update");
        expect(publishCandidate({
          candidateCommit,
          candidateWorktree: worktree,
          remoteHead: fixture.initialHead,
          repositoryRoot: fixture.source,
        })).toBe("published");
      },
      repositoryRoot: fixture.source,
      revision: fixture.initialHead,
      temporaryBaseDirectory: worktreeBase,
    });

    expect(git(fixture.remote, "rev-parse", "refs/heads/main"))
      .toBe(candidateCommit);
    expect(git(fixture.source, "rev-parse", "HEAD")).toBe(fixture.initialHead);
    expect(git(fixture.source, "status", "--porcelain=v1", "--untracked-files=all"))
      .toBe("");
  }, 15_000);

  test("bypasses repository hooks and attests the automation commit boundary", async () => {
    const fixture = await repositoryFixture();
    const worktreeBase = path.join(fixture.root, "hook-worktrees");
    const hooks = path.join(fixture.root, "hooks");
    const hookMarker = path.join(fixture.root, "hook-ran");
    await mkdir(hooks);
    for (const name of ["pre-commit", "commit-msg", "post-commit", "pre-push"]) {
      const hook = path.join(hooks, name);
      await writeFile(
        hook,
        `#!/bin/sh\nprintf '%s\\n' '${name}' >> '${hookMarker}'\nexit 91\n`,
        "utf8",
      );
      await chmod(hook, 0o755);
    }
    git(fixture.source, "config", "core.hooksPath", hooks);

    let candidateCommit = "";
    await withTemporaryWorktree({
      operation: async (worktree) => {
        await mkdir(path.join(worktree, "data"));
        await writeFile(
          path.join(worktree, "data/gpt-subsidy.json"),
          '{"generatedAt":"2026-08-25T00:17:00.000Z"}\n',
          "utf8",
        );
        candidateCommit = createDataCommit({
          generatedAt: "2026-08-25T00:17:00.000Z",
          remoteHead: fixture.initialHead,
          worktree,
        });
        assertDataOnlyCommit({
          commit: candidateCommit,
          expectedParent: fixture.initialHead,
          worktree,
        });
        expect(git(
          worktree,
          "diff-tree",
          "--no-commit-id",
          "--name-only",
          "-r",
          candidateCommit,
        )).toBe("data/gpt-subsidy.json");
        expect(publishCandidate({
          candidateCommit,
          candidateWorktree: worktree,
          remoteHead: fixture.initialHead,
          repositoryRoot: fixture.source,
        })).toBe("published");
      },
      repositoryRoot: fixture.source,
      revision: fixture.initialHead,
      temporaryBaseDirectory: worktreeBase,
    });

    await expect(access(hookMarker)).rejects.toThrow();
    expect(git(fixture.remote, "rev-parse", "refs/heads/main")).toBe(candidateCommit);
  }, 15_000);

  test("rejects an automation commit with any additional path or parent", async () => {
    const fixture = await repositoryFixture();
    const worktreeBase = path.join(fixture.root, "attestation-worktrees");

    await withTemporaryWorktree({
      operation: async (worktree) => {
        await mkdir(path.join(worktree, "data"));
        await writeFile(path.join(worktree, "data/gpt-subsidy.json"), "{}\n", "utf8");
        await writeFile(path.join(worktree, "unexpected.txt"), "unexpected\n", "utf8");
        git(worktree, "add", "data/gpt-subsidy.json", "unexpected.txt");
        const candidateCommit = commit(worktree, "Unsafe candidate");

        expect(() => assertDataOnlyCommit({
          commit: candidateCommit,
          expectedParent: fixture.initialHead,
          worktree,
        })).toThrow("outside data/gpt-subsidy.json");
        expect(() => assertDataOnlyCommit({
          commit: candidateCommit,
          expectedParent: "0000000000000000000000000000000000000000",
          worktree,
        })).toThrow("must have exactly");
      },
      repositoryRoot: fixture.source,
      revision: fixture.initialHead,
      temporaryBaseDirectory: worktreeBase,
    });
  }, 15_000);

  test("removes the temporary worktree after a candidate operation fails", async () => {
    const fixture = await repositoryFixture();
    const worktreeBase = path.join(fixture.root, "failure-worktrees");
    let temporaryParent = "";

    await expect(withTemporaryWorktree({
      operation: (worktree) => {
        temporaryParent = path.dirname(worktree);
        throw new Error("deliberate candidate failure");
      },
      repositoryRoot: fixture.source,
      revision: fixture.initialHead,
      temporaryBaseDirectory: worktreeBase,
    })).rejects.toThrow("deliberate candidate failure");

    expect(git(fixture.source, "worktree", "list", "--porcelain"))
      .not.toContain(temporaryParent);
    expect(await readdir(worktreeBase)).toEqual([]);
  }, 15_000);
});
