import { spawnSync } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
    force: true,
    recursive: true,
  })));
});

async function fakeInstallerEnvironment(
  options: Readonly<{
    contaminateDuringBuild?: boolean;
    injectUnknown?: boolean;
    mutateSourceDuringBuild?:
      | "injectedAdapter"
      | "ledgerAdapter"
      | "publicUpdater"
      | "sharedContract";
    sourceHashMismatch?: "ledgerAdapter" | "publicUpdater" | "sharedContract";
  }> = {},
): Promise<Readonly<{
  environment: NodeJS.ProcessEnv;
  installRoot: string;
  installedBinary: string;
  installerScript: string;
  log: string;
  root: string;
}>> {
  const root = await mkdtemp(path.join(tmpdir(), "aicharts-ledger-installer-test-"));
  temporaryRoots.push(root);
  const home = path.join(root, "home");
  const fakeBin = path.join(root, "bin");
  const installRoot = path.join(root, "install-root");
  const checkout = path.join(
    installRoot,
    "tokscale-0149a44329fb89865837dde40adb8cd9bc06bead",
  );
  const log = path.join(root, "commands.log");
  const fixtureRepository = path.join(root, "repository");
  const fixtureScripts = path.join(fixtureRepository, "scripts");
  const fixtureLib = path.join(fixtureRepository, "lib");
  const fixtureData = path.join(fixtureRepository, "data");
  const installerScript = path.join(fixtureScripts, "install-gpt-subsidy-ledger.sh");
  await mkdir(fakeBin, { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(fixtureScripts, { recursive: true });
  await mkdir(fixtureLib, { recursive: true });
  await mkdir(fixtureData, { recursive: true });
  await Promise.all([
    copyFile(
      path.join(import.meta.dir, "install-gpt-subsidy-ledger.sh"),
      installerScript,
    ),
    copyFile(
      path.join(import.meta.dir, "aicharts_gpt_subsidy_ledger.rs"),
      path.join(fixtureScripts, "aicharts_gpt_subsidy_ledger.rs"),
    ),
    copyFile(
      path.join(import.meta.dir, "update-gpt-subsidy.ts"),
      path.join(fixtureScripts, "update-gpt-subsidy.ts"),
    ),
    copyFile(
      path.join(import.meta.dir, "../lib/gpt-subsidy-manifests.ts"),
      path.join(fixtureLib, "gpt-subsidy-manifests.ts"),
    ),
    copyFile(
      path.join(import.meta.dir, "../data/gpt-subsidy-pricing.json"),
      path.join(fixtureData, "gpt-subsidy-pricing.json"),
    ),
    copyFile(
      path.join(import.meta.dir, "../data/gpt-subsidy-measurement.json"),
      path.join(fixtureData, "gpt-subsidy-measurement.json"),
    ),
  ]);
  await chmod(installerScript, 0o755);
  if (options.sourceHashMismatch !== undefined) {
    const fakeShasum = path.join(fakeBin, "shasum");
    await writeFile(fakeShasum, `#!/bin/sh
last=
for argument do last=$argument; done
case "$last" in
  *"$FAKE_HASH_MISMATCH_BASENAME")
    printf '%s  %s\\n' '0000000000000000000000000000000000000000000000000000000000000000' "$last"
    ;;
  *) exec /usr/bin/shasum "$@" ;;
esac
`, "utf8");
    await chmod(fakeShasum, 0o755);
  }

  const fakeGit = path.join(fakeBin, "git");
  await writeFile(fakeGit, `#!/bin/sh
printf 'git %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
case " $* " in
  *" clone "*)
    destination=
    for argument do destination=$argument; done
    mkdir -p "$destination/.git" \
      "$destination/crates/tokscale-core/examples" \
      "$destination/crates/tokscale-core/data"
    printf '%s\\n' 'version = "4.13.0"' > "$destination/Cargo.toml"
    printf '%s\\n' 'leftover adapter' > "$destination/crates/tokscale-core/examples/aicharts_gpt_subsidy_ledger.rs"
    printf '%s\\n' 'leftover pricing' > "$destination/crates/tokscale-core/data/gpt-subsidy-pricing.json"
    printf '%s\\n' 'leftover measurement' > "$destination/crates/tokscale-core/data/gpt-subsidy-measurement.json"
    if [ "$FAKE_INJECT_UNKNOWN" = "1" ]; then
      mkdir -p "$destination/.cargo"
      printf '%s\\n' '[build]' > "$destination/.cargo/config.toml"
    fi
    ;;
  *" remote get-url origin "*)
    printf '%s\\n' 'https://github.com/junhoyeo/tokscale.git'
    ;;
  *" diff --quiet "*|*" diff --cached --quiet "*|*" fetch "*|*" checkout "*)
    exit 0
    ;;
  *" rev-parse HEAD "*)
    printf '%s\\n' '0149a44329fb89865837dde40adb8cd9bc06bead'
    ;;
  *" status --porcelain=v1 --untracked-files=all --ignored "*)
    [ ! -e "$FAKE_CHECKOUT/.cargo/config.toml" ] || printf '%s\\n' '!! .cargo/config.toml'
    [ ! -e "$FAKE_CHECKOUT/crates/tokscale-core/examples/aicharts_gpt_subsidy_ledger.rs" ] \
      || printf '%s\\n' '?? crates/tokscale-core/examples/aicharts_gpt_subsidy_ledger.rs'
    [ ! -e "$FAKE_CHECKOUT/crates/tokscale-core/data/gpt-subsidy-pricing.json" ] \
      || printf '%s\\n' '?? crates/tokscale-core/data/gpt-subsidy-pricing.json'
    [ ! -e "$FAKE_CHECKOUT/crates/tokscale-core/data/gpt-subsidy-measurement.json" ] \
      || printf '%s\\n' '?? crates/tokscale-core/data/gpt-subsidy-measurement.json'
    ;;
  *)
    printf '%s\\n' "unexpected fake git command: $*" >&2
    exit 97
    ;;
esac
`, "utf8");
  await chmod(fakeGit, 0o755);

  const fakeCargo = path.join(fakeBin, "cargo");
  await writeFile(fakeCargo, `#!/bin/sh
printf 'cargo %s target=%s\\n' "$*" "$CARGO_TARGET_DIR" >> "$FAKE_COMMAND_LOG"
if [ "$1" = "build" ]; then
  destination="$CARGO_TARGET_DIR/release/examples/aicharts_gpt_subsidy_ledger"
  mkdir -p "$(dirname -- "$destination")"
  printf '%s\\n' '#!/bin/sh' 'exit 0' > "$destination"
  chmod 0755 "$destination"
  if [ -n "$FAKE_MUTATE_SOURCE_PATH" ]; then
    printf '%s\\n' '// deterministic concurrent mutation' >> "$FAKE_MUTATE_SOURCE_PATH"
  fi
  if [ "$FAKE_CONTAMINATE_DURING_BUILD" = "1" ]; then
    mkdir -p "$FAKE_CHECKOUT/.cargo"
    printf '%s\\n' '[build]' > "$FAKE_CHECKOUT/.cargo/config.toml"
  fi
fi
`, "utf8");
  await chmod(fakeCargo, 0o755);

  return {
    environment: {
      ...process.env,
      AICHARTS_GPT_SUBSIDY_INSTALL_ROOT: installRoot,
      FAKE_CONTAMINATE_DURING_BUILD: options.contaminateDuringBuild ? "1" : "0",
      FAKE_CHECKOUT: checkout,
      FAKE_COMMAND_LOG: log,
      FAKE_INJECT_UNKNOWN: options.injectUnknown ? "1" : "0",
      FAKE_MUTATE_SOURCE_PATH: options.mutateSourceDuringBuild === "injectedAdapter"
        ? path.join(checkout, "crates/tokscale-core/examples/aicharts_gpt_subsidy_ledger.rs")
        : options.mutateSourceDuringBuild === "ledgerAdapter"
          ? path.join(fixtureScripts, "aicharts_gpt_subsidy_ledger.rs")
          : options.mutateSourceDuringBuild === "publicUpdater"
            ? path.join(fixtureScripts, "update-gpt-subsidy.ts")
            : options.mutateSourceDuringBuild === "sharedContract"
              ? path.join(fixtureLib, "gpt-subsidy-manifests.ts")
              : "",
      FAKE_HASH_MISMATCH_BASENAME: options.sourceHashMismatch === "ledgerAdapter"
        ? "aicharts_gpt_subsidy_ledger.rs"
        : options.sourceHashMismatch === "publicUpdater"
          ? "update-gpt-subsidy.ts"
          : options.sourceHashMismatch === "sharedContract"
            ? "gpt-subsidy-manifests.ts"
            : "",
      HOME: home,
      PATH: `${fakeBin}:/usr/bin:/bin`,
    },
    installRoot,
    installedBinary: path.join(home, ".local/bin/aicharts-gpt-subsidy-ledger"),
    installerScript,
    log,
    root,
  };
}

describe("GPT subsidy ledger installer boundaries", () => {
  test("cleans only owned injected manifests and builds from a clean pinned checkout", async () => {
    const fixture = await fakeInstallerEnvironment();
    const result = spawnSync(fixture.installerScript, [], {
      encoding: "utf8",
      env: fixture.environment,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });

    expect(result.status).toBe(0);
    await access(fixture.installedBinary);
    const log = await readFile(fixture.log, "utf8");
    expect(log).toContain("-c core.hooksPath=/dev/null clone");
    expect(log).toContain("-c core.hooksPath=/dev/null -C");
    expect(log).toContain("cargo test");
    expect(log).toContain("cargo build");
    expect((await readdir(fixture.installRoot)).filter(name => name.startsWith("target-")))
      .toEqual([]);
  });

  test("rejects an ignored Cargo configuration before compiling", async () => {
    const fixture = await fakeInstallerEnvironment({ injectUnknown: true });
    const result = spawnSync(fixture.installerScript, [], {
      encoding: "utf8",
      env: fixture.environment,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing untracked or ignored files");
    expect(result.stderr).toContain(".cargo/config.toml");
    await expect(access(fixture.installedBinary)).rejects.toThrow();
    const log = await readFile(fixture.log, "utf8");
    expect(log).not.toContain("cargo test");
    expect(log).not.toContain("cargo build");
  });

  test("rejects implementation bytes outside the checked measurement identity", async () => {
    for (const [sourceHashMismatch, label] of [
      ["ledgerAdapter", "Ledger adapter"],
      ["publicUpdater", "Public updater"],
      ["sharedContract", "Shared subsidy contract"],
    ] as const) {
      const fixture = await fakeInstallerEnvironment({ sourceHashMismatch });
      const result = spawnSync(fixture.installerScript, [], {
        encoding: "utf8",
        env: fixture.environment,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `${label} bytes do not match measurement manifest identity`,
      );
      await expect(access(fixture.installedBinary)).rejects.toThrow();
    }
  });

  test("preserves the installed binary when a fresh build contaminates its checkout", async () => {
    const fixture = await fakeInstallerEnvironment({ contaminateDuringBuild: true });
    await mkdir(path.dirname(fixture.installedBinary), { recursive: true });
    await writeFile(fixture.installedBinary, "previous trusted binary\n", "utf8");
    const result = spawnSync(fixture.installerScript, [], {
      encoding: "utf8",
      env: fixture.environment,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("contaminated during the adapter build");
    expect(await readFile(fixture.installedBinary, "utf8")).toBe("previous trusted binary\n");
    expect((await readdir(fixture.installRoot)).filter(name => name.startsWith("target-")))
      .toEqual([]);
  });

  test("preserves the installed binary when verified inputs change during the build", async () => {
    for (const [mutateSourceDuringBuild, label] of [
      ["injectedAdapter", "Injected ledger adapter"],
      ["ledgerAdapter", "Ledger adapter"],
      ["publicUpdater", "Public updater"],
      ["sharedContract", "Shared subsidy contract"],
    ] as const) {
      const fixture = await fakeInstallerEnvironment({ mutateSourceDuringBuild });
      await mkdir(path.dirname(fixture.installedBinary), { recursive: true });
      await writeFile(fixture.installedBinary, "previous trusted binary\n", "utf8");

      const result = spawnSync(fixture.installerScript, [], {
        encoding: "utf8",
        env: fixture.environment,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `${label} bytes do not match measurement manifest identity`,
      );
      expect(await readFile(fixture.installedBinary, "utf8"))
        .toBe("previous trusted binary\n");
      expect(await readFile(fixture.log, "utf8")).toContain("cargo build");
      expect((await readdir(fixture.installRoot)).filter(name => name.startsWith("target-")))
        .toEqual([]);
    }
  }, 30_000);
});
