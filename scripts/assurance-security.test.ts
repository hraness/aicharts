import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkCargoLock, checkPackagePins, checkPrivacyCanary, checkWorkflowPins, parseBunAudit, parseBunLock, parseCargoAudit,
  parseSecurityOptions, scanSecrets, securityEnvironment, type TrackedFile } from "./assurance-security";
import type { ProofProcess } from "./assurance-proof-common";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const processResult = (output: string, overrides: Partial<ProofProcess> = {}): ProofProcess => ({ command: "tool", args: [],
  exitCode: 0, signal: null, timedOut: false, outputExceeded: false, output, elapsedMs: 1, ...overrides });
const rules = (findings: readonly { rule: string }[]) => findings.map(finding => finding.rule).sort();
// Built at runtime so the repository scan never sees a credential-shaped literal.
const fake = (prefix: string, length: number) => prefix + "A1b2".repeat(Math.ceil(length / 4)).slice(0, length);

describe("options and environment", () => {
  test("only --allow-missing-tools is accepted", () => {
    expect(parseSecurityOptions([])).toEqual({ allowMissingTools: false });
    expect(parseSecurityOptions(["--allow-missing-tools"])).toEqual({ allowMissingTools: true });
    expect(() => parseSecurityOptions(["extra"])).toThrow();
    expect(() => parseSecurityOptions(["--iterations", "5"])).toThrow();
  });
  test("environment drops credentials and prepends the cargo bin directory", () => {
    const environment = securityEnvironment({ PATH: "/bin", HOME: "/home/x", POSTHOG_API_KEY: "never", CLOUDFLARE_API_TOKEN: "never", CI: "true" });
    expect(environment).toEqual({ NODE_ENV: "test", HOME: "/home/x", CI: "true", PATH: `/home/x/.cargo/bin:/bin`, NO_COLOR: "1", FORCE_COLOR: "0" });
    expect(securityEnvironment({ PATH: "/bin", CARGO_HOME: "/cargo" }).PATH).toBe("/cargo/bin:/bin");
  });
});

describe("dependency pins", () => {
  const manifest = JSON.parse(read("package.json")) as Parameters<typeof checkPackagePins>[0];
  const lock = parseBunLock(read("bun.lock"));
  test("the checked-in manifest, lockfile, Cargo locks and workflows pass", () => {
    expect(checkPackagePins(manifest, lock)).toEqual([]);
    expect(checkCargoLock(read("Cargo.lock"), "Cargo.lock")).toEqual([]);
    expect(checkCargoLock(read("desktop/Cargo.lock"), "desktop/Cargo.lock")).toEqual([]);
    for (const file of ["ci.yml", "cli-release.yml", "codex-auto-merge.yml", "data-refresh.yml"]) expect(checkWorkflowPins(read(`.github/workflows/${file}`), file)).toEqual([]);
  });
  test("unpinned github specs, missing or inexact lock entries, stale workspace specs and unpinned script URLs fail", () => {
    const branch = structuredClone(manifest); branch.dependencies!["@hraness/ui"] = "github:hraness/ui#main";
    expect(rules(checkPackagePins(branch, lock))).toEqual(["github-dependency-unpinned", "lockfile-workspace-stale"]);
    const missing = structuredClone(lock); delete missing.packages.zod;
    expect(rules(checkPackagePins(manifest, missing))).toEqual(["lockfile-entry-missing"]);
    const inexact = structuredClone(lock); inexact.packages.zod = ["zod@^4.6.5", "", {}, "sha512-x"];
    expect(rules(checkPackagePins(manifest, inexact))).toEqual(["lockfile-version-inexact"]);
    const unhashed = structuredClone(lock); unhashed.packages.zod = ["zod@4.6.5", "", {}];
    expect(rules(checkPackagePins(manifest, unhashed))).toEqual(["lockfile-integrity-missing"]);
    const floating = structuredClone(lock); floating.packages["@hraness/ui"] = ["@hraness/ui@github:hraness/ui#main", {}, "x", "sha512-x"];
    expect(rules(checkPackagePins(manifest, floating))).toEqual(["lockfile-github-unpinned"]);
    const script = structuredClone(manifest); script.scripts!.probe = "bunx some-tool@latest run && bunx --bun --package https://example.test/tool.tgz tool";
    expect(rules(checkPackagePins(script, lock))).toEqual(["script-bunx-unpinned", "script-bunx-unpinned", "script-url-unpinned"]);
    const pinnedScript = structuredClone(manifest); pinnedScript.scripts!.probe = "bunx some-tool@1.2.3 run && bunx --bun github:hraness/kb#v0.15.2 check";
    expect(checkPackagePins(pinnedScript, lock)).toEqual([]);
  });
  test("Cargo locks need checksums for registry packages and full commits for git packages", () => {
    const registry = 'version = 4\n\n[[package]]\nname = "a"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n';
    expect(rules(checkCargoLock(registry, "x"))).toEqual(["cargo-checksum-missing"]);
    const branch = 'version = 4\n\n[[package]]\nname = "b"\nversion = "1.0.0"\nsource = "git+https://github.com/hraness/b?branch=main#0123456789abcdef0123456789abcdef01234567"\n';
    expect(rules(checkCargoLock(branch, "x"))).toEqual(["cargo-git-unpinned"]);
    const mirror = 'version = 4\n\n[[package]]\nname = "c"\nversion = "1.0.0"\nsource = "registry+https://mirror.test/index"\nchecksum = "' + "0".repeat(64) + '"\n';
    expect(rules(checkCargoLock(mirror, "x"))).toEqual(["cargo-registry-unreviewed"]);
    expect(rules(checkCargoLock("version = 2\n", "x"))).toEqual(["cargo-lock-version"]);
  });
  test("workflow actions need full commit pins", () => {
    expect(checkWorkflowPins("steps:\n  - uses: actions/checkout@v4\n  - uses: ./local\n  - uses: a/b@" + "0".repeat(40) + " # v1\n", "w.yml"))
      .toEqual([{ rule: "action-unpinned", path: "w.yml", line: 2, detail: "actions/checkout" }]);
  });
});

