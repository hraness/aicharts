import { readFile, writeFile } from "node:fs/promises";
import { delimiter, posix, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { completed, gitIdentity, proofRoot as root, proofRunDirectory, runProofProcess, sha256, type ProofProcess } from "./assurance-proof-common";

/** Supply-chain, secret and privacy gate. Every lane reports findings with a path and a
 * rule id, never the matched bytes. Missing tools fail the run unless the caller states
 * `--allow-missing-tools`; the workflows never do. */
export type Finding = Readonly<{ rule: string; path: string; line?: number; detail?: string }>;
export type LaneStatus = "pass" | "fail" | "unavailable";
export type Lane = Readonly<{ id: string; status: LaneStatus; findings: readonly Finding[]; evidence: Record<string, unknown> }>;
export type SecurityOptions = Readonly<{ allowMissingTools: boolean }>;

export function parseSecurityOptions(argv: readonly string[]): SecurityOptions {
  const { values, positionals } = parseArgs({ args: [...argv], strict: true, allowPositionals: true, options: { "allow-missing-tools": { type: "boolean" } } });
  if (positionals.length !== 0) throw new Error("security_unexpected_positional_argument");
  return { allowMissingTools: values["allow-missing-tools"] === true };
}

export function securityEnvironment(source: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["HOME", "SystemRoot", "SYSTEMROOT", "WINDIR", "TMPDIR", "TEMP", "TMP", "CI", "CARGO_HOME", "RUSTUP_HOME",
    "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR"]) if (source[key] !== undefined) environment[key] = source[key];
  const cargoBin = source.CARGO_HOME ? resolve(source.CARGO_HOME, "bin") : source.HOME ? resolve(source.HOME, ".cargo", "bin") : undefined;
  return { ...environment, PATH: [cargoBin, source.PATH].filter(Boolean).join(delimiter), NO_COLOR: "1", FORCE_COLOR: "0" };
}

// ---------------------------------------------------------------- dependency pins
const fullSha = /^[0-9a-f]{40}$/u, shortSha = /^[0-9a-f]{7,40}$/u, exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
type BunLock = { lockfileVersion: number; workspaces: Record<string, Record<string, unknown>>; packages: Record<string, unknown[]> };
type PackageManifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; scripts?: Record<string, string> };

/** Every direct `github:` dependency names a release tag or full commit, every direct dependency
 * has one exact lockfile entry with integrity, and every lockfile entry is exact and hashed. */
export function checkPackagePins(manifest: PackageManifest, lock: BunLock): Finding[] {
  const findings: Finding[] = [];
  if (lock.lockfileVersion !== 1) findings.push({ rule: "lockfile-version", path: "bun.lock", detail: String(lock.lockfileVersion) });
  const workspace = lock.workspaces[""] ?? {};
  const direct = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies };
  for (const [name, spec] of Object.entries(direct)) {
    if (spec.startsWith("github:")) {
      const reference = spec.slice(spec.indexOf("#") + 1);
      if (!spec.includes("#") || !(fullSha.test(reference) || /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(reference))) findings.push({ rule: "github-dependency-unpinned", path: "package.json", detail: name });
    } else if (spec.includes(":")) findings.push({ rule: "dependency-protocol-unreviewed", path: "package.json", detail: name });
    const entry = lock.packages[name];
    if (!entry) { findings.push({ rule: "lockfile-entry-missing", path: "bun.lock", detail: name }); continue; }
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
      const declared = (workspace[section] as Record<string, string> | undefined)?.[name];
      if (manifest[section]?.[name] !== undefined && declared !== spec) findings.push({ rule: "lockfile-workspace-stale", path: "bun.lock", detail: name });
    }
  }
  for (const [name, entry] of Object.entries(lock.packages)) {
    const resolved = typeof entry[0] === "string" ? entry[0] : "";
    const integrity = entry[entry.length - 1];
    const at = resolved.lastIndexOf("@");
    const source = at > 0 ? resolved.slice(at + 1) : "";
    if (source.startsWith("github:")) {
      const reference = source.slice(source.indexOf("#") + 1);
      if (!source.includes("#") || !shortSha.test(reference)) findings.push({ rule: "lockfile-github-unpinned", path: "bun.lock", detail: name });
    } else if (source.includes(":") || source === "") findings.push({ rule: "lockfile-source-unreviewed", path: "bun.lock", detail: name });
    else if (!exactVersion.test(source)) findings.push({ rule: "lockfile-version-inexact", path: "bun.lock", detail: name });
    if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) findings.push({ rule: "lockfile-integrity-missing", path: "bun.lock", detail: name });
  }
  for (const [name, script] of Object.entries(manifest.scripts ?? {})) {
    for (const match of script.matchAll(/https?:\/\/\S+/gu)) {
      if (!/\/releases\/download\/v\d+\.\d+\.\d+\/[^/\s]+\.tgz$/u.test(match[0])) findings.push({ rule: "script-url-unpinned", path: "package.json", detail: name });
    }
    for (const invocation of script.matchAll(/\bbunx\s+(?:--bun\s+)?(?:--package\s+)?(\S+)/gu)) {
      const target = invocation[1];
      const pinned = /^https:\/\/\S+\/releases\/download\/v\d+\.\d+\.\d+\/[^/\s]+\.tgz$/u.test(target)
        || /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#(?:v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|[0-9a-f]{40})$/u.test(target)
        || /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(target);
      if (!pinned) findings.push({ rule: "script-bunx-unpinned", path: "package.json", detail: name });
    }
  }
  return findings;
}

