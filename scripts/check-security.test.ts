import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { checkPackagePins, checkPrivacyCanary, checkWorkflowPins, parseBunAudit, parseBunLock,
  parseSecurityOptions, scanSecrets, securityEnvironment, type TrackedFile } from "./check-security";
import type { SecurityProcess } from "./security-check-common";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const processResult = (output: string, overrides: Partial<SecurityProcess> = {}): SecurityProcess => ({ command: "tool", args: [],
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
  test("environment drops credentials and native-tool configuration", () => {
    const environment = securityEnvironment({ PATH: "/bin", HOME: "/home/x", POSTHOG_API_KEY: "never", CLOUDFLARE_API_TOKEN: "never", CI: "true" });
    expect(environment).toEqual({ NODE_ENV: "test", HOME: "/home/x", CI: "true", PATH: "/bin", NO_COLOR: "1", FORCE_COLOR: "0" });
    expect(securityEnvironment({ PATH: "/bin", CARGO_HOME: "/cargo", RUSTUP_HOME: "/rust", NODE_OPTIONS: "--require injected" })).toEqual({ NODE_ENV: "test", PATH: "/bin", NO_COLOR: "1", FORCE_COLOR: "0" });
  });
});

describe("dependency pins", () => {
  test("reviewed release URLs bind owner, package, asset version and lockfile integrity", () => {
    for (const [name, repository] of [["@hraness/posthog", "posthog"], ["@hraness/site-footer", "site-footer"]]) {
      const canonical = `https://github.com/hraness/${repository}/releases/download/v1.2.3/hraness-${repository}-1.2.3.tgz`;
      const fixture = (source: string, packageName = name) => ({
        manifest: { dependencies: { [packageName]: source } },
        lock: { lockfileVersion: 1, workspaces: { "": { dependencies: { [packageName]: source } } },
          packages: { [packageName]: [`${packageName}@${source}`, {}, "sha512-synthetic"] } },
      });
      const valid = fixture(canonical);
      expect(checkPackagePins(valid.manifest, valid.lock)).toEqual([]);
      for (const source of [canonical.replace("/hraness/", "/other/"), canonical.replace("/v1.2.3/", "/latest/"),
        canonical.replace("-1.2.3.tgz", "-1.2.4.tgz"), canonical.replace(`hraness-${repository}-`, "hraness-other-"),
        canonical + "?download=1", canonical + "#fragment", canonical.replace("https:", "http:")]) {
        const invalid = fixture(source);
        expect(rules(checkPackagePins(invalid.manifest, invalid.lock))).toEqual(["dependency-protocol-unreviewed", "lockfile-source-unreviewed"]);
      }
      const unreviewed = fixture(canonical, "@hraness/other");
      expect(rules(checkPackagePins(unreviewed.manifest, unreviewed.lock))).toEqual(["dependency-protocol-unreviewed", "lockfile-source-unreviewed"]);
      valid.lock.packages[name].pop();
      expect(rules(checkPackagePins(valid.manifest, valid.lock))).toEqual(["lockfile-integrity-missing"]);
    }
  });
  const manifest = JSON.parse(read("package.json")) as Parameters<typeof checkPackagePins>[0];
  const lock = parseBunLock(read("bun.lock"));
  test("the checked-in manifest, lockfile and workflows pass", () => {
    expect(checkPackagePins(manifest, lock)).toEqual([]);
    for (const file of ["ci.yml", "security.yml", "codex-auto-merge.yml", "data-refresh.yml"]) expect(checkWorkflowPins(read(`.github/workflows/${file}`), file)).toEqual([]);
  });
  test("the benchmark site omits the removed account and authentication dependencies", () => {
    const isAuthPackage = (name: string) => name === "@hraness/suite-accounts"
      || name === "better-auth" || name.startsWith("@better-auth/");
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
      expect(Object.keys(manifest[section] ?? {}).filter(isAuthPackage)).toEqual([]);
    }
    expect(Object.keys(lock.packages).filter(isAuthPackage)).toEqual([]);
  });
  test("source-map-js is overridden to the patched 1.2.2 release (GHSA-68fv-2mgg-jv7q)", () => {
    expect((JSON.parse(read("package.json")) as { overrides?: Record<string, string> }).overrides?.["source-map-js"]).toBe("1.2.2");
    expect(lock.packages["source-map-js"]?.[0]).toBe("source-map-js@1.2.2");
  });
  test("the root benchmark site omits the unused Vite dependency", () => {
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
      expect(manifest[section]?.vite).toBeUndefined();
    }
    expect(Object.values(lock.packages).filter(entry => typeof entry[0] === "string" && entry[0].startsWith("vite@"))).toEqual([]);
  });
  test("any retained video Vite stays on patched 8.3.3 (GHSA-587h-7wmj-h5pm, GHSA-r825-w8mm-5pxw, GHSA-698v-4r3x-3vcv)", () => {
    for (const directory of ["video", "video/story"]) {
      const videoManifest = JSON.parse(read(`${directory}/package.json`)) as { overrides?: Record<string, string> };
      const lockText = read(`${directory}/bun.lock`);
      const entries = Object.values(parseBunLock(lockText).packages).filter(entry => typeof entry[0] === "string" && entry[0].startsWith("vite@"));
      if (entries.length > 0) expect(videoManifest.overrides?.vite).toBe("8.3.3");
      for (const entry of entries) expect(entry[0]).toBe("vite@8.3.3");
      expect(lockText).not.toContain("launch-editor");
    }
  });
  test("minimatch uses patched 11.0.1 with the registered compatibility patch (GHSA-g3hv-75wg-m249)", () => {
    const pkg = JSON.parse(read("package.json")) as {
      overrides?: Record<string, string>;
      patchedDependencies?: Record<string, string>;
    };
    expect(pkg.overrides?.minimatch).toBe("11.0.1");
    expect(pkg.patchedDependencies?.["minimatch@11.0.1"]).toBe("patches/minimatch@11.0.1.patch");
    const entries = Object.values(lock.packages).filter(entry => typeof entry[0] === "string" && entry[0].startsWith("minimatch@"));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry[0]).toBe("minimatch@11.0.1");
  });
  test("dompurify is overridden to the patched 3.4.17 release (GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr, GHSA-c6gr-qvv4-5v3f)", () => {
    expect((JSON.parse(read("package.json")) as { overrides?: Record<string, string> }).overrides?.dompurify).toBe("3.4.17");
    expect(lock.packages.dompurify?.[0]).toBe("dompurify@3.4.17");
  });
  test("fast-uri is overridden to the patched 3.1.9 release (GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp, GHSA-xhq7-xmqj-769h)", () => {
    expect((JSON.parse(read("package.json")) as { overrides?: Record<string, string> }).overrides?.["fast-uri"]).toBe("3.1.9");
    expect(lock.packages["fast-uri"]?.[0]).toBe("fast-uri@3.1.9");
  });
  test("undici is overridden to the patched 7.30.1 release (GHSA-xjj6-f33q-929c, GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472)", () => {
    expect((JSON.parse(read("package.json")) as { overrides?: Record<string, string> }).overrides?.undici).toBe("7.30.1");
    // The removed native tooling supplied root's undici dependency. Any
    // retained or reintroduced copy must still resolve to the patched pin.
    for (const entry of Object.values(lock.packages)) {
      if (typeof entry[0] === "string" && entry[0].startsWith("undici@")) expect(entry[0]).toBe("undici@7.30.1");
    }
    const videoManifest = JSON.parse(read("video/package.json")) as { overrides?: Record<string, string> };
    const videoLock = parseBunLock(read("video/bun.lock"));
    expect(videoManifest.overrides?.undici).toBe("7.30.1");
    expect(videoLock.packages.undici?.[0]).toBe("undici@7.30.1");
  });
  test("zod is overridden to the patched 4.6.7 release (GHSA-mrhx-c7xc-m3w5)", () => {
    expect((JSON.parse(read("package.json")) as { overrides?: Record<string, string> }).overrides?.zod).toBe("4.6.7");
    expect(lock.packages.zod?.[0]).toBe("zod@4.6.7");
    const videoManifest = JSON.parse(read("video/package.json")) as { overrides?: Record<string, string> };
    const videoLock = parseBunLock(read("video/bun.lock"));
    expect(videoManifest.overrides?.zod).toBe("4.6.7");
    expect(videoLock.packages.zod?.[0]).toBe("zod@4.6.7");
  });
  test("Next.js and eslint-config-next are pinned to the patched 16.4.3 release (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r)", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(pkg.dependencies?.next).toBe("16.4.3");
    expect(pkg.devDependencies?.["eslint-config-next"]).toBe("16.4.3");
    expect(lock.packages.next?.[0]).toBe("next@16.4.3");
    expect(lock.packages["eslint-config-next"]?.[0]).toBe("eslint-config-next@16.4.3");
  });
  test("sharp is overridden to the patched 0.35.5 release (GHSA-wq5f-xc86-pv6w)", () => {
    expect((JSON.parse(read("package.json")) as { overrides?: Record<string, string> }).overrides?.sharp).toBe("0.35.5");
    expect(lock.packages.sharp?.[0]).toBe("sharp@0.35.5");
    const videoManifest = JSON.parse(read("video/package.json")) as { overrides?: Record<string, string> };
    const videoLock = parseBunLock(read("video/bun.lock"));
    expect(videoManifest.overrides?.sharp).toBe("0.35.5");
    expect(videoLock.packages.sharp?.[0]).toBe("sharp@0.35.5");
    expect(read("video/story/bun.lock")).not.toContain("sharp@0.35.4");
  });
  test("the Next.js lint plugin's fast-glob resolves to the locked tinyglobby, keeping braces (GHSA-vfj7-8cjw-p6xm, no patched release) out of the lockfile", () => {
    expect((JSON.parse(read("package.json")) as { overrides?: Record<string, string> }).overrides?.["fast-glob"]).toBe("npm:tinyglobby@0.2.17");
    expect(lock.packages["fast-glob"]?.[0]).toBe("tinyglobby@0.2.17");
    expect(lock.packages["tinyglobby"]?.[0]).toBe("tinyglobby@0.2.17");
    for (const name of ["braces", "micromatch"]) expect(lock.packages[name]).toBeUndefined();
    const load = createRequire(import.meta.url);
    const plugin = resolve(root, "node_modules/@next/eslint-plugin-next/dist/utils");
    const { globSync } = load(load.resolve("fast-glob", { paths: [plugin] })) as { globSync: (pattern: string, options: { cwd: string; onlyDirectories: boolean }) => string[] };
    expect(globSync("components/*", { cwd: root, onlyDirectories: true })).toContain("components/launch-mockups/");
    const { getRootDirs } = load(resolve(plugin, "get-root-dirs.js")) as { getRootDirs: (context: { cwd: string; settings: Record<string, unknown> }) => string[] };
    expect(getRootDirs({ cwd: root, settings: {} })).toEqual([root]);
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
  test("workflow actions need full commit pins", () => {
    expect(checkWorkflowPins("steps:\n  - uses: actions/checkout@v4\n  - uses: ./local\n  - uses: a/b@" + "0".repeat(40) + " # v1\n", "w.yml"))
      .toEqual([{ rule: "action-unpinned", path: "w.yml", line: 2, detail: "actions/checkout" }]);
  });
});

