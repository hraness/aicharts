// Exact local Git objects, not authenticated GitHub or executable provenance.
// The operator owns the normal checkout and trusted /usr/bin/git/Node/OS boundary.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, lstatSync, openSync, fstatSync, readSync, closeSync, opendirSync } from "node:fs";
import { posix } from "node:path";
import { performance } from "node:perf_hooks";
import { types } from "node:util";

const MiB = 1024 * 1024;
const LIMITS = Object.freeze({ files: 2048, entries: 8192, source: 64 * MiB,
  commit: MiB, headers: 64 * 1024, tree: MiB, trees: 4 * MiB, listing: 3 * MiB,
  config: 64 * 1024, configLines: 256, packs: 1024, childMs: 15_000, totalMs: 50_000 });
const ERRORS = new Map(["invalid_input", "unsupported_repository", "repository_changed",
  "missing_object", "invalid_object", "invalid_source", "limit_exceeded", "git_failed", "deadline_exceeded"]
  .map((error) => [error, Object.freeze({ ok: false, error })]));
const ERROR_VALUES = new Set(ERRORS.values());
const fail = (code) => { throw ERRORS.get(code); };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const oid = (value) => typeof value === "string" && value.length === 40 && /^[0-9a-f]{40}$/.test(value) && /[1-9a-f]/.test(value);
const safe = (value, cap) => Number.isSafeInteger(value) && value >= 0 && value <= cap;
function add(total, next, cap) {
  if (!safe(next, cap) || total > cap - next) fail("limit_exceeded");
  return total + next;
}
function inputRecord(value) {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("invalid_input");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) fail("invalid_input");
  const keys = Reflect.ownKeys(value), expected = ["repositoryDirectory", "commit", "expectedTree"];
  if (keys.length !== expected.length) fail("invalid_input");
  const out = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string" || !expected.includes(key)) fail("invalid_input");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("invalid_input");
    out[key] = descriptor.value;
  }
  if (!oid(out.commit) || !oid(out.expectedTree) || typeof out.repositoryDirectory !== "string"
    || !posix.isAbsolute(out.repositoryDirectory) || /[\x00-\x1f\x7f]/.test(out.repositoryDirectory)) fail("invalid_input");
  return out;
}

