import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import * as publicModule from "./git-source.mjs";

// Only synthetic, exact-owned temporary Git objects are written or read. The
// private seam exists in this in-memory test copy, never in the public export.
const moduleUrl = new URL("./git-source.mjs", import.meta.url);
const implementation = readFileSync(moduleUrl, "utf8");
const privateModule = await import("data:text/javascript;base64," + Buffer.from(implementation
  + "\nexport { readWith, parseConfig, parseBatch, commitTime, sourcePath, parseListing, decodeTree, reconcile, LIMITS, ENV };\n").toString("base64"));
const { readGitSource } = publicModule;
const { readWith, parseConfig, parseBatch, commitTime, sourcePath, parseListing, decodeTree, reconcile, LIMITS, ENV } = privateModule;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const good = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const codes = new Set(["invalid_input", "unsupported_repository", "repository_changed", "missing_object",
  "invalid_object", "invalid_source", "limit_exceeded", "git_failed", "deadline_exceeded"]);
function bad(result, expected) {
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result), ["ok", "error"]);
  assert.ok(codes.has(result.error)); assert.ok(Object.isFrozen(result));
  if (expected) assert.equal(result.error, expected);
}
function refuses(operation, expected) {
  assert.throws(operation, (error) => { bad(error, expected); return true; });
}
const CONFIG = "[core]\n\trepositoryformatversion = 0\n\tbare = false\n";
const PERSON = "Synthetic Fixture <fixture@example.invalid>";
const EPOCH = 1_789_128_000;
const bodyOfCommit = (tree, extra = "", epoch = String(EPOCH), offset = "+1230") => Buffer.from(
  "tree " + tree + "\n" + extra + "author " + PERSON + " 1 +0000\ncommitter " + PERSON + " " + epoch + " " + offset + "\n\nSynthetic commit; never published.\n");
const gitHash = (type, bytes) => createHash("sha1").update(type + " " + bytes.length + "\0").update(bytes).digest("hex");
const rawEntry = (name, mode, oid) => Buffer.concat([Buffer.from(mode + " " + name + "\0"), Buffer.from(oid, "hex")]);
const file = (path, bytes, mode = 0o644) => ({ path, bytes: Buffer.from(bytes), mode });
function controls() {
  return [file(".gitattributes", "ignored.txt export-ignore\nsubstituted.txt export-subst\nfilter.bin filter=canary\n"),
    file("ignored.txt", "Still present.\n"), file("substituted.txt", "$Format:%H$\n"),
    file("filter.bin", [0, 255, 10, 13, 128, 0, 42]), file("empty", []),
    file("bin/tool", "synthetic executable; never executed\n", 0o755),
    file("copy-a/same", "duplicate blob\n"), file("copy-b/same", "duplicate blob\n"),
    file("plus+at@(brackets)[ok]/tail", "path subset\n")];
}