/** Registry packages carry checksums; git packages carry a resolved full commit. */
export function checkCargoLock(text: string, path: string): Finding[] {
  const findings: Finding[] = [];
  const version = /^version = (\d+)$/mu.exec(text)?.[1];
  if (version !== "3" && version !== "4") findings.push({ rule: "cargo-lock-version", path, detail: version ?? "missing" });
  for (const block of text.split("\n[[package]]\n").slice(1)) {
    const name = /^name = "([^"]+)"$/mu.exec(block)?.[1] ?? "?";
    const source = /^source = "([^"]+)"$/mu.exec(block)?.[1];
    if (source === undefined) continue; // workspace member
    if (source.startsWith("registry+")) {
      if (!/^checksum = "[0-9a-f]{64}"$/mu.test(block)) findings.push({ rule: "cargo-checksum-missing", path, detail: name });
      if (source !== "registry+https://github.com/rust-lang/crates.io-index") findings.push({ rule: "cargo-registry-unreviewed", path, detail: name });
    } else if (source.startsWith("git+")) {
      const commit = source.slice(source.lastIndexOf("#") + 1);
      if (!source.includes("#") || !fullSha.test(commit) || !/[?&](?:rev|tag)=/u.test(source)) findings.push({ rule: "cargo-git-unpinned", path, detail: name });
    } else findings.push({ rule: "cargo-source-unreviewed", path, detail: name });
  }
  return findings;
}

/** Every third-party action is pinned to a full commit. */
export function checkWorkflowPins(text: string, path: string): Finding[] {
  const findings: Finding[] = [];
  text.split("\n").forEach((raw, index) => {
    const uses = /^\s*-?\s*uses:\s*["']?([^\s"'#]+)/u.exec(raw);
    if (!uses || uses[1].startsWith("./")) return;
    const at = uses[1].lastIndexOf("@");
    if (at < 0 || !fullSha.test(uses[1].slice(at + 1))) findings.push({ rule: "action-unpinned", path, line: index + 1, detail: uses[1].slice(0, Math.max(at, 0)) || uses[1] });
  });
  return findings;
}

// ---------------------------------------------------------------- secrets
/** Provider-shaped credentials are never allowed. Assignment-shaped values are allowed only
 * inside a directory whose README documents synthetic fixtures. */
export const tokenPatterns: readonly (readonly [string, RegExp])[] = [
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/u],
  ["github-token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/u],
  ["openai-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/u],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{32,}\b/u],
  ["stripe-key", /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/u],
  ["posthog-key", /\bph[cx]_[A-Za-z0-9]{32,}\b/u],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/u],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/u],
  ["cloudflare-token", /\b(?:CLOUDFLARE|CF)_API_TOKEN\s*[:=]\s*["']?[A-Za-z0-9_-]{30,}/u],
  ["private-key-block", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/u],
  ["jwt", /\beyJ[A-Za-z0-9_-]{16,}\.eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/u],
];
export const assignmentPattern = /(?:secret|token|password|passwd|api[_-]?key|private[_-]?key)["']?\s*[:=]\s*["']([A-Za-z0-9_/+=-]{24,})["']/iu;
/** A value that names itself synthetic, a placeholder, or one repeated character is documentation, not a credential. */
export const syntheticValue = /synthetic|placeholder|replace[_-]with|not[_-](?:for|a)[_-](?:deployment|production)|example|^(.)\1+$/iu;
export type TrackedFile = Readonly<{ path: string; text: string }>;
/** bun.lock is JSON with trailing commas and no comments. */
export const parseBunLock = (text: string) => JSON.parse(text.replace(/,(?=\s*[}\]])/gu, "")) as BunLock;