describe("secrets", () => {
  const files = (entries: Record<string, string>): TrackedFile[] => Object.entries(entries).map(([path, text]) => ({ path, text }));
  test("provider-shaped credentials fail everywhere, even in synthetic fixtures", () => {
    const found = scanSecrets(files({ "fixtures/security/README.md": "# Synthetic security fixtures\n", "fixtures/security/a.json": `{"k": "AKIA${"ABCD".repeat(4)}"}\n`,
      "lib/x.ts": `const t = "${fake("ghp_", 40)}";\nconst j = "${fake("eyJ", 24)}.${fake("eyJ", 24)}.${fake("", 24)}";\n`, "k.pem": "-----BEGIN PRIVATE KEY-----\n" }));
    expect(found.map(finding => `${finding.rule}@${finding.path}:${finding.line}`)).toEqual(["secret-aws-access-key@fixtures/security/a.json:1", "secret-github-token@lib/x.ts:1", "secret-jwt@lib/x.ts:2", "secret-private-key-block@k.pem:1"]);
  });
  test("assignment-shaped values pass only with a synthetic marker in the value or a documented fixture directory", () => {
    const value = fake("", 32);
    expect(rules(scanSecrets(files({ "lib/a.ts": `const apiKey = "${value}";\n` })))).toEqual(["secret-assignment-shaped"]);
    expect(scanSecrets(files({ "lib/a.ts": `const apiKey = "synthetic-${value}";\nconst s = "${"2".repeat(64)}"; const secret = "${"2".repeat(64)}";\n` }))).toEqual([]);
    expect(scanSecrets(files({ "fixtures/security/README.md": "# Synthetic security fixtures\n", "fixtures/security/deep/a.json": `{"pollSecret": "${value}"}\n` }))).toEqual([]);
    expect(rules(scanSecrets(files({ "fixtures/security/README.md": "# Security fixtures\n", "fixtures/security/a.json": `{"pollSecret": "${value}"}\n` })))).toEqual(["secret-assignment-shaped"]);
    expect(scanSecrets(files({ "scripts/check-security.ts": `x = "${fake("AKIA", 20)}"` }), new Set(["scripts/check-security.ts"]))).toEqual([]);
  });
});

