import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { completed, proofRoot, runProofProcess, sha256 } from "./assurance-proof-common";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const local = z.string().refine(path => /^target\/assurance-tools(?:\/[A-Za-z0-9_+./-]+)?$/u.test(path)
  && path.split("/").every(part => part !== "." && part !== ".." && part !== ""), "invalid task-local tool path");
const officialUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && !url.port
    && ((url.hostname === "github.com" && /^\/(?:AeneasVerif\/aeneas|leanprover\/lean4|model-checking\/kani|adoptium\/temurin21-binaries|tlaplus\/tlaplus)\/releases\/download\/[^/]+\/[^/]+$/u.test(url.pathname))
      || (url.hostname === "static.rust-lang.org" && /^\/dist\/\d{4}-\d{2}-\d{2}\/channel-rust-nightly\.toml$/u.test(url.pathname)));
}, "unreviewed tool origin");
const artifactSchema = z.object({ id: z.string().regex(/^[a-z0-9-]+$/u), url: officialUrl, sha256: digest,
  cache: local, installPath: local, format: z.enum(["file", "tar.gz", "tar.zst"]),
  archiveRoot: z.string().regex(/^(?:\.|[A-Za-z0-9_+.-]+)$/u).refine(value => value !== ".."),
  maxArchiveBytes: z.number().int().min(1).max(1_073_741_824), maxExpandedBytes: z.number().int().min(1).max(12_884_901_888),
}).strict();
const platformSchema = z.object({ target: z.enum(["aarch64-apple-darwin", "x86_64-unknown-linux-gnu"]), artifacts: z.array(artifactSchema).length(4) }).strict();
export const toolsManifestSchema = z.object({ schemaVersion: z.literal(1), claim: z.string(), common: z.array(artifactSchema).length(3),
  platforms: z.object({ "darwin-arm64": platformSchema, "linux-x64": platformSchema }).strict(),
  rust: z.array(z.object({ toolchain: z.string().regex(/^nightly-\d{4}-\d{2}-\d{2}$/u), manifest: local,
    components: z.tuple([z.literal("cargo"), z.literal("rust-std"), z.literal("rustc"), z.literal("rustc-dev"), z.literal("rust-src"), z.literal("llvm-tools-preview")]) }).strict()).length(2),
  leanPackages: z.array(z.object({ name: z.string().regex(/^[A-Za-z]+$/u),
    url: z.string().regex(/^https:\/\/github\.com\/(?:leanprover|leanprover-community)\/[A-Za-z0-9_.-]+$/u), rev: z.string().regex(/^[a-f0-9]{40}$/u) }).strict()).length(9),
}).strict();
type Platform = keyof z.infer<typeof toolsManifestSchema>["platforms"];
type Binary = { path: string; sha256: string };
const binarySchema = z.object({ path: local, sha256: digest });
const toolsRoot = resolve(proofRoot, "target/assurance-tools");
const pinFiles = ["verify/tools/manifest.json", "verify/tools/prepare.py", "scripts/assurance-tools.ts",
  "scripts/assurance-proof-common.ts", "verify/kani/toolchain.json", "verify/lean/toolchain.json", "verify/tla/toolchain.json"];

export function supportedPlatform(platform = process.platform, arch = process.arch): Platform {
  const key = `${platform}-${arch}`;
  if (key !== "darwin-arm64" && key !== "linux-x64") throw new Error(`unsupported_formal_platform:${key}`);
  return key;
}