export function syntheticDirectories(files: readonly TrackedFile[]): Set<string> {
  const directories = new Set<string>();
  for (const file of files) {
    if (posix.basename(file.path) === "README.md" && /^#[^\n]*\bsynthetic\b/imu.test(file.text.split("\n")[0] ?? "")) directories.add(posix.dirname(file.path));
  }
  return directories;
}

export function scanSecrets(files: readonly TrackedFile[], selfPaths: ReadonlySet<string> = new Set()): Finding[] {
  const findings: Finding[] = [];
  const synthetic = syntheticDirectories(files);
  const documented = (path: string) => { for (let dir = posix.dirname(path); dir !== "."; dir = posix.dirname(dir)) if (synthetic.has(dir)) return true; return synthetic.has("."); };
  for (const file of files) {
    if (selfPaths.has(file.path)) continue;
    file.text.split("\n").forEach((line, index) => {
      for (const [rule, pattern] of tokenPatterns) if (pattern.test(line)) findings.push({ rule: `secret-${rule}`, path: file.path, line: index + 1 });
      const assignment = assignmentPattern.exec(line);
      if (assignment && !documented(file.path) && !syntheticValue.test(assignment[1])) findings.push({ rule: "secret-assignment-shaped", path: file.path, line: index + 1 });
    });
  }
  return findings;
}

// ---------------------------------------------------------------- privacy canary
export const analyticsBoundary = [
  { rule: "posthog-js-import", pattern: /\bfrom\s+["']posthog-js["']/u, allowed: ["instrumentation-client.ts", "lib/analytics.ts"] },
  { rule: "posthog-node-import", pattern: /\bfrom\s+["']posthog-node["']/u, allowed: ["instrumentation.ts"] },
  { rule: "posthog-capture", pattern: /\bposthog\.capture\s*\(/u, allowed: ["lib/analytics.ts"] },
] as const;
export const canarySurfaces = ["lib/analytics.ts", "lib/page-analytics.ts", "instrumentation-client.ts", "instrumentation.ts", "app/robots.ts", "app/sitemap.ts", "app/llms.txt/route.ts"] as const;
export const canaryTerms: readonly (readonly [string, RegExp])[] = [
  ["raw-location", /\b(?:window\.)?location\.(?:href|search|hash)\b/u],
  ["referrer", /\bdocument\.referrer\b/u],
  ["user-agent", /\bnavigator\.userAgent\b/u],
  ["browser-storage", /\b(?:localStorage|sessionStorage|document\.cookie|indexedDB)\b/u],
  ["private-identifier", /\b(?:accountId|deviceId|pairingCode|sessionToken|pollSecret|uploadSecret|intentId|email|Authorization|bearer)\b/u],
];

export function checkPrivacyCanary(files: readonly TrackedFile[]): Finding[] {
  const findings: Finding[] = [];
  const sources = files.filter(file => /\.tsx?$/u.test(file.path));
  for (const boundary of analyticsBoundary) {
    const matching = sources.filter(file => boundary.pattern.test(file.text)).map(file => file.path).sort();
    if (matching.join(",") !== [...boundary.allowed].sort().join(",")) findings.push({ rule: `analytics-boundary-${boundary.rule}`, path: matching.join(",") || "(none)" });
  }
  const byPath = new Map(files.map(file => [file.path, file.text]));
  for (const surface of canarySurfaces) {
    const text = byPath.get(surface);
    if (text === undefined) { if (!surface.startsWith("app/llms.txt")) findings.push({ rule: "canary-surface-missing", path: surface }); continue; }
    text.split("\n").forEach((line, index) => {
      for (const [rule, pattern] of canaryTerms) if (pattern.test(line)) findings.push({ rule: `privacy-canary-${rule}`, path: surface, line: index + 1 });
    });
  }
  return findings;
}

// ---------------------------------------------------------------- audits
const jsonLine = (output: string) => output.split("\n").map(line => line.trim()).find(line => line.startsWith("{"));

export function parseCargoAudit(result: ProofProcess, path: string): Lane {
  const line = jsonLine(result.output);
  if (!completed(result) || line === undefined) return { id: `cargo-audit:${path}`, status: "unavailable", findings: [], evidence: { exitCode: result.exitCode, reason: "no_json_report", tail: result.output.slice(-400) } };
  const report = JSON.parse(line) as { database?: Record<string, unknown>; lockfile?: Record<string, unknown>; vulnerabilities: { count: number; list: { advisory: { id: string; title?: string }; package: { name: string; version: string }; versions?: { patched?: string[] } }[] }; warnings?: Record<string, { advisory?: { id?: string }; package: { name: string; version: string } }[]> };
  const findings: Finding[] = report.vulnerabilities.list.map(item => ({ rule: "cargo-advisory", path, detail: `${item.advisory.id} ${item.package.name}@${item.package.version} patched:${(item.versions?.patched ?? []).join("|") || "none"} ${item.advisory.title ?? ""}`.trim() }));
  const warnings = Object.entries(report.warnings ?? {}).flatMap(([kind, list]) => list.map(item => `${kind} ${item.advisory?.id ?? "-"} ${item.package.name}@${item.package.version}`));
  if (findings.length !== report.vulnerabilities.count) findings.push({ rule: "cargo-audit-count-mismatch", path });
  return { id: `cargo-audit:${path}`, status: findings.length === 0 ? "pass" : "fail", findings,
    evidence: { exitCode: result.exitCode, database: report.database ?? null, lockfile: report.lockfile ?? null, warnings, elapsedMs: result.elapsedMs } };
}

export function parseBunAudit(result: ProofProcess): Lane {
  const line = jsonLine(result.output);
  if (!completed(result) || line === undefined) return { id: "bun-audit", status: "unavailable", findings: [], evidence: { exitCode: result.exitCode, reason: "no_json_report", tail: result.output.slice(-400) } };
  const report = JSON.parse(line) as Record<string, unknown>;
  const findings: Finding[] = [];
  for (const [name, advisories] of Object.entries(report)) {
    if (!Array.isArray(advisories)) { findings.push({ rule: "bun-audit-shape", path: "bun.lock", detail: name }); continue; }
    for (const advisory of advisories as { id?: unknown; severity?: unknown; title?: unknown; url?: unknown }[]) {
      findings.push({ rule: "bun-advisory", path: "bun.lock", detail: `${name} ${String(advisory.id ?? advisory.url ?? "?")} ${String(advisory.severity ?? "?")} ${String(advisory.title ?? "")}`.trim() });
    }
  }
  if (result.exitCode !== 0 && findings.length === 0) findings.push({ rule: "bun-audit-failed", path: "bun.lock", detail: String(result.exitCode) });
  return { id: "bun-audit", status: findings.length === 0 ? "pass" : "fail", findings, evidence: { exitCode: result.exitCode, packages: Object.keys(report).length, elapsedMs: result.elapsedMs } };
}

// ---------------------------------------------------------------- run
const textExtensions = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx|json|jsonl|md|mdx|txt|yml|yaml|toml|cfg|tla|css|svg|html|xml|sh|py|rs|env|example|lock|hex|csv|cff|gitignore|gitattributes|editorconfig|nvmrc)$/iu;

export async function trackedFiles(): Promise<TrackedFile[]> {
  const listing = await runProofProcess("git", ["ls-files", "-z"], root, securityEnvironment(process.env), 60_000, 16_777_216);
  if (!completed(listing) || listing.exitCode !== 0) throw new Error("security_git_listing_failed");
  const files: TrackedFile[] = [];
  for (const path of listing.output.split("\0").filter(Boolean)) {
    if (!textExtensions.test(path) && posix.basename(path).includes(".")) continue;
    const bytes = await readFile(resolve(root, path));
    if (bytes.length > 16_777_216 || bytes.subarray(0, 8192).includes(0)) continue;
    files.push({ path, text: bytes.toString("utf8") });
  }
  return files;
}

export async function runSecurityCheck(options: SecurityOptions) {
  const run = await proofRunDirectory("security");
  const environment = securityEnvironment(process.env);
  const files = await trackedFiles();
  const text = (path: string) => files.find(file => file.path === path)?.text;
  const lanes: Lane[] = [];
  const staticLane = (id: string, findings: Finding[], evidence: Record<string, unknown> = {}) => lanes.push({ id, status: findings.length === 0 ? "pass" : "fail", findings, evidence });
  const manifest = JSON.parse(text("package.json") ?? "{}") as PackageManifest, lock = parseBunLock(text("bun.lock") ?? "{}");
  staticLane("dependency-pins", checkPackagePins(manifest, lock), { lockfilePackages: Object.keys(lock.packages ?? {}).length });
  for (const path of ["Cargo.lock", "desktop/Cargo.lock"]) {
    const lockText = text(path);
    staticLane(`cargo-lock:${path}`, lockText === undefined ? [{ rule: "cargo-lock-missing", path }] : checkCargoLock(lockText, path));
  }
  const workflows = files.filter(file => /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(file.path));
  staticLane("workflow-pins", workflows.flatMap(file => checkWorkflowPins(file.text, file.path)), { workflows: workflows.map(file => file.path) });
  staticLane("secrets", scanSecrets(files, new Set(["scripts/assurance-security.ts", "scripts/assurance-security.test.ts"])), { scannedFiles: files.length, syntheticDirectories: [...syntheticDirectories(files)].sort() });
  staticLane("privacy-canary", checkPrivacyCanary(files), { surfaces: canarySurfaces });
  const cargoVersion = await runProofProcess("cargo", ["audit", "--version"], root, environment, 30_000);
  const cargoAvailable = completed(cargoVersion) && cargoVersion.exitCode === 0;
  for (const path of ["Cargo.lock", "desktop/Cargo.lock"]) {
    if (!cargoAvailable) { lanes.push({ id: `cargo-audit:${path}`, status: "unavailable", findings: [], evidence: { reason: "cargo_audit_not_installed" } }); continue; }
    const result = await runProofProcess("cargo", ["audit", "--json", "--file", path], root, environment, 300_000, 16_777_216);
    await writeFile(resolve(run, `cargo-audit-${path.replace(/[^a-z]/giu, "-")}.log`), result.output);
    lanes.push(parseCargoAudit(result, path));
  }
  const bunResult = await runProofProcess("bun", ["audit", "--json"], root, environment, 180_000, 16_777_216);
  await writeFile(resolve(run, "bun-audit.log"), bunResult.output);
  lanes.push(parseBunAudit(bunResult));
  const failures = lanes.filter(lane => lane.status === "fail" || (lane.status === "unavailable" && !options.allowMissingTools)).map(lane => lane.id);
  const receipt = { schemaVersion: 1, claim: "supply-chain-secret-and-privacy-gate", recordedAt: new Date().toISOString(), git: await gitIdentity(), options,
    tools: { cargoAudit: cargoAvailable ? cargoVersion.output.trim() : null, bun: Bun.version }, lanes, failures, ok: failures.length === 0,
    inputSha256: Object.fromEntries(["package.json", "bun.lock", "Cargo.lock", "desktop/Cargo.lock"].map(path => [path, text(path) === undefined ? null : sha256(text(path)!)])),
    limitations: ["Advisory databases describe published advisories at their fetch time; a clean audit is not an absence of vulnerabilities.",
      "Secret patterns are shape-based: they catch provider-formatted credentials and long assignment-shaped values, not arbitrary secrets.",
      "The privacy canary checks named analytics and discovery surfaces for forbidden identifiers and the PostHog import boundary; runtime payloads are covered by the analytics allowlist tests.",
      "Lockfile checks prove pins and integrity are declared, not that the pinned bytes were reviewed."] };
  await writeFile(resolve(run, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ receipt: relative(root, resolve(run, "receipt.json")), lanes: Object.fromEntries(lanes.map(lane => [lane.id, lane.status])), failures }));
  for (const lane of lanes) for (const finding of lane.findings) console.log(`${lane.id}: ${finding.rule} ${finding.path}${finding.line ? `:${finding.line}` : ""}${finding.detail ? ` ${finding.detail}` : ""}`);
  return failures.length === 0;
}

if (import.meta.main) {
  try {
    if (!await runSecurityCheck(parseSecurityOptions(process.argv.slice(2)))) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