function fixture(t, files = controls()) {
  const directory = mkdtempSync(posix.join(realpathSync(tmpdir()), "aicharts-git-source-"));
  const original = lstatSync(directory);
  t.after(() => {
    const current = lstatSync(directory);
    assert.equal(current.dev, original.dev); assert.equal(current.ino, original.ino);
    assert.ok(current.isDirectory() && !current.isSymbolicLink());
    // This exact directory was created above and has never been caller input.
    rmSync(directory, { recursive: true, force: false });
  });
  const git = directory + "/.git", objects = new Map(), listings = [];
  for (const path of [git + "/objects", git + "/refs/heads"]) mkdirSync(path, { recursive: true });
  writeFileSync(git + "/config", CONFIG);
  writeFileSync(git + "/HEAD", "ref: refs/heads/main\n");
  const put = (type, bytes) => {
    bytes = Buffer.from(bytes);
    const oid = gitHash(type, bytes), path = git + "/objects/" + oid.slice(0, 2);
    mkdirSync(path, { recursive: true });
    writeFileSync(path + "/" + oid.slice(2), deflateSync(Buffer.concat([Buffer.from(type + " " + bytes.length + "\0"), bytes])));
    objects.set(oid, { type, bytes });
    return oid;
  };
  const root = new Map();
  for (const entry of files) {
    const parts = entry.path.split("/"), name = parts.pop();
    let node = root;
    for (const part of parts) {
      if (!node.has(part)) node.set(part, new Map());
      node = node.get(part);
    }
    assert.equal(node.has(name), false);
    node.set(name, entry);
  }
  const encode = (node, prefix) => {
    const entries = [];
    for (const [name, child] of node) {
      if (child instanceof Map) {
        const oid = encode(child, prefix + name + "/");
        entries.push({ name, oid, mode: "40000", type: "tree", size: "-" });
      } else entries.push({ name, oid: put("blob", child.bytes), mode: child.mode === 0o755 ? "100755" : "100644", type: "blob", size: String(child.bytes.length) });
    }
    entries.sort((a, b) => order(a.name + (a.type === "tree" ? "/" : ""), b.name + (b.type === "tree" ? "/" : "")));
    for (const entry of entries) listings.push({ ...entry, path: prefix + entry.name });
    return put("tree", Buffer.concat(entries.map((entry) => rawEntry(entry.name, entry.mode, entry.oid))));
  };
  const tree = encode(root, ""), commit = put("commit", bodyOfCommit(tree));
  const other = put("commit", bodyOfCommit(tree, "", String(EPOCH + 1)));
  writeFileSync(git + "/refs/heads/main", other + "\n");
  const listing = () => Buffer.from(listings.map((entry) => (entry.mode === "40000" ? "040000" : entry.mode)
    + " " + entry.type + " " + entry.oid + " " + entry.size + "\t" + entry.path + "\0").join(""));
  return { directory, git, files, objects, listings, listing, put, input: { repositoryDirectory: directory, commit, expectedTree: tree } };
}
function fakeGit(repo, transform = (result) => result) {
  const calls = [];
  const run = (executable, args, options) => {
    calls.push({ executable, args, options });
    let stdout;
    if (args.includes("ls-tree")) stdout = repo.listing();
    else {
      const contents = args.includes("--batch"), chunks = [];
      for (const oid of options.input.toString("ascii").trimEnd().split("\n")) {
        const object = repo.objects.get(oid);
        if (!object) chunks.push(Buffer.from(oid + " missing\n"));
        else {
          chunks.push(Buffer.from(oid + " " + object.type + " " + object.bytes.length + "\n"));
          if (contents) chunks.push(object.bytes, Buffer.from("\n"));
        }
      }
      stdout = Buffer.concat(chunks);
    }
    return transform({ stdout, stderr: Buffer.alloc(0), status: 0, signal: null }, calls.length, calls.at(-1));
  };
  return { run, calls };
}
function assertGraph(repo, result) {
  const value = good(result), expected = [...repo.files].sort((a, b) => order(a.path, b.path));
  assert.deepEqual(value.source, { commit: repo.input.commit, tree: repo.input.expectedTree,
    commitTime: new Date(EPOCH * 1000).toISOString().replace(".000Z", "Z") });
  assert.deepEqual(Object.keys(value), ["source", "sourceFiles"]);
  for (const frozen of [result, value, value.source, value.sourceFiles]) assert.ok(Object.isFrozen(frozen));
  assert.deepEqual(value.sourceFiles.map(({ path, mode }) => ({ path, mode })), expected.map(({ path, mode }) => ({ path, mode })));
  for (const [index, entry] of value.sourceFiles.entries()) {
    assert.ok(Object.isFrozen(entry)); assert.ok(Buffer.isBuffer(entry.bytes));
    assert.equal(entry.bytes.byteOffset, 0); assert.equal(entry.bytes.buffer.byteLength, entry.bytes.byteLength);
    assert.deepEqual(entry.bytes, expected[index].bytes);
    assert.deepEqual(Object.keys(entry), ["path", "mode", "bytes"]);
    for (const sibling of value.sourceFiles.slice(0, index)) assert.notEqual(entry.bytes.buffer, sibling.bytes.buffer);
  }
  return value;
}

test("one public export; unknown input rejects without getters, proxies, or Git", () => {
  assert.deepEqual(Object.keys(publicModule), ["readGitSource"]);
  let effects = 0;
  const valid = { repositoryDirectory: "/synthetic/missing", commit: "1".repeat(40), expectedTree: "2".repeat(40) };
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const accessor = { ...valid }; Object.defineProperty(accessor, "commit", { enumerable: true, get() { effects++; return valid.commit; } });
  const inputs = [null, undefined, false, 1, [], new Date(), Object.create(valid),
    new Proxy(valid, { ownKeys() { effects++; return []; } }), revoked.proxy, accessor,
    { ...valid, extra: true }, { ...valid, [Symbol("extra")]: 1 },
    ...["HEAD", "main", "refs/heads/main", "1".repeat(39), "0".repeat(40), "A".repeat(40), "1".repeat(40) + "^{tree}", "x:path",
      "1".repeat(40) + "\n", "1".repeat(40) + "\r", "1".repeat(40) + "\r\n"].map((commit) => ({ ...valid, commit })),
    ...["\n", "\r", "\r\n"].map((suffix) => ({ ...valid, expectedTree: valid.expectedTree + suffix })),
    ...["relative", "", "/line\nbreak", "/zero\0byte", "/tab\tpath"].map((repositoryDirectory) => ({ ...valid, repositoryDirectory }))];
  for (const input of inputs) bad(readWith(input, () => { effects++; throw new Error("must not run"); }), "invalid_input");
  assert.equal(effects, 0);
  bad(readGitSource(Object.assign(Object.create(null), valid)), "unsupported_repository");
});

test("real Git returns every raw binary file and mode from the requested objects", (t) => {
  const repo = fixture(t);
  const value = assertGraph(repo, readGitSource(repo.input));
  const a = value.sourceFiles.find((entry) => entry.path === "copy-a/same");
  const b = value.sourceFiles.find((entry) => entry.path === "copy-b/same");
  a.bytes[0] ^= 255;
  assert.deepEqual(b.bytes, Buffer.from("duplicate blob\n"));
  assert.equal(repo.listings.find((entry) => entry.path === "copy-a").oid, repo.listings.find((entry) => entry.path === "copy-b").oid);
});