describe("secrets", () => {
  const files = (entries: Record<string, string>): TrackedFile[] => Object.entries(entries).map(([path, text]) => ({ path, text }));
  test("provider-shaped credentials fail everywhere, even in synthetic fixtures", () => {
    const found = scanSecrets(files({ "fixtures/usage/README.md": "# Synthetic usage fixtures\n", "fixtures/usage/a.json": `{"k": "AKIA${"ABCD".repeat(4)}"}\n`,
      "lib/x.ts": `const t = "${fake("ghp_", 40)}";\nconst j = "${fake("eyJ", 24)}.${fake("eyJ", 24)}.${fake("", 24)}";\n`, "k.pem": "-----BEGIN PRIVATE KEY-----\n" }));
    expect(found.map(finding => `${finding.rule}@${finding.path}:${finding.line}`)).toEqual(["secret-aws-access-key@fixtures/usage/a.json:1", "secret-github-token@lib/x.ts:1", "secret-jwt@lib/x.ts:2", "secret-private-key-block@k.pem:1"]);
  });
  test("assignment-shaped values pass only with a synthetic marker in the value or a documented fixture directory", () => {
    const value = fake("", 32);
    expect(rules(scanSecrets(files({ "lib/a.ts": `const apiKey = "${value}";\n` })))).toEqual(["secret-assignment-shaped"]);
    expect(scanSecrets(files({ "lib/a.ts": `const apiKey = "synthetic-${value}";\nconst s = "${"2".repeat(64)}"; const secret = "${"2".repeat(64)}";\n` }))).toEqual([]);
    expect(scanSecrets(files({ "fixtures/usage/README.md": "# Synthetic usage fixtures\n", "fixtures/usage/deep/a.json": `{"pollSecret": "${value}"}\n` }))).toEqual([]);
    expect(rules(scanSecrets(files({ "fixtures/usage/README.md": "# Usage fixtures\n", "fixtures/usage/a.json": `{"pollSecret": "${value}"}\n` })))).toEqual(["secret-assignment-shaped"]);
    expect(scanSecrets(files({ "scripts/assurance-security.ts": `x = "${fake("AKIA", 20)}"` }), new Set(["scripts/assurance-security.ts"]))).toEqual([]);
  });
});