function parseConfig(bytes) {
  if (bytes.length > LIMITS.config) fail("limit_exceeded");
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    if (byte > 127 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)
      || (byte === 13 && bytes[index + 1] !== 10)) fail("unsupported_repository");
  }
  const lines = bytes.toString("ascii").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length > LIMITS.configLines) fail("limit_exceeded");
  const found = new Map();
  let section = "";
  for (const source of lines) {
    const line = source.replace(/\r$/, "").replace(/^[ \t]+|[ \t]+$/g, "");
    if (line.includes("\r")) fail("unsupported_repository");
    if (!line || line[0] === "#" || line[0] === ";") continue;
    const header = /^\[([A-Za-z]+)(?:[ \t]+"([^"]+)")?\]$/.exec(line);
    if (header) {
      const base = header[1].toLowerCase(), sub = header[2];
      if ((base === "core" || base === "gc" || base === "maintenance") && sub === undefined) section = base;
      else if (base === "remote" && sub === "origin") section = "remote.origin";
      else if (base === "branch" && sub === "main") section = "branch.main";
      else fail("unsupported_repository");
      continue;
    }
    const entry = /^([A-Za-z][A-Za-z0-9]*)[ \t]*=[ \t]*([^"\\#;\r\n]*)$/.exec(line);
    if (!entry || !section) fail("unsupported_repository");
    const key = section + "." + entry[1].toLowerCase(), value = entry[2].replace(/[ \t]+$/, "");
    if (found.has(key)) fail("unsupported_repository");
    const allowed = key === "core.repositoryformatversion" ? value === "0"
      : key === "core.bare" ? value === "false"
      : ["core.filemode", "core.logallrefupdates", "core.ignorecase", "core.precomposeunicode"].includes(key) ? /^(true|false)$/.test(value)
      : key === "remote.origin.url" ? /^https:\/\/github\.com\/hraness\/aicharts(?:\.git)?$/.test(value)
      : key === "remote.origin.fetch" ? value === "+refs/heads/*:refs/remotes/origin/*"
      : key === "branch.main.remote" ? value === "origin"
      : key === "branch.main.merge" ? value === "refs/heads/main"
      : key === "gc.auto" ? value === "0"
      : key === "maintenance.auto" ? value === "false" : false;
    if (!allowed) fail("unsupported_repository");
    found.set(key, value);
  }
  if (found.get("core.repositoryformatversion") !== "0" || found.get("core.bare") !== "false") fail("unsupported_repository");
}

const identity = (stat) => (stat.isDirectory()
  ? [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid]
  : [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid, stat.size, stat.mtimeNs, stat.ctimeNs]).join(":");
function metadata(repositoryDirectory) {
  const records = new Map();
  function inspect(path, kind, optional = false) {
    let stat;
    try { stat = lstatSync(path, { bigint: true }); }
    catch (error) {
      if (optional && error?.code === "ENOENT") { records.set(path, null); return null; }
      fail("unsupported_repository");
    }
    if (stat.isSymbolicLink() || (kind === "directory" ? !stat.isDirectory() : !stat.isFile())) fail("unsupported_repository");
    records.set(path, identity(stat));
    return stat;
  }
  // Check each original ancestor before normalizing dot components. A symlink
  // followed by '..' must not silently select a different repository.
  let directory = "/";
  inspect(directory, "directory");
  for (const component of repositoryDirectory.split("/").slice(1)) {
    if (!component) continue;
    directory = posix.join(directory, component);
    inspect(directory, "directory");
  }
  const selected = inspect(directory, "directory"), git = posix.join(directory, ".git");
  const gitStat = inspect(git, "directory");
  if (typeof process.getuid !== "function" || selected.uid !== BigInt(process.getuid()) || gitStat.uid !== BigInt(process.getuid())) fail("unsupported_repository");
  inspect(git + "/objects", "directory");
  inspect(git + "/info", "directory", true);
  inspect(git + "/objects/info", "directory", true);
  const pack = inspect(git + "/objects/pack", "directory", true);
  inspect(git + "/HEAD", "file");
  const configStat = inspect(git + "/config", "file");
  inspect(git + "/shallow", "file", true);
  for (const relative of ["commondir", "config.worktree", "info/grafts", "objects/info/alternates", "objects/info/http-alternates"]) {
    const path = git + "/" + relative;
    try { lstatSync(path); }
    catch (error) {
      if (error?.code === "ENOENT") { records.set(path, null); continue; }
      fail("unsupported_repository");
    }
    fail("unsupported_repository");
  }
  if (pack) {
    const handle = opendirSync(git + "/objects/pack");
    try {
      let count = 0, entry;
      while ((entry = handle.readSync()) !== null) {
        if (++count > LIMITS.packs) fail("limit_exceeded");
        if (entry.name.endsWith(".promisor") || entry.isSymbolicLink()) fail("unsupported_repository");
        const path = git + "/objects/pack/" + entry.name;
        const stat = lstatSync(path, { bigint: true });
        if (stat.isSymbolicLink()) fail("unsupported_repository");
        records.set(path, identity(stat));
      }
    } finally { handle.closeSync(); }
  }
  if (configStat.size > BigInt(LIMITS.config)) fail("limit_exceeded");
  const fd = openSync(git + "/config", constants.O_RDONLY | constants.O_NOFOLLOW);
  let config;
  try {
    if (identity(fstatSync(fd, { bigint: true })) !== identity(configStat)) fail("repository_changed");
    const buffer = Buffer.alloc(LIMITS.config + 1);
    let used = 0, read;
    while (used < buffer.length && (read = readSync(fd, buffer, used, buffer.length - used, used)) > 0) used += read;
    if (used > LIMITS.config) fail("limit_exceeded");
    if (identity(fstatSync(fd, { bigint: true })) !== identity(configStat)) fail("repository_changed");
    config = Buffer.from(buffer.subarray(0, used));
  } finally { closeSync(fd); }
  parseConfig(config);
  return { directory, git, config, records: [...records].sort(([a], [b]) => compare(a, b)) };
}
function sameMetadata(before, after) {
  return before.directory === after.directory && before.config.equals(after.config)
    && before.records.length === after.records.length
    && before.records.every(([path, stat], index) => path === after.records[index][0] && stat === after.records[index][1]);
}

const ENV = Object.freeze({ PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC",
  GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "" });
const LIST_ARGS = Object.freeze(["ls-tree", "-r", "-t", "-z", "--full-tree",
  "--format=%(objectmode) %(objecttype) %(objectname) %(objectsize)%x09%(path)"]);
function childRunner(snapshot, run, remaining) {
  let calls = 0;
  const prefix = ["--no-pager", "--no-replace-objects", "--no-lazy-fetch", "--no-optional-locks", "--no-advice",
    "--git-dir=" + snapshot.git, "--work-tree=" + snapshot.directory,
    "-c", "core.hooksPath=/dev/null", "-c", "gc.auto=0", "-c", "maintenance.auto=false"];
  return (args, input, cap) => {
    if (++calls > 6 || !safe(cap, LIMITS.source + 97 * LIMITS.files) || cap === 0) fail("limit_exceeded");
    const timeout = Math.min(LIMITS.childMs, remaining());
    let result;
    try {
      result = run("/usr/bin/git", [...prefix, ...args], { cwd: snapshot.directory,
        env: { ...ENV }, shell: false, detached: false, encoding: "buffer", stdio: ["pipe", "pipe", "pipe"],
        input, maxBuffer: cap, timeout, killSignal: "SIGKILL" });
    } catch { fail("git_failed"); }
    remaining();
    if (result?.error?.code === "ETIMEDOUT") fail("deadline_exceeded");
    if (result?.error?.code === "ENOBUFS") fail("limit_exceeded");
    if (!result || result.error || result.signal || result.status !== 0
      || !Buffer.isBuffer(result.stdout) || !Buffer.isBuffer(result.stderr)) fail("git_failed");
    if (result.stdout.length > cap) fail("limit_exceeded");
    if (result.stderr.length !== 0) fail("git_failed");
    return result.stdout;
  };
}

function parseBatch(bytes, requests, contents) {
  const results = [];
  let offset = 0;
  for (const request of requests) {
    const end = bytes.indexOf(10, offset);
    if (end < offset || end - offset + 1 > 96) fail("invalid_object");
    const header = bytes.toString("latin1", offset, end);
    if (header === request.oid + " missing") fail("missing_object");
    const fields = /^([0-9a-f]{40}) (commit|tree|blob) (0|[1-9][0-9]*)$/.exec(header);
    if (!fields || fields[0] !== header || fields[1] !== request.oid || fields[2] !== request.type) fail("invalid_object");
    const size = Number(fields[3]);
    if (!safe(size, request.max)) fail("limit_exceeded");
    if (size < (request.min ?? 0) || (request.size !== undefined && size !== request.size)) fail("invalid_object");
    offset = end + 1;
    const item = { oid: request.oid, type: request.type, size };
    if (contents) {
      if (size >= bytes.length - offset || bytes[offset + size] !== 10) fail("invalid_object");
      item.bytes = bytes.subarray(offset, offset + size);
      const actual = createHash("sha1").update(request.type + " " + size + "\0").update(item.bytes).digest("hex");
      if (actual !== request.oid) fail("invalid_object");
      offset += size + 1;
    }
    results.push(item);
  }
  if (offset !== bytes.length) fail("invalid_object");
  return results;
}
function batch(child, requests, contents) {
  let cap = requests.length * (contents ? 97 : 96);
  if (contents) for (const request of requests) cap = add(cap, request.size, LIMITS.source + 97 * LIMITS.files);
  const input = Buffer.from(requests.map((request) => request.oid + "\n").join(""), "ascii");
  const args = contents ? ["cat-file", "--batch", "--no-use-mailmap"] : ["cat-file", "--batch-check"];
  return parseBatch(child(args, input, cap), requests, contents);
}
function commitTime(bytes, expectedTree) {
  const boundary = bytes.indexOf("\n\n");
  if (boundary < 0) fail("invalid_object");
  if (boundary > LIMITS.headers) fail("limit_exceeded");
  const header = bytes.toString("latin1", 0, boundary);
  if (header.includes("\0")) fail("invalid_object");
  const lines = header.split("\n");
  if (lines[0] !== "tree " + expectedTree) fail("invalid_object");
  let trees = 0, committers = 0, epoch;
  for (const line of lines) {
    if (line.startsWith(" ")) continue;
    if (!/^[^\x00-\x20]+ /.test(line)) fail("invalid_object");
    if (line.startsWith("tree ")) {
      if (++trees !== 1 || line !== "tree " + expectedTree) fail("invalid_object");
    }
    if (line.startsWith("committer ")) {
      if (++committers !== 1) fail("invalid_object");
      const match = /^committer .+ (0|[1-9][0-9]*) ([+-])([0-9]{2})([0-9]{2})$/.exec(line);
      if (!match || match[0] !== line || Number(match[3]) > 23 || Number(match[4]) > 59) fail("invalid_object");
      epoch = Number(match[1]);
      if (!safe(epoch, 0o77777777777)) fail("invalid_object");
    }
  }
  if (trees !== 1 || committers !== 1) fail("invalid_object");
  return new Date(epoch * 1000).toISOString().replace(".000Z", "Z");
}
// Keep this fixed source-path subset aligned with the assembler's sourcePath.
function sourcePath(value) {
  if (typeof value !== "string" || !value.length || value.length > 256) fail("invalid_source");
  for (const component of value.split("/")) {
    if (!component.length || component.length > 255 || component === "." || component === ".."
      || /[^A-Za-z0-9._@+()[\]-]/.test(component) || component.endsWith(".")
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component)) fail("invalid_source");
  }
  return value;
}
function parseListing(bytes) {
  if (bytes.length > LIMITS.listing) fail("limit_exceeded");
  const entries = new Map(), folded = new Set(), blobs = new Map(), trees = new Set();
  let offset = 0, count = 0, total = 0;
  while (offset < bytes.length) {
    const end = bytes.indexOf(0, offset);
    if (end < 0) fail("invalid_source");
    if (entries.size + 1 >= LIMITS.entries) fail("limit_exceeded");
    const line = bytes.toString("latin1", offset, end);
    const match = /^(040000|100644|100755) (tree|blob) ([0-9a-f]{40}) (-|0|[1-9][0-9]*)\t(.+)$/.exec(line);
    if (!match || match[0] !== line || !oid(match[3])) fail("invalid_source");
    const [mode, type, object, sizeText, path] = match.slice(1);
    sourcePath(path);
    if (entries.has(path) || folded.has(path.toLowerCase())) fail("invalid_source");
    if (mode === "040000") {
      if (type !== "tree" || sizeText !== "-") fail("invalid_source");
      trees.add(object);
    } else {
      if (type !== "blob" || sizeText === "-") fail("invalid_source");
      if (++count > LIMITS.files) fail("limit_exceeded");
      const size = Number(sizeText);
      total = add(total, size, LIMITS.source);
      if (blobs.has(object) && blobs.get(object) !== size) fail("invalid_object");
      blobs.set(object, size);
    }
    entries.set(path, { path, mode, type, oid: object }); folded.add(path.toLowerCase());
    offset = end + 1;
  }
  for (const { path } of entries.values()) {
    let parent = path;
    while (parent.includes("/")) {
      parent = parent.slice(0, parent.lastIndexOf("/"));
      if (entries.get(parent)?.type !== "tree") fail("invalid_source");
    }
  }
  return { entries, blobs, trees };
}
function decodeTree(bytes) {
  const entries = [], names = new Set();
  let offset = 0;
  while (offset < bytes.length) {
    if (entries.length >= LIMITS.entries) fail("limit_exceeded");
    const space = bytes.indexOf(32, offset), end = bytes.indexOf(0, space + 1);
    if (space < offset || space - offset > 6 || end <= space + 1 || end + 21 > bytes.length) fail("invalid_object");
    const mode = bytes.toString("latin1", offset, space), name = bytes.toString("latin1", space + 1, end);
    if (mode !== "40000" && mode !== "100644" && mode !== "100755") fail("invalid_source");
    if (name.includes("/") || names.has(name)) fail("invalid_source");
    sourcePath(name); names.add(name);
    const object = bytes.toString("hex", end + 1, end + 21);
    if (!oid(object)) fail("invalid_object");
    entries.push({ name, oid: object, mode: mode === "40000" ? "040000" : mode, type: mode === "40000" ? "tree" : "blob" });
    offset = end + 21;
  }
  return entries;
}
function reconcile(root, trees, listing) {
  const work = [{ oid: root, prefix: "" }], visited = new Set();
  let count = 1;
  while (work.length) {
    const current = work.pop(), entries = trees.get(current.oid);
    if (!entries || !entries.length) fail("invalid_source");
    for (const entry of entries) {
      count = add(count, 1, LIMITS.entries);
      const path = sourcePath(current.prefix + entry.name), listed = listing.entries.get(path);
      if (!listed || visited.has(path) || listed.oid !== entry.oid || listed.mode !== entry.mode || listed.type !== entry.type) fail("invalid_source");
      visited.add(path);
      if (entry.type === "tree") work.push({ oid: entry.oid, prefix: path + "/" });
    }
  }
  if (visited.size !== listing.entries.size || !listing.blobs.size) fail("invalid_source");
}