test("real Git ignores different HEAD, replacement refs, dirty index and working tree", (t) => {
  const repo = fixture(t);
  writeFileSync(repo.directory + "/ignored.txt", "uncommitted unrelated data\n");
  writeFileSync(repo.directory + "/untracked", "not selected source\n");
  writeFileSync(repo.git + "/index", "synthetic invalid index: must not read\n");
  mkdirSync(repo.git + "/refs/replace");
  writeFileSync(repo.git + "/refs/replace/" + repo.input.commit, "f".repeat(40) + "\n");
  const calls = [];
  assertGraph(repo, readWith(repo.input, (...args) => { calls.push(args); return spawnSync(...args); }));
  assert.equal(calls.length, 6);
  assert.equal(calls.some(([, args]) => args.some((arg) => /^(status|checkout|fetch|rev-list|--all|--batch-all-objects)$/.test(arg))), false);
  assert.equal(readFileSync(repo.git + "/index", "utf8"), "synthetic invalid index: must not read\n");
});

test("real shallow selected-object completeness succeeds without parent history", (t) => {
  const repo = fixture(t), absentParent = "3".repeat(40);
  repo.input.commit = repo.put("commit", bodyOfCommit(repo.input.expectedTree, "parent " + absentParent + "\n"));
  writeFileSync(repo.git + "/shallow", repo.input.commit + "\n");
  assert.equal(repo.objects.has(absentParent), false);
  assertGraph(repo, readGitSource(repo.input));
});

test("real missing commit/tree/blob objects fail in ordinary and shallow stores without a fetch", (t) => {
  for (const shallow of [false, true]) for (const kind of ["commit", "tree", "blob"]) {
    const repo = fixture(t), selected = kind === "commit" ? repo.input.commit
      : kind === "tree" ? repo.input.expectedTree : repo.listings.find((entry) => entry.type === "blob").oid;
    if (shallow) writeFileSync(repo.git + "/shallow", repo.input.commit + "\n");
    rmSync(repo.git + "/objects/" + selected.slice(0, 2) + "/" + selected.slice(2));
    const calls = [];
    bad(readWith(repo.input, (...args) => { calls.push(args); return spawnSync(...args); }));
    assert.ok(calls.length >= 1 && calls.length <= 6);
    for (const [executable, args, options] of calls) {
      assert.equal(executable, "/usr/bin/git"); assert.ok(args.includes("--no-lazy-fetch"));
      assert.equal(options.env.GIT_ALLOW_PROTOCOL, ""); assert.equal(args.includes("fetch"), false);
    }
  }
});

test("global/system and injection settings in the parent environment are not inherited", (t) => {
  const repo = fixture(t), canary = repo.directory + "/invalid-global";
  writeFileSync(canary, "[synthetic invalid global configuration\n");
  const code = "import {readGitSource} from " + JSON.stringify(moduleUrl.href) + "; const value=readGitSource(" + JSON.stringify(repo.input) + "); if(!value.ok) process.exit(1);";
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { shell: false, encoding: "buffer",
    cwd: repo.directory, timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 4096,
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: canary, GIT_CONFIG_SYSTEM: canary,
      GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "include.path", GIT_CONFIG_VALUE_0: canary,
      GIT_DIR: "/synthetic/forbidden", GIT_OBJECT_DIRECTORY: "/synthetic/forbidden", GIT_TRACE: "1" } });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.signal, null);
  assert.equal(result.stdout.length, 0); assert.equal(result.stderr.length, 0);
});

test("startup configuration admits only the frozen subset and exact byte/line ceilings", () => {
  const allowed = CONFIG + "[remote \"origin\"]\nurl = https://github.com/hraness/aicharts.git\nfetch = +refs/heads/*:refs/remotes/origin/*\n"
    + "[branch \"main\"]\nremote = origin\nmerge = refs/heads/main\n[gc]\nauto = 0\n[maintenance]\nauto = false\n";
  parseConfig(Buffer.from(allowed)); parseConfig(Buffer.from(allowed.replaceAll("\n", "\r\n")));
  parseConfig(Buffer.from(CONFIG.replace("core", "CoRe").replace("bare", "BARE") + "filemode = true\nignorecase = false\nprecomposeunicode = true\nlogallrefupdates = false\n"));
  for (const extra of ["[include]\npath = /synthetic/canary\n", "[includeIf \"gitdir:x\"]\npath = /synthetic/canary\n",
    "[extensions]\nobjectformat = sha256\n", "[extensions]\npartialclone = origin\n", "[remote \"other\"]\nurl = https://example.invalid\n",
    "[remote \"origin\"]\npromisor = true\n", "[core]\nhooksPath = /synthetic/canary\n", "[core]\nworktree = /synthetic/canary\n",
    "[filter \"canary\"]\nsmudge = /synthetic/canary\n", "[credential]\nhelper = /synthetic/canary\n", "[http]\nextraheader = synthetic-secret\n",
    "[core]\nbare = false\n", "[core]\nfilemode\n", "[core]\nfilemode = True\n", "[core]\nfilemode = \"true\"\n",
    "[core]\nfilemode = tr\\\nue\n", "[core]\nfilemode = true # inline\n", "[remote.origin]\nurl = https://github.com/hraness/aicharts\n"]) {
    refuses(() => parseConfig(Buffer.from(CONFIG + extra)), "unsupported_repository");
  }
  for (const bytes of [Buffer.from("[core]\nbare = false\n"), Buffer.from(CONFIG.replace("false", "true")), Buffer.from(CONFIG + "\0"), Buffer.from(CONFIG + "é"),
    Buffer.from(CONFIG.trimEnd() + "\r"), Buffer.from(CONFIG + "# terminal bare CR\r")]) refuses(() => parseConfig(bytes), "unsupported_repository");
  parseConfig(Buffer.from(CONFIG + "#\n".repeat(253)));
  refuses(() => parseConfig(Buffer.from(CONFIG + "#\n".repeat(254))), "limit_exceeded");
  const exact = Buffer.from(CONFIG + "#" + "x".repeat(LIMITS.config - Buffer.byteLength(CONFIG) - 1));
  parseConfig(exact); refuses(() => parseConfig(Buffer.concat([exact, Buffer.from("x")])), "limit_exceeded");
});

