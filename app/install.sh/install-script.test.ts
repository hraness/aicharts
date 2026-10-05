import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { installScript } from "@/lib/install-script";
import { usageCliRelease } from "@/lib/usage-cli-release";

import { GET } from "./route";

const source = join(process.cwd(), "scripts/install.sh");
const version = usageCliRelease.version;
const root = `aicharts-${version}-x86_64-unknown-linux-gnu`;

// A stand-in aicharts: reports the pinned version and records history calls.
const fake = `#!/bin/sh
case "$*" in
  --version) echo "aicharts ${version} (fc8efdbe34e5)" ;;
  "history status --json")
    if [ -f "$HOME/on" ]; then echo '{"data":{"collecting":"every 6 hours"},"ok":true}'
    else echo '{"data":{"collecting":"off"},"ok":true}'; fi ;;
  "history enable") touch "$HOME/on"; echo enable >> "$HOME/calls" ;;
esac
`;

let work = "";
let archive = new Uint8Array();
let digest = "";
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "aicharts-install-test-")));
  const stage = join(work, "stage");
  mkdirSync(join(stage, root, "bin"), { recursive: true });
  writeFileSync(join(stage, root, "bin/aicharts"), fake, { mode: 0o755 });
  const tar = spawnSync("tar", ["-czf", join(work, `${root}.tar.gz`), "-C", stage, root]);
  expect(tar.status).toBe(0);
  archive = new Uint8Array(readFileSync(join(work, `${root}.tar.gz`)));
  digest = createHash("sha256").update(archive).digest("hex");
  // uname reports Linux x86_64 so the stand-in needs no Apple signature.
  mkdirSync(join(work, "shim"));
  writeFileSync(join(work, "shim/uname"), '#!/bin/sh\ncase "$1" in -s) echo Linux ;; -m) echo x86_64 ;; esac\n', { mode: 0o755 });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => new URL(request.url).pathname === `/${root}.tar.gz`
      ? new Response(archive)
      : new Response("missing", { status: 404 }),
  });
});

afterAll(() => {
  server?.stop(true);
  if (work) rmSync(work, { recursive: true, force: true });
});

async function install(home: string, env: Record<string, string> = {}) {
  mkdirSync(home, { recursive: true });
  const child = Bun.spawn(["/bin/sh", source], {
    env: {
      HOME: home,
      PATH: `${join(work, "shim")}:/usr/bin:/bin`,
      TMPDIR: work,
      AICHARTS_INSTALL_BASE_URL: `http://127.0.0.1:${server.port}`,
      AICHARTS_INSTALL_SHA256: digest,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const calls = existsSync(join(home, "calls")) ? readFileSync(join(home, "calls"), "utf8").trim().split("\n") : [];
  return { status, stdout, stderr, calls };
}

describe("aicharts.io/install.sh", () => {
  test("serves scripts/install.sh as plain text", async () => {
    const response = GET();
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe(readFileSync(source, "utf8"));
    expect(installScript.startsWith("#!/bin/sh\n")).toBe(true);
    expect(spawnSync("sh", ["-n", source]).status).toBe(0);
  });

  test("pins the published release and both archive digests", () => {
    expect(installScript).toContain(`\nAICHARTS_VERSION=${version}\n`);
    expect(installScript).toMatch(/\nAICHARTS_SHA256_DARWIN_AARCH64=[0-9a-f]{64}\n/u);
    expect(installScript).toMatch(/\nAICHARTS_SHA256_LINUX_X86_64=[0-9a-f]{64}\n/u);
    expect(installScript).toContain('identifier "dev.hraness.aicharts"');
    expect(installScript).toContain('leaf[subject.OU] = "8AAP53VTW3"');
    // Publishing stays a separate choice: the script never runs it.
    expect(installScript).not.toMatch(/"\$(installed|candidate|1)" (publish|enroll|setup)\b/u);
    expect(installScript).not.toContain("enroll");
  });

  test("a first install turns on local history once; a reinstall leaves the choice alone", async () => {
    const home = join(work, "first");
    const first = await install(home);
    expect(first.status).toBe(0);
    expect(existsSync(join(home, ".local/bin/aicharts"))).toBe(true);
    expect(first.stdout).toContain("Local usage history is on");
    expect(first.stdout).toContain(`aicharts ${version}`);
    expect(first.calls).toEqual(["enable"]);
    rmSync(join(home, "on"));
    const again = await install(home);
    expect(again.status).toBe(0);
    expect(again.calls).toEqual(["enable"]);
  });

  test("AICHARTS_USAGE_HISTORY=no installs with history off, into AICHARTS_INSTALL_DIR", async () => {
    const home = join(work, "off");
    const result = await install(home, { AICHARTS_USAGE_HISTORY: "no", AICHARTS_INSTALL_DIR: join(home, "tools") });
    expect(result.status).toBe(0);
    expect(existsSync(join(home, "tools/aicharts"))).toBe(true);
    expect(result.calls).toEqual([]);
    expect(result.stdout).toContain("Local usage history is off");
  });

  test("refuses a checksum mismatch, a remote test server and a relative directory", async () => {
    const mismatch = await install(join(work, "bad"), { AICHARTS_INSTALL_SHA256: "0".repeat(64) });
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain("checksum mismatch");
    expect(existsSync(join(work, "bad/.local/bin/aicharts"))).toBe(false);
    const remote = await install(join(work, "remote"), { AICHARTS_INSTALL_BASE_URL: "http://example.com:80" });
    expect(remote.status).toBe(1);
    expect(remote.stderr).toContain("loopback");
    const relative = await install(join(work, "relative"), { AICHARTS_INSTALL_DIR: "bin" });
    expect(relative.status).toBe(1);
    expect(relative.stderr).toContain("absolute path");
  });

  test("refuses an existing symlink at the install path", async () => {
    const home = join(work, "link");
    mkdirSync(join(home, ".local/bin"), { recursive: true });
    spawnSync("ln", ["-s", "/bin/sh", join(home, ".local/bin/aicharts")]);
    const result = await install(home);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("symlink");
  });
});