// Private process/time seam: the production export never accepts overrides.
function readWith(value, run = spawnSync, now = () => performance.now()) {
  try {
    const started = now(), input = inputRecord(value);
    const remaining = () => {
      const elapsed = now() - started;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= LIMITS.totalMs) fail("deadline_exceeded");
      return Math.ceil(LIMITS.totalMs - elapsed);
    };
    let snapshot;
    try { snapshot = metadata(input.repositoryDirectory); }
    catch (error) { if (ERROR_VALUES.has(error)) throw error; fail("unsupported_repository"); }
    remaining();
    const child = childRunner(snapshot, run, remaining);
    const [commit] = batch(child, [{ oid: input.commit, type: "commit", min: 1, max: LIMITS.commit }], false);
    const time = commitTime(batch(child, [{ ...commit, min: 1, max: LIMITS.commit }], true)[0].bytes, input.expectedTree);
    const listing = parseListing(child([...LIST_ARGS, input.expectedTree], Buffer.alloc(0), LIMITS.listing));
    const treeOids = [...new Set([input.expectedTree, ...listing.trees])].sort(compare);
    if (treeOids.length > LIMITS.entries) fail("limit_exceeded");
    const sizes = batch(child, treeOids.map((oid) => ({ oid, type: "tree", max: LIMITS.tree })), false);
    let total = 0;
    for (const tree of sizes) total = add(total, tree.size, LIMITS.trees);
    const trees = new Map();
    for (const tree of batch(child, sizes.map((tree) => ({ ...tree, max: LIMITS.tree })), true)) trees.set(tree.oid, decodeTree(tree.bytes));
    reconcile(input.expectedTree, trees, listing);
    trees.clear();
    const requests = [...listing.blobs].sort(([a], [b]) => compare(a, b)).map(([oid, size]) => ({ oid, type: "blob", size, max: LIMITS.source }));
    const blobs = new Map(batch(child, requests, true).map((blob) => [blob.oid, blob.bytes]));
    const sourceFiles = [...listing.entries.values()].filter((entry) => entry.type === "blob").sort((a, b) => compare(a.path, b.path)).map((entry) => {
      const body = blobs.get(entry.oid), bytes = Buffer.alloc(body.length);
      bytes.set(body);
      return Object.freeze({ path: entry.path, mode: entry.mode === "100755" ? 0o755 : 0o644, bytes });
    });
    remaining();
    try { if (!sameMetadata(snapshot, metadata(input.repositoryDirectory))) fail("repository_changed"); }
    catch { fail("repository_changed"); }
    remaining();
    return Object.freeze({ ok: true, value: Object.freeze({ source: Object.freeze({ commit: input.commit,
      tree: input.expectedTree, commitTime: time }), sourceFiles: Object.freeze(sourceFiles) }) });
  } catch (error) { return ERROR_VALUES.has(error) ? error : ERRORS.get("invalid_input"); }
}

/** Read complete raw committed files. No checkout, filters, network, or publication. */
export function readGitSource(input) { return readWith(input); }