test("unsupported metadata and local canary configuration refuse before the first Git child", (t) => {
  const cases = [
    (repo) => { rmSync(repo.git, { recursive: true }); writeFileSync(repo.git, "gitdir: /synthetic/forbidden\n"); },
    ...["commondir", "config.worktree", "info/grafts", "objects/info/alternates", "objects/info/http-alternates"].map((relative) => (repo) => {
      mkdirSync(posix.dirname(repo.git + "/" + relative), { recursive: true }); writeFileSync(repo.git + "/" + relative, "");
    }),
    (repo) => { mkdirSync(repo.git + "/objects/pack"); writeFileSync(repo.git + "/objects/pack/pack-synthetic.promisor", ""); },
    (repo) => { mkdirSync(repo.git + "/objects/pack"); symlinkSync("/synthetic/forbidden", repo.git + "/objects/pack/canary"); },
    (repo) => { symlinkSync("/synthetic/forbidden", repo.git + "/objects/info"); },
    (repo) => { rmSync(repo.git + "/HEAD"); symlinkSync("/synthetic/forbidden", repo.git + "/HEAD"); },
    (repo) => { rmSync(repo.git + "/config"); symlinkSync("/synthetic/forbidden", repo.git + "/config"); },
    (repo) => { symlinkSync("/synthetic/forbidden", repo.git + "/shallow"); },
    (repo) => { writeFileSync(repo.git + "/config", CONFIG + "[include]\npath = /synthetic/forbidden\n"); },
    (repo) => { writeFileSync(repo.git + "/config", CONFIG + "[filter \"canary\"]\nsmudge = /synthetic/forbidden\n"); },
    (repo) => { writeFileSync(repo.git + "/config", CONFIG.trimEnd() + "\r"); },
    (repo) => { writeFileSync(repo.git + "/config", CONFIG.replace("false", "true")); },
  ];
  for (const arrange of cases) {
    const repo = fixture(t); arrange(repo);
    let calls = 0;
    bad(readWith(repo.input, () => { calls++; throw new Error("forbidden startup"); }), "unsupported_repository");
    assert.equal(calls, 0);
  }
  const repo = fixture(t), alias = repo.directory + "/alias";
  symlinkSync(repo.directory, alias);
  bad(readWith({ ...repo.input, repositoryDirectory: alias }, () => { throw new Error("must not run"); }), "unsupported_repository");
});

test("bounded pack enumeration admits 1024 entries and refuses entry 1025 before Git", (t) => {
  const repo = fixture(t); mkdirSync(repo.git + "/objects/pack");
  for (let index = 0; index < LIMITS.packs; index++) writeFileSync(repo.git + "/objects/pack/ignored-" + index, "");
  const control = fakeGit(repo); assertGraph(repo, readWith(repo.input, control.run));
  writeFileSync(repo.git + "/objects/pack/over-limit", "");
  const over = fakeGit(repo); bad(readWith(repo.input, over.run), "limit_exceeded"); assert.equal(over.calls.length, 0);
});

test("all six children use exact commands, generated OID inputs, fixed environment and checked output plans", (t) => {
  assert.deepEqual(LIMITS, { files: 2048, entries: 8192, source: 64 * 1024 * 1024,
    commit: 1024 * 1024, headers: 64 * 1024, tree: 1024 * 1024, trees: 4 * 1024 * 1024,
    listing: 3 * 1024 * 1024, config: 64 * 1024, configLines: 256, packs: 1024, childMs: 15_000, totalMs: 50_000 });
  assert.deepEqual(ENV, { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC",
    GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "" });
  const repo = fixture(t), fake = fakeGit(repo);
  assertGraph(repo, readWith(repo.input, fake.run)); assert.equal(fake.calls.length, 6);
  for (const { executable, args, options } of fake.calls) {
    assert.equal(executable, "/usr/bin/git");
    assert.deepEqual(args.slice(0, 13), ["--no-pager", "--no-replace-objects", "--no-lazy-fetch", "--no-optional-locks", "--no-advice",
      "--git-dir=" + repo.git, "--work-tree=" + repo.directory, "-c", "core.hooksPath=/dev/null", "-c", "gc.auto=0", "-c", "maintenance.auto=false"]);
    assert.deepEqual(options.env, { ...ENV }); assert.deepEqual(options.stdio, ["pipe", "pipe", "pipe"]);
    assert.equal(options.shell, false); assert.equal(options.detached, false); assert.equal(options.encoding, "buffer");
    assert.equal(options.killSignal, "SIGKILL"); assert.equal(options.cwd, repo.directory);
    assert.ok(options.timeout > 0 && options.timeout <= 15_000);
    if (args.includes("ls-tree")) {
      assert.deepEqual(args.slice(13), ["ls-tree", "-r", "-t", "-z", "--full-tree", "--format=%(objectmode) %(objecttype) %(objectname) %(objectsize)%x09%(path)", repo.input.expectedTree]);
      assert.equal(options.input.length, 0); assert.equal(options.maxBuffer, LIMITS.listing);
    } else {
      assert.match(options.input.toString("ascii"), /^(?:[0-9a-f]{40}\n)+$/);
      assert.ok(options.maxBuffer > 0 && options.maxBuffer <= LIMITS.source + 97 * LIMITS.files);
      assert.deepEqual(args.slice(13), args.includes("--batch") ? ["cat-file", "--batch", "--no-use-mailmap"] : ["cat-file", "--batch-check"]);
    }
  }
  assert.equal(fake.calls[0].options.input.toString(), repo.input.commit + "\n");
  assert.equal(fake.calls[1].options.input.toString(), repo.input.commit + "\n");
});