/** Installation paths may never follow an existing symlink, including a parent. */
export async function safeToolPath(path: string, base = proofRoot) {
  local.parse(path);
  let current = base;
  for (const part of path.split("/")) {
    current = resolve(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error("tool_install_path_is_symlink"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return current;
}

export async function verifyFile(path: string, expected: string, maximumBytes: number) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > maximumBytes) throw new Error(`tool_file_size:${path}`);
  const hash = createHash("sha256");
  let read = 0;
  for await (const chunk of createReadStream(path)) {
    read += chunk.length;
    if (read > maximumBytes) throw new Error(`tool_file_grew:${path}`);
    hash.update(chunk);
  }
  if (hash.digest("hex") !== expected) throw new Error(`tool_checksum_mismatch:${path}`);
}

export function assertPackages(actual: unknown, expected: { name: string; url: string; rev: string }[]) {
  const manifest = z.object({ packagesDir: z.literal(".lake/packages"), packages: z.array(z.object({ name: z.string(),
    url: z.string(), rev: z.string(), type: z.literal("git"), subDir: z.null() })) }).parse(actual);
  if (manifest.packages.length !== expected.length || new Set(manifest.packages.map(item => item.name)).size !== expected.length
    || expected.some(item => !manifest.packages.some(value => value.name === item.name && value.url === item.url && value.rev === item.rev))) {
    throw new Error("lean_dependency_manifest_drift");
  }
}

async function exists(path: string) {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

/** Provisioning is separate from proof qualification. No proof runner installs tools. */
export async function provisionTools(options: { verify?: boolean; offline?: boolean } = {}) {
  const platform = supportedPlatform();
  await safeToolPath("target/assurance-tools");
  await mkdir(toolsRoot, { recursive: true });
  const runs = resolve(proofRoot, "target/assurance/tools");
  await mkdir(runs, { recursive: true });
  const run = await mkdtemp(resolve(runs, "run-"));
  const inputs: Record<string, string> = {};
  for (const path of pinFiles) inputs[path] = sha256(await readFile(resolve(proofRoot, path)));
  const commands: { log: string; command: string; args: string[]; exitCode: number | null; elapsedMs: number;
    timedOut: boolean; outputExceeded: boolean; signal: string | null }[] = [];
  const receipt: Record<string, unknown> = { schemaVersion: 1, recordedAt: new Date().toISOString(), claim: "tool-provisioning-only", platform,
    mode: options.verify ? "verify" : "install", offline: options.offline ?? false, inputs, commands, ok: false };
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, CI: process.env.CI,
    RUSTUP_HOME: resolve(toolsRoot, "rustup"), CARGO_HOME: resolve(toolsRoot, "cargo-home"),
    RUSTUP_DIST_SERVER: "https://static.rust-lang.org", RUSTUP_UPDATE_ROOT: "https://static.rust-lang.org/rustup",
    GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const command = async (executable: string, args: string[], cwd = proofRoot, timeout = 300_000, environment = env) => {
    const result = await runProofProcess(executable, args, cwd, environment, timeout, 4_194_304);
    const log = `${commands.length + 1}.log`;
    await writeFile(resolve(run, log), result.output);
    commands.push({ log, command: executable, args, exitCode: result.exitCode, elapsedMs: result.elapsedMs,
      timedOut: result.timedOut, outputExceeded: result.outputExceeded, signal: result.signal });
    if (!completed(result) || result.exitCode !== 0) throw new Error(`tool_command_failed:${log}`);
    return result.output;
  };
  try {
    await safeToolPath("target/assurance-tools/cargo-home");
    await safeToolPath("target/assurance-tools/mathlib-cache");
    const manifest = toolsManifestSchema.parse(JSON.parse(await readFile(resolve(proofRoot, pinFiles[0]), "utf8")));
    const kani = JSON.parse(await readFile(resolve(proofRoot, "verify/kani/toolchain.json"), "utf8"));
    const lean = JSON.parse(await readFile(resolve(proofRoot, "verify/lean/toolchain.json"), "utf8"));
    const tla = JSON.parse(await readFile(resolve(proofRoot, "verify/tla/toolchain.json"), "utf8"));
    const selected = manifest.platforms[platform];
    if (selected.target !== kani.platforms[platform].target || kani.rustupHome !== "target/assurance-tools/rustup"
      || lean.rustupHome !== kani.rustupHome || manifest.rust[0].toolchain !== kani.toolchain || manifest.rust[1].toolchain !== lean.versions.rust) {
      throw new Error("formal_toolchain_manifest_drift");
    }
    const binaries: Binary[] = [...Object.values(kani.platforms[platform].binaries), ...Object.values(lean.platforms[platform])].map(value => binarySchema.parse(value));
    const java = tla.java.platforms[platform];
    binaries.push(binarySchema.parse({ path: java.executable, sha256: java.executableSha256 }));
    const archives = [...manifest.common, ...selected.artifacts];
    if (new Set(archives.map(item => item.id)).size !== archives.length || new Set(archives.map(item => item.cache)).size !== archives.length) throw new Error("duplicate_tool_artifact");
    const matchArtifact = (id: string, url: string, sha: string) => {
      const artifact = archives.find(item => item.id === id);
      if (!artifact || artifact.url !== url || artifact.sha256 !== sha) throw new Error(`tool_artifact_pin_drift:${id}`);
    };
    matchArtifact("aeneas", lean.artifacts[platform === "darwin-arm64" ? "aeneasMac" : "aeneasLinux"].url,
      lean.artifacts[platform === "darwin-arm64" ? "aeneasMac" : "aeneasLinux"].sha256);
    matchArtifact("lean", lean.artifacts[platform === "darwin-arm64" ? "leanMac" : "leanLinux"].url,
      lean.artifacts[platform === "darwin-arm64" ? "leanMac" : "leanLinux"].sha256);
    matchArtifact("tlc", tla.tlc.url, tla.tlc.sha256);
    matchArtifact("java", java.archiveUrl, java.archiveSha256);
    matchArtifact("kani", kani.artifacts[platform].url, kani.artifacts[platform].sha256);
    for (const artifact of archives) {
      const cache = await safeToolPath(artifact.cache);
      if (!await exists(cache)) {
        if (options.offline || options.verify) throw new Error(`tool_archive_missing:${artifact.id}`);
        const download = await mkdtemp(resolve(toolsRoot, `.download-${artifact.id}-`));
        const partial = resolve(download, "archive");
        try {
          await command("curl", ["--fail", "--location", "--proto", "=https", "--proto-redir", "=https", "--silent", "--show-error",
            "--connect-timeout", "20", "--max-time", "600", "--retry", "2", "--max-filesize", String(artifact.maxArchiveBytes), "--output", partial, artifact.url], proofRoot, 1_830_000);
          await verifyFile(partial, artifact.sha256, artifact.maxArchiveBytes);
          await rename(partial, cache);
        } finally { await rm(download, { recursive: true, force: true }); }
      }
      await verifyFile(cache, artifact.sha256, artifact.maxArchiveBytes);
      const destination = await safeToolPath(artifact.installPath);
      if (artifact.format === "file") {
        if (cache !== destination) throw new Error("raw_tool_cache_path_mismatch");
      } else if (!await exists(destination)) {
        if (options.verify) throw new Error(`tool_install_missing:${artifact.id}`);
        const stage = await mkdtemp(resolve(toolsRoot, `.extract-${artifact.id}-`));
        try {
          await command("python3", ["verify/tools/prepare.py", "extract", cache, stage, artifact.archiveRoot, String(artifact.maxExpandedBytes)], proofRoot, 300_000);
          await mkdir(dirname(destination), { recursive: true });
          await rename(artifact.archiveRoot === "." ? stage : resolve(stage, artifact.archiveRoot), destination);
        } finally { await rm(stage, { recursive: true, force: true }); }
      }
    }
    for (const rust of manifest.rust) {
      const toolchain = `${rust.toolchain}-${selected.target}`;
      const installed = await safeToolPath(`target/assurance-tools/rustup/toolchains/${toolchain}`);
      if (!await exists(installed)) {
        if (options.offline || options.verify) throw new Error(`rust_toolchain_missing:${toolchain}`);
        await command("rustup", ["toolchain", "install", toolchain, "--profile", "minimal", "--component", "rustc-dev,rust-src,llvm-tools-preview", "--no-self-update"], proofRoot, 900_000);
      }
      await command("python3", ["verify/tools/prepare.py", "rust", resolve(proofRoot, rust.manifest), installed, selected.target, ...rust.components]);
    }
    const kaniDirectory = archives.find(item => item.id === "kani")!.installPath;
    const link = resolve(proofRoot, kaniDirectory, "toolchain");
    const rustTarget = resolve(env.RUSTUP_HOME!, "toolchains", `${kani.toolchain}-${selected.target}`);
    if (!await exists(link)) {
      if (options.verify) throw new Error("kani_toolchain_link_missing");
      await symlink(relative(dirname(link), rustTarget), link);
    }
    if (!(await lstat(link)).isSymbolicLink() || resolve(dirname(link), await readlink(link)) !== rustTarget) throw new Error("kani_toolchain_link_drift");
    for (const binary of binaries) {
      const actual = await realpath(resolve(proofRoot, binary.path));
      if (!actual.startsWith(`${toolsRoot}${sep}`)) throw new Error("tool_binary_outside_task_directory");
      await verifyFile(actual, binary.sha256, 536_870_912);
    }
    const backend = await safeToolPath(lean.backends[platform]);
    const lock = resolve(backend, "lake-manifest.json");
    await verifyFile(lock, lean.backendManifestSha256, 1_048_576);
    assertPackages(JSON.parse(await readFile(lock, "utf8")), manifest.leanPackages);
    const packageRoot = await safeToolPath(relative(proofRoot, resolve(backend, ".lake/packages")));
    await mkdir(packageRoot, { recursive: true });
    for (const pkg of manifest.leanPackages) {
      const directory = await safeToolPath(relative(proofRoot, resolve(packageRoot, pkg.name)));
      if (!await exists(directory)) {
        if (options.offline || options.verify) throw new Error(`lean_package_missing:${pkg.name}`);
        const stage = await mkdtemp(resolve(packageRoot, `.fetch-${pkg.name}-`));
        try {
          await command("git", ["init", "--quiet", stage]);
          await command("git", ["-C", stage, "remote", "add", "origin", pkg.url]);
          await command("git", ["-C", stage, "fetch", "--depth", "1", "origin", pkg.rev]);
          await command("git", ["-C", stage, "-c", "advice.detachedHead=false", "checkout", "--detach", "--quiet", pkg.rev]);
          await rename(stage, directory);
        } finally { await rm(stage, { recursive: true, force: true }); }
      }
      if ((await command("git", ["-C", directory, "rev-parse", "HEAD"])).trim() !== pkg.rev
        || (await command("git", ["-C", directory, "status", "--porcelain", "--untracked-files=normal"])).trim() !== "") throw new Error(`lean_package_source_drift:${pkg.name}`);
    }
    const lake = resolve(proofRoot, lean.platforms[platform].lake.path);
    const leanEnv = { ...env, PATH: `${dirname(lake)}${sep === "/" ? ":" : ";"}${env.PATH ?? ""}`, MATHLIB_CACHE_DIR: resolve(toolsRoot, "mathlib-cache") };
    if (!options.verify && !options.offline) {
      await command(lake, ["--keep-toolchain", "exe", "cache", "get"], backend, 900_000, leanEnv);
      await command(lake, ["--keep-toolchain", "build", "Aeneas", "AeneasMeta"], backend, 900_000, leanEnv);
      for (const pkg of manifest.leanPackages) {
        const directory = resolve(packageRoot, pkg.name);
        if ((await command("git", ["-C", directory, "rev-parse", "HEAD"])).trim() !== pkg.rev
          || (await command("git", ["-C", directory, "status", "--porcelain", "--untracked-files=normal"])).trim() !== "") throw new Error(`lean_package_source_changed:${pkg.name}`);
      }
    }
    await verifyFile(lock, lean.backendManifestSha256, 1_048_576);
    const smoke = resolve(run, "Imports.lean");
    await writeFile(smoke, "import Aeneas\n");
    await command(lake, ["--keep-toolchain", "--no-build", "env", "lean", smoke], backend, 60_000, leanEnv);
    for (const [path, before] of Object.entries(inputs)) if (sha256(await readFile(resolve(proofRoot, path))) !== before) throw new Error(`tool_input_changed:${path}`);
    receipt.ok = true;
    receipt.artifacts = archives.map(({ id, sha256: hash, installPath }) => ({ id, sha256: hash, installPath }));
    receipt.binaries = binaries;
  } catch (error) {
    receipt.error = error instanceof Error ? error.message : String(error);
  }
  const path = resolve(run, "receipt.json");
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ ok: receipt.ok, claim: receipt.claim, receipt: relative(proofRoot, path), error: receipt.error }));
  return receipt.ok === true;
}

if (import.meta.main) {
  const { values } = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: false,
    options: { verify: { type: "boolean" }, offline: { type: "boolean" } } });
  if (!await provisionTools(values)) process.exitCode = 1;
}
