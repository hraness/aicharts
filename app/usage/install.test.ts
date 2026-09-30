import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { usageLinuxInstallCommand } from "./install";
import { usageLinuxArchive, usageLinuxDirectory, usageReleaseTag } from "@/lib/usage-cli-release";

const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });

function runInstall(failure?: string, existing = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aicharts-install-command-")));
  scratch.push(root);
  const tools = join(root, "tools");
  const log = join(root, "calls");
  mkdirSync(tools);
  writeFileSync(log, "");
  writeFileSync(join(tools, "gh"), `#!/bin/sh
printf '%s\\n' "$*" >> "$INSTALL_TEST_LOG"
if [ "$1" = release ]; then
  [ "$INSTALL_TEST_FAILURE" != download ] || exit 7
  touch ${usageLinuxArchive} aicharts-source.tar.gz aicharts-skill.tar.gz release-manifest.json SHA256SUMS
else
  [ "$INSTALL_TEST_FAILURE" != "$3" ] || exit 8
fi
`, { mode: 0o755 });
  writeFileSync(join(tools, "sha256sum"), `#!/bin/sh
printf '%s\\n' checksum >> "$INSTALL_TEST_LOG"
[ "$INSTALL_TEST_FAILURE" != checksum ]
`, { mode: 0o755 });
  writeFileSync(join(tools, "tar"), `#!/bin/sh
printf '%s\\n' extract >> "$INSTALL_TEST_LOG"
mkdir -p ${usageLinuxDirectory}/bin
`, { mode: 0o755 });
  if (existing) mkdirSync(join(root, `aicharts-${usageReleaseTag}`));
  const result = spawnSync("/bin/sh", ["-c", `${usageLinuxInstallCommand} && printf '%s' "$PATH"`], {
    cwd: root,
    env: { ...process.env, PATH: `${tools}:${process.env.PATH ?? "/usr/bin:/bin"}`, INSTALL_TEST_LOG: log, INSTALL_TEST_FAILURE: failure ?? "" },
    encoding: "utf8",
  });
  return { root, result, calls: readFileSync(log, "utf8").trim().split("\n").filter(Boolean) };
}

test("Linux install verifies all assets before extraction and only adds the new binary directory to PATH", () => {
  const { root, result, calls } = runInstall();
  expect(result.status).toBe(0);
  expect(calls[0]).toBe(`release download ${usageReleaseTag} --repo hraness/aicharts`);
  expect(calls[1]).toBe("checksum");
  expect(calls.slice(2, -1)).toHaveLength(4);
  for (const call of calls.slice(2, -1)) {
    expect(call).toContain("attestation verify ");
    expect(call).toContain("--signer-workflow hraness/aicharts/.github/workflows/cli-publish.yml --deny-self-hosted-runners");
  }
  expect(calls.at(-1)).toBe("extract");
  expect(result.stdout).toStartWith(`${root}/aicharts-${usageReleaseTag}/${usageLinuxDirectory}/bin:`);
});

for (const failure of ["download", "checksum", usageLinuxArchive, "aicharts-skill.tar.gz", "aicharts-source.tar.gz", "release-manifest.json"]) {
  test(`Linux install stops before extraction or PATH changes when ${failure} fails`, () => {
    const { result, calls } = runInstall(failure);
    expect(result.status).not.toBe(0);
    expect(calls).not.toContain("extract");
    expect(result.stdout).toBe("");
  });
}

test("Linux install refuses an existing directory before downloading", () => {
  const { result, calls } = runInstall(undefined, true);
  expect(result.status).not.toBe(0);
  expect(calls).toEqual([]);
  expect(result.stdout).toBe("");
});