test("commit timestamp is the unique committer epoch, bounded independently of identities and message", () => {
  const tree = "2".repeat(40), bytes = bodyOfCommit(tree);
  assert.equal(commitTime(bytes, tree), new Date(EPOCH * 1000).toISOString().replace(".000Z", "Z"));
  assert.equal(commitTime(bodyOfCommit(tree, "", "0", "-2359"), tree), "1970-01-01T00:00:00Z");
  assert.equal(commitTime(bodyOfCommit(tree, "", "8589934591"), tree), "2242-03-16T12:56:31Z");
  assert.equal(commitTime(bodyOfCommit(tree, "gpgsig synthetic\n tree not-a-header\n committer not-a-header\n"), tree), commitTime(bytes, tree));
  for (const malformed of [bodyOfCommit(tree, "tree " + tree + "\n"), bodyOfCommit(tree, "committer " + PERSON + " 1 +0000\n"),
    bodyOfCommit(tree, "", "01"), bodyOfCommit(tree, "", "-1"), bodyOfCommit(tree, "", "8589934592"),
    bodyOfCommit(tree, "", "1", "+2400"), bodyOfCommit(tree, "", "1", "+0060"),
    Buffer.from(bytes.toString().replace("committer ", "not-committer ")), Buffer.from(bytes.toString().replace("\n\n", "\n")),
    Buffer.from(bytes.toString().replace("author ", "author\0 ")), Buffer.from(bytes.toString().replace("tree ", " tree ")),
    Buffer.from(bytes.toString().replace("+1230\n", "+1230\r\n"))]) refuses(() => commitTime(malformed, tree), "invalid_object");
  refuses(() => commitTime(bytes, "3".repeat(40)), "invalid_object");
  const header = "tree " + tree + "\ncommitter " + PERSON + " 1 +0000\nx ";
  const exact = Buffer.from(header + "q".repeat(LIMITS.headers - Buffer.byteLength(header)) + "\n\nmessage");
  commitTime(exact, tree);
  refuses(() => commitTime(Buffer.from(exact.toString().replace("\n\n", "q\n\n")), tree), "limit_exceeded");
});

test("batch framing checks OID/type/hash, canonical sizes, exact trailers and final EOF", () => {
  const bytes = Buffer.from([0, 10, 255, 0]), oid = gitHash("blob", bytes);
  const request = { oid, type: "blob", size: bytes.length, max: bytes.length };
  const full = Buffer.concat([Buffer.from(oid + " blob 4\n"), bytes, Buffer.from("\n")]);
  assert.deepEqual(parseBatch(full, [request], true)[0].bytes, bytes);
  for (const changed of [Buffer.from(oid + " blob 04\n"), Buffer.from(oid + " commit 4\n"), Buffer.from("1".repeat(40) + " blob 4\n"),
    Buffer.from(oid + " blob 4\r\n"), Buffer.from(oid + " blob 4\n\n"),
    full.subarray(0, full.length - 1), Buffer.concat([full, Buffer.from("extra")]), Buffer.from(oid + " blob " + "9".repeat(60) + "\n"),
    Buffer.concat([Buffer.from(oid + " blob 4\n"), Buffer.from("xxxx\n")])]) refuses(() => parseBatch(changed, [request], true), "invalid_object");
  refuses(() => parseBatch(Buffer.from(oid + " missing\n"), [request], false), "missing_object");
  refuses(() => parseBatch(Buffer.from(oid + " blob 5\n"), [request], false), "limit_exceeded");
  refuses(() => parseBatch(Buffer.from(oid + " blob 3\n"), [request], false), "invalid_object");
  const empty = Buffer.alloc(0), emptyOid = gitHash("blob", empty);
  assert.equal(parseBatch(Buffer.from(emptyOid + " blob 0\n\n"), [{ oid: emptyOid, type: "blob", size: 0, max: 0 }], true)[0].bytes.length, 0);
});