describe("privacy canary", () => {
  const surfaces = (): TrackedFile[] => ["lib/analytics.ts", "lib/page-analytics.ts", "instrumentation-client.ts", "instrumentation.ts", "app/robots.ts", "app/sitemap.ts", "app/llms.txt/route.ts", "lib/analytics-imports.test.ts"]
    .map(path => ({ path, text: read(path) }));
  test("the checked-in surfaces and import boundary pass", () => { expect(checkPrivacyCanary(surfaces())).toEqual([]); });
  test("the exact registered signup literal does not hide private fields on the same line", () => {
    const base = surfaces().map(file => file.path === "lib/analytics.ts"
      ? { ...file, text: file.text + '\nconst action = "email signup submitted"; const email = "private";\n' }
      : file);
    expect(rules(checkPrivacyCanary(base))).toEqual(["privacy-canary-private-identifier"]);
  });
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
  test("bun audit advisories fail and an empty report passes", () => {
    expect(parseBunAudit(processResult("bun audit v1.3.14\n{}\n")).status).toBe("pass");
    const vulnerable = parseBunAudit(processResult('bun audit v1.3.14\n{"left-pad":[{"id":1,"severity":"high","title":"bad"}]}\n', { exitCode: 1 }));
    expect(vulnerable.status).toBe("fail");
    expect(vulnerable.findings).toEqual([{ rule: "bun-advisory", path: "bun.lock", detail: "left-pad 1 high bad" }]);
    expect(rules(parseBunAudit(processResult("{}", { exitCode: 1 })).findings)).toEqual(["bun-audit-failed"]);
    expect(parseBunAudit(processResult("network down\n", { exitCode: 1 })).status).toBe("unavailable");
    for (const incomplete of [{ timedOut: true }, { outputExceeded: true }, { signal: "SIGTERM" }, { exitCode: null }]) {
      expect(parseBunAudit(processResult("{}", incomplete)).status).toBe("unavailable");
    }
    expect(() => parseBunAudit(processResult("{invalid JSON}"))).toThrow();
  });
});