describe("privacy canary", () => {
  const surfaces = (): TrackedFile[] => ["lib/analytics.ts", "lib/page-analytics.ts", "instrumentation-client.ts", "instrumentation.ts", "app/robots.ts", "app/sitemap.ts", "app/llms.txt/route.ts", "lib/analytics-imports.test.ts"]
    .map(path => ({ path, text: read(path) }));
  test("the checked-in surfaces and import boundary pass", () => { expect(checkPrivacyCanary(surfaces())).toEqual([]); });
  test("a stray import, direct capture, referrer read or private identifier fails", () => {
    // Built by concatenation so the repository scan never sees a boundary violation in this file.
    const stray = [...surfaces(), { path: "components/x.tsx", text: `import posthog from "posthog-${"js"}";\nposthog.${"capture"}("x");\n` }];
    expect(rules(checkPrivacyCanary(stray))).toEqual(["analytics-boundary-posthog-capture", "analytics-boundary-posthog-js-import"]);
    const leaking = surfaces().map(file => file.path === "lib/analytics.ts" ? { ...file, text: file.text + "\nconst r = document.referrer; const id = accountId;\n" } : file);
    expect(rules(checkPrivacyCanary(leaking))).toEqual(["privacy-canary-private-identifier", "privacy-canary-referrer"]);
    expect(rules(checkPrivacyCanary(surfaces().filter(file => file.path !== "app/sitemap.ts")))).toEqual(["canary-surface-missing"]);
  });
});

describe("audit reports", () => {
  test("cargo audit vulnerabilities fail, warnings are recorded, a missing report is unavailable", () => {
    const clean = parseCargoAudit(processResult('Fetching advisory database\n{"database":{"advisory-count":1},"lockfile":{"dependency-count":2},"vulnerabilities":{"found":false,"count":0,"list":[]},"warnings":{"unmaintained":[{"advisory":{"id":"RUSTSEC-2025-0001"},"package":{"name":"old","version":"1.0.0"}}]}}\n'), "Cargo.lock");
    expect(clean.status).toBe("pass");
    expect(clean.evidence.warnings).toEqual(["unmaintained RUSTSEC-2025-0001 old@1.0.0"]);
    const vulnerable = parseCargoAudit(processResult('{"vulnerabilities":{"found":true,"count":1,"list":[{"advisory":{"id":"RUSTSEC-2026-0001","title":"bad"},"package":{"name":"p","version":"1.0.0"},"versions":{"patched":[">=1.0.1"]}}]}}\n', { exitCode: 1 }), "Cargo.lock");
    expect(vulnerable.status).toBe("fail");
    expect(vulnerable.findings).toEqual([{ rule: "cargo-advisory", path: "Cargo.lock", detail: "RUSTSEC-2026-0001 p@1.0.0 patched:>=1.0.1 bad" }]);
    expect(parseCargoAudit(processResult("error: couldn't fetch advisory database\n", { exitCode: 1 }), "Cargo.lock").status).toBe("unavailable");
    expect(parseCargoAudit(processResult("{}", { timedOut: true, exitCode: null }), "Cargo.lock").status).toBe("unavailable");
  });
  test("bun audit advisories fail and an empty report passes", () => {
    expect(parseBunAudit(processResult("bun audit v1.3.14\n{}\n")).status).toBe("pass");
    const vulnerable = parseBunAudit(processResult('bun audit v1.3.14\n{"left-pad":[{"id":1,"severity":"high","title":"bad"}]}\n', { exitCode: 1 }));
    expect(vulnerable.status).toBe("fail");
    expect(vulnerable.findings).toEqual([{ rule: "bun-advisory", path: "bun.lock", detail: "left-pad 1 high bad" }]);
    expect(rules(parseBunAudit(processResult("{}", { exitCode: 1 })).findings)).toEqual(["bun-audit-failed"]);
    expect(parseBunAudit(processResult("network down\n", { exitCode: 1 })).status).toBe("unavailable");
  });
});