test("listing preserves complete names, per-path costs and collisions under exact limits", () => {
  const oid = "1".repeat(40), tree = "2".repeat(40);
  const blobLine = (path, size = 1, object = oid, mode = "100644") => mode + " blob " + object + " " + size + "\t" + path + "\0";
  const treeLine = (path) => "040000 tree " + tree + " -\t" + path + "\0";
  parseListing(Buffer.from(blobLine("a", LIMITS.source)));
  refuses(() => parseListing(Buffer.from(blobLine("a", LIMITS.source + 1))), "limit_exceeded");
  refuses(() => parseListing(Buffer.from(blobLine("a", LIMITS.source) + blobLine("b", LIMITS.source))), "limit_exceeded");
  refuses(() => parseListing(Buffer.from(blobLine("a", 1) + blobLine("b", 2))), "invalid_object");
  for (const text of [blobLine("a") + blobLine("a"), blobLine("a") + blobLine("A"), blobLine("a") + blobLine("a/b"),
    blobLine("missing/parent"), treeLine("A") + blobLine("a/file"), blobLine("sym", 1, oid, "120000"),
    "160000 commit " + oid + " -\tmodule\0", blobLine("a").slice(0, -1), "040000 tree " + tree + " 1\tdir\0"]) refuses(() => parseListing(Buffer.from(text)), "invalid_source");
  for (const path of ["../x", "a//b", "a/./b", "bad.", "nul.txt", "COM1", "x y", "é", "slash\\x", "newline\nx",
    "trailing\n", "trailing\r", "trailing\r\n", "x".repeat(257)]) {
    refuses(() => sourcePath(path), "invalid_source");
  }
  sourcePath("x/" + "y".repeat(254));
  const files = Array.from({ length: LIMITS.files }, (_, index) => blobLine("f" + index));
  assert.equal(parseListing(Buffer.from(files.join(""))).entries.size, LIMITS.files);
  refuses(() => parseListing(Buffer.from(files.join("") + blobLine("extra"))), "limit_exceeded");
  const entries = [];
  for (let index = 0; index < 1024; index++) {
    let prefix = "g" + index;
    const depth = index === 1023 ? 6 : 7;
    for (let level = 0; level < depth; level++) { entries.push(treeLine(prefix)); prefix += "/d"; }
    entries.push(blobLine(prefix));
  }
  assert.equal(entries.length, LIMITS.entries - 1);
  assert.equal(parseListing(Buffer.from(entries.join(""))).entries.size, LIMITS.entries - 1);
  refuses(() => parseListing(Buffer.from(entries.join("") + treeLine("extra"))), "limit_exceeded");
  refuses(() => parseListing(Buffer.alloc(LIMITS.listing + 1)), "limit_exceeded");
});

test("raw tree modes and full graph membership refuse omissions, extras, empty trees and malformed entries", () => {
  const blob = "1".repeat(40), root = "2".repeat(40), subtree = "3".repeat(40);
  assert.deepEqual(decodeTree(rawEntry("file", "100755", blob)), [{ name: "file", mode: "100755", type: "blob", oid: blob }]);
  for (const raw of [Buffer.from("100644 no-nul"), rawEntry("file", "100644", blob).subarray(0, -1), rawEntry("", "100644", blob),
    rawEntry("file", "0100644", blob)]) refuses(() => decodeTree(raw), "invalid_object");
  for (const raw of [rawEntry("file", "120000", blob), rawEntry("module", "160000", blob),
    rawEntry("a/b", "100644", blob), Buffer.concat([rawEntry("same", "100644", blob), rawEntry("same", "100644", blob)])]) refuses(() => decodeTree(raw), "invalid_source");
  const listing = parseListing(Buffer.from("040000 tree " + subtree + " -\tdir\0" + "100644 blob " + blob + " 1\tdir/file\0"));
  const trees = new Map([[root, decodeTree(rawEntry("dir", "40000", subtree))], [subtree, decodeTree(rawEntry("file", "100644", blob))]]);
  reconcile(root, trees, listing);
  refuses(() => reconcile(root, new Map([[root, trees.get(root)]]), listing), "invalid_source");
  refuses(() => reconcile(root, new Map([[root, []]]), parseListing(Buffer.alloc(0))), "invalid_source");
  refuses(() => reconcile(root, new Map([[root, trees.get(root)], [subtree, []]]), listing), "invalid_source");
  refuses(() => reconcile(root, trees, parseListing(Buffer.from("100644 blob " + blob + " 1\textra\0"))), "invalid_source");
  const extra = parseListing(Buffer.from("040000 tree " + subtree + " -\tdir\0" + "100644 blob " + blob + " 1\tdir/file\0" + "100644 blob " + blob + " 1\textra\0"));
  refuses(() => reconcile(root, trees, extra), "invalid_source");
  const exact = Buffer.concat(Array.from({ length: LIMITS.entries }, (_, index) => rawEntry("f" + index, "100644", blob)));
  assert.equal(decodeTree(exact).length, LIMITS.entries);
  refuses(() => decodeTree(Buffer.concat([exact, rawEntry("extra", "100644", blob)])), "limit_exceeded");
});

test("end-to-end protocol adversaries stop at the failing boundary and expose only fixed errors", (t) => {
  const repo = fixture(t);
  const change = (target, alter, expected, stopped = target) => {
    const fake = fakeGit(repo, (result, index, call) => index === target ? alter(result, call) : result);
    bad(readWith(repo.input, fake.run), expected); assert.equal(fake.calls.length, stopped);
  };
  change(1, (r) => ({ ...r, stdout: Buffer.from(repo.input.commit + " missing\n") }), "missing_object");
  change(1, (r) => ({ ...r, stdout: Buffer.from(repo.input.commit + " commit " + (LIMITS.commit + 1) + "\n") }), "limit_exceeded");
  change(1, (r) => {
    const header = repo.input.commit + " commit " + repo.objects.get(repo.input.commit).bytes.length;
    assert.deepEqual(r.stdout, Buffer.from(header + "\n"));
    // Construct one malformed batch header; this is not a string sanitizer.
    return { ...r, stdout: Buffer.from(header + "\r\n") };
  }, "invalid_object");
  change(1, (r) => ({ ...r, stdout: Buffer.concat([r.stdout, Buffer.from("\n")]) }), "invalid_object");
  change(2, (r) => { const stdout = Buffer.from(r.stdout); stdout[stdout.length - 3] ^= 1; return { ...r, stdout }; }, "invalid_object");
  change(3, (r) => ({ ...r, stdout: Buffer.from(r.stdout.toString().split("\0").filter((line) => !line.endsWith("\tignored.txt")).join("\0")) }), "invalid_source", 5);
  change(3, (r) => ({ ...r, stdout: Buffer.from(r.stdout.toString().replace(/100644 blob ([0-9a-f]{40}) ([0-9]+)\tignored.txt/, "100755 blob $1 $2\tignored.txt")) }), "invalid_source", 5);
  change(3, (r) => ({ ...r, stdout: Buffer.concat([r.stdout, Buffer.from("100644 blob " + "a".repeat(40) + " 1\textra\0")]) }), "invalid_source", 5);
  for (const suffix of ["\n", "\r", "\r\n"]) {
    change(3, (r) => ({ ...r, stdout: Buffer.from(r.stdout.toString().replace("\tignored.txt\0", "\tignored.txt" + suffix + "\0")) }), "invalid_source");
  }
  change(4, (r) => ({ ...r, stdout: Buffer.from(r.stdout.toString().replace(/tree [0-9]+/, "tree " + (LIMITS.tree + 1))) }), "limit_exceeded");
  change(5, (r) => { const stdout = Buffer.from(r.stdout); stdout[stdout.length - 3] ^= 1; return { ...r, stdout }; }, "invalid_object");
  change(6, (r) => { const stdout = Buffer.from(r.stdout); stdout[stdout.length - 3] ^= 1; return { ...r, stdout }; }, "invalid_object");
  for (let stage = 1; stage <= 6; stage++) {
    change(stage, (r) => ({ ...r, stderr: Buffer.from("synthetic-private-canary") }), "git_failed");
    change(stage, (r) => ({ ...r, status: 1 }), "git_failed");
    change(stage, (r) => ({ ...r, signal: "SIGKILL" }), "git_failed");
    change(stage, (r) => ({ ...r, error: { code: "ETIMEDOUT", message: "synthetic-private-canary" } }), "deadline_exceeded");
    change(stage, (r) => ({ ...r, error: { code: "ENOBUFS" } }), "limit_exceeded");
    change(stage, (r, call) => ({ ...r, stdout: Buffer.alloc(call.options.maxBuffer + 1) }), "limit_exceeded");
  }
  const thrown = fakeGit(repo, () => { throw new Error("synthetic-private-canary"); });
  bad(readWith(repo.input, thrown.run), "git_failed"); assert.equal(thrown.calls.length, 1);
  repo.input.commit = repo.put("commit", Buffer.from(bodyOfCommit(repo.input.expectedTree).toString().replace("+1230\n", "+1230\r\n")));
  const crCommit = fakeGit(repo);
  bad(readWith(repo.input, crCommit.run), "invalid_object"); assert.equal(crCommit.calls.length, 2);
});

test("commit and aggregate tree byte limits are planned before any oversized body request", (t) => {
  const repo = fixture(t, [...controls(), file("another/tree", "distinct subtree\n")]);
  const exactCommit = fakeGit(repo, (result, stage) => stage === 1
    ? { ...result, stdout: Buffer.from(repo.input.commit + " commit " + LIMITS.commit + "\n") } : result);
  bad(readWith(repo.input, exactCommit.run), "invalid_object");
  assert.equal(exactCommit.calls.length, 2); // Accepted size, then actual body/header mismatch.
  const overTrees = fakeGit(repo, (result, stage) => stage === 4
    ? { ...result, stdout: Buffer.from(result.stdout.toString().replace(/tree [0-9]+/g, "tree " + LIMITS.tree)) } : result);
  bad(readWith(repo.input, overTrees.run), "limit_exceeded"); assert.equal(overTrees.calls.length, 4);
  let planned = 0;
  const exactTrees = fakeGit(repo, (result, stage) => {
    if (stage !== 4) return result;
    const lines = result.stdout.toString().trimEnd().split("\n");
    assert.ok(lines.length > 4);
    return { ...result, stdout: Buffer.from(lines.map((line, index) => {
      const size = index < 4 ? LIMITS.tree : 0;
      planned += size;
      return line.replace(/tree [0-9]+$/, "tree " + size) + "\n";
    }).join("")) };
  });
  bad(readWith(repo.input, exactTrees.run), "invalid_object");
  assert.equal(planned, LIMITS.trees); assert.equal(exactTrees.calls.length, 5);
});

test("global elapsed deadline and per-child timeout shrink without sleeps or retries", (t) => {
  const repo = fixture(t);
  let clock = 0;
  const fake = fakeGit(repo, (result, index) => { if (index === 1) clock = 48_500; return result; });
  assertGraph(repo, readWith(repo.input, fake.run, () => clock));
  assert.equal(fake.calls[0].options.timeout, 15_000);
  assert.deepEqual(fake.calls.slice(1).map(({ options }) => options.timeout), [1500, 1500, 1500, 1500, 1500]);
  clock = 0;
  const expired = fakeGit(repo, (result, index) => { if (index === 2) clock = 50_000; return result; });
  bad(readWith(repo.input, expired.run, () => clock), "deadline_exceeded"); assert.equal(expired.calls.length, 2);
  for (const invalidClock of [() => NaN, (() => { let calls = 0; return () => calls++ ? -1 : 0; })()]) {
    const invalid = fakeGit(repo); bad(readWith(repo.input, invalid.run, invalidClock), "deadline_exceeded"); assert.equal(invalid.calls.length, 0);
  }
});

test("metadata changes before return invalidate the complete source graph", (t) => {
  for (const mutate of [
    (repo) => writeFileSync(repo.git + "/config", CONFIG + "# changed\n"),
    (repo) => writeFileSync(repo.git + "/HEAD", "ref: refs/heads/other\n"),
    (repo) => writeFileSync(repo.git + "/shallow", repo.input.commit + "\n"),
    (repo) => { mkdirSync(repo.git + "/objects/pack"); writeFileSync(repo.git + "/objects/pack/added.promisor", ""); },
  ]) {
    const repo = fixture(t), fake = fakeGit(repo, (result, stage) => { if (stage === 6) mutate(repo); return result; });
    bad(readWith(repo.input, fake.run), "repository_changed"); assert.equal(fake.calls.length, 6);
  }
});

test("deterministic synthetic graph variations preserve bytes, modes, duplicates and ordering", (t) => {
  for (let seed = 1; seed <= 24; seed++) {
    const files = [];
    for (let index = 0; index < 1 + seed % 11; index++) {
      const bytes = Buffer.from(Array.from({ length: (seed * 11 + index * 3) % 67 }, (_, n) => (seed + index + n * 61) % 256));
      files.push(file("g" + seed % 3 + "/f" + index, bytes, index % 3 === 0 ? 0o755 : 0o644));
    }
    const repo = fixture(t, files), fake = fakeGit(repo);
    assertGraph(repo, readWith(repo.input, fake.run)); assert.equal(fake.calls.length, 6);
  }
});

test("the complete synthetic source joins the real assembler without executing an artifact", async (t) => {
  // Candidate-only override: after integration the assembler is a local sibling.
  // This is a test import, not a source-reader executable or filesystem override.
  const url = process.env.AICHARTS_GIT_ASSEMBLER_URL ? new URL(process.env.AICHARTS_GIT_ASSEMBLER_URL) : new URL("./assemble.mjs", import.meta.url);
  assert.equal(url.protocol, "file:"); assert.ok(existsSync(url));
  if (process.env.AICHARTS_GIT_ASSEMBLER_URL) assert.equal(sha(readFileSync(url)), "4243027639a6f3c35ee80f15a0fd4bc65f6a2bda9ffcb9e6e7842b17af2fb21f");
  const { assembleLinuxRelease } = await import(pathToFileURL(realpathSync(url)).href);
  const required = ["LICENSE", "NOTICE.md", "Cargo.lock", "bun.lock", "Cargo.toml", "crates/aicharts-cli/Cargo.toml", "rust-toolchain.toml",
    "distribution/NOTICE.md", "distribution/cli/docs/usage-install.md", "distribution/cli/docs/usage-local.md",
    "skills/aicharts/SKILL.md", "skills/aicharts/agents/openai.yaml", "skills/aicharts/references/benchmarks.md",
    "skills/aicharts/references/local-usage.md", "skills/aicharts/scripts/atlas.mjs", "skills/aicharts/scripts/atlas.check.mjs"];
  const repo = fixture(t, [...required.map((path) => file(path, "Synthetic required source: " + path + "\n")), ...controls()]);
  const selected = assertGraph(repo, readGitSource(repo.input));
  const result = good(assembleLinuxRelease({ ...selected, version: "0.1.0", run: { runId: "42", runAttempt: 1 },
    toolchain: { rustChannel: "1.97.1", nodeMajor: 24, bunVersion: "1.3.14" },
    target: { triple: "x86_64-unknown-linux-gnu", os: "linux", arch: "x86_64", osFloor: "ubuntu-22.04", libcFloor: "glibc-2.35",
      cpuBaseline: "x86-64", runnerLabel: "ubuntu-22.04", runnerImageVersion: "20260907.12.1", cCompiler: { name: "gcc", version: "11.4.0" },
      dynamicDependencies: ["libc.so.6", "libgcc_s.so.1"] },
    executableBytes: Buffer.from("synthetic executable; NEVER EXECUTED\n"), thirdPartyLicenseBytes: Buffer.from("synthetic notice; NOT qualified license coverage\n") }));
  assert.equal(result.files.length, 5);
  const manifest = JSON.parse(result.files.find((entry) => entry.name === "release-manifest.json").bytes.toString());
  assert.equal(manifest.source.tree, repo.input.expectedTree);
  assert.equal(manifest.workflow.sourceCommit, repo.input.commit);
  assert.deepEqual(manifest.assets.find((asset) => asset.kind === "source").files,
    [...repo.files].sort((a, b) => order(a.path, b.path)).map((entry) => ({ path: entry.path,
      mode: entry.mode, bytes: entry.bytes.length, sha256: sha(entry.bytes) })));
  for (const asset of result.files) { assert.equal(asset.sha256, sha(asset.bytes)); assert.equal(asset.bytes.byteOffset, 0); }
});
