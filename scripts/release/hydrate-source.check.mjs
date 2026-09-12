import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { posix } from "node:path";
import { test } from "node:test";
import * as publicModule from "./hydrate-source.mjs";

// Private effect seams exist only in this in-memory copy, not the public API.
const implementation = fs.readFileSync(new URL("./hydrate-source.mjs", import.meta.url), "utf8");
const privateModule = await import("data:text/javascript;base64," + Buffer.from(implementation
  + "\nexport { hydrateWith, prepare, LIMITS, IO };\n").toString("base64"));
const { hydrateReleaseSource } = publicModule;
const { hydrateWith, prepare, LIMITS, IO } = privateModule;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const item = (path = "a", text = "abc", mode = 0o644) => ({ path, bytes: Buffer.from(text), mode });
const codes = new Set(["invalid_input", "unsupported_destination", "invalid_source", "limit_exceeded",
  "destination_exists", "source_changed", "write_failed"]);
const good = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
function bad(result, code) {
  assert.deepEqual(Object.keys(result), ["ok", "error"]); assert.equal(result.ok, false);
  assert.ok(codes.has(result.error)); assert.ok(Object.isFrozen(result));
  if (code) assert.equal(result.error, code);
}
function rejected(operation, code) {
  assert.throws(operation, (error) => { bad(error, code); return true; });
}
function fixture(t, sourceFiles = [item()]) {
  const base = fs.mkdtempSync(posix.join(fs.realpathSync(tmpdir()), "aicharts-hydrate-"));
  fs.chmodSync(base, 0o700);
  const original = fs.lstatSync(base), parent = base + "/private", destination = parent + "/source";
  fs.mkdirSync(parent, { mode: 0o700 }); fs.chmodSync(parent, 0o700);
  t.after(() => {
    const current = fs.lstatSync(base);
    assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, original.dev); assert.equal(current.ino, original.ino);
    // Exact synthetic directory created above; never a caller-selected target.
    fs.rmSync(base, { recursive: true, force: false });
  });
  return { base, parent, destination, input: { destinationDirectory: destination, sourceFiles } };
}
function assertPayload(f, value) {
  const sorted = [...f.input.sourceFiles].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  assert.deepEqual(value.inventory, sorted.map(({ path, mode, bytes }) => ({ path, mode, bytes: bytes.length, sha256: digest(bytes) })));
  assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.inventory));
  for (const record of value.inventory) assert.ok(Object.isFrozen(record));
  for (const file of sorted) {
    assert.deepEqual(fs.readFileSync(f.destination + "/" + file.path), file.bytes);
    const stat = fs.lstatSync(f.destination + "/" + file.path);
    assert.ok(stat.isFile()); assert.equal(stat.mode & 0o7777, file.mode); assert.equal(stat.nlink, 1);
  }
  assert.equal(fs.lstatSync(f.destination).mode & 0o7777, 0o700);
  assert.equal(fs.lstatSync(f.parent).mode & 0o7777, 0o700);
}

test("one public export and exact unknown input fail before any filesystem effect", () => {
  assert.deepEqual(Object.keys(publicModule), ["hydrateReleaseSource"]);
  let calls = 0, getters = 0;
  const forbiddenIO = new Proxy({}, { get() { calls++; throw new Error("PRIVATE_IO_CANARY"); } });
  const input = { destinationDirectory: "/synthetic/private/source", sourceFiles: [item()] };
  const accessor = { ...input };
  Object.defineProperty(accessor, "sourceFiles", { enumerable: true, get() { getters++; return input.sourceFiles; } });
  const revoked = Proxy.revocable(input, {}); revoked.revoke();
  for (const value of [undefined, null, 1, false, [], new Date(), Object.create(input), accessor,
    new Proxy(input, { ownKeys() { getters++; return []; } }), revoked.proxy,
    { ...input, extra: true }, { ...input, [Symbol("extra")]: true },
    ...["", "/", "relative", "/tmp/a/", "/tmp//a", "/tmp/a/../b", "/tmp/./a", "/tmp/a\nb", "/tmp/a\0b",
      "/" + "a".repeat(4096)].map((destinationDirectory) => ({ ...input, destinationDirectory }))]) {
    bad(hydrateWith(value, forbiddenIO), "invalid_input");
  }
  assert.equal(calls, 0); assert.equal(getters, 0);
});

test("binary/empty/dot files and exact source modes hydrate into an absent child", (t) => {
  const f = fixture(t, [item("nested/bin/tool", "not executed\n", 0o755), item(".gitattributes", "a export-ignore\n"),
    item("empty", ""), item("a", Buffer.from([0, 255, 10, 13, 128])),
    item("plus+at@(brackets)[ok]/tail", "raw bytes"), item("copy-a", "same"), item("copy-b", "same")]);
  const result = hydrateReleaseSource(f.input);
  assert.ok(Object.isFrozen(result)); assertPayload(f, good(result));
  for (const relative of ["nested", "nested/bin", "plus+at@(brackets)[ok]"]) assert.equal(fs.lstatSync(f.destination + "/" + relative).mode & 0o7777, 0o755);
  assert.notEqual(fs.lstatSync(f.destination + "/copy-a").ino, fs.lstatSync(f.destination + "/copy-b").ino);
  assert.deepEqual(fs.readdirSync(f.parent), ["source"]);
});

test("null-prototype records and intrinsic fixed byte views are admitted without their callbacks", (t) => {
  const backing = Buffer.from("PRIVATE_PREFIXabcPRIVATE_SUFFIX"), view = backing.subarray(14, 17);
  assert.deepEqual(view, Buffer.from("abc"));
  let callbacks = 0;
  Object.defineProperty(view, "byteLength", { get() { callbacks++; throw new Error("unexpected"); } });
  view.subarray = () => { callbacks++; throw new Error("unexpected"); };
  const f = fixture(t, [Object.assign(Object.create(null), { path: "a", mode: 0o644, bytes: view })]);
  const result = hydrateReleaseSource(Object.assign(Object.create(null), f.input));
  assert.equal(good(result).inventory[0].sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.deepEqual(fs.readFileSync(f.destination + "/a"), Buffer.from("abc")); assert.equal(callbacks, 0);
});

test("the entire source graph is copied before any destination operation", (t) => {
  const f = fixture(t, [item("a", "first"), item("b", "second")]);
  let changed = false;
  const io = { ...IO, lstatSync(...args) {
    if (!changed) { changed = true; for (const file of f.input.sourceFiles) file.bytes.fill(120); f.input.sourceFiles[0].path = "changed"; }
    return fs.lstatSync(...args);
  } };
  const value = good(hydrateWith(f.input, io));
  assert.deepEqual(value.inventory.map((file) => file.path), ["a", "b"]);
  assert.equal(fs.readFileSync(f.destination + "/a", "utf8"), "first");
  assert.equal(fs.readFileSync(f.destination + "/b", "utf8"), "second");
  assert.equal(fs.existsSync(f.destination + "/changed"), false);
});

test("invalid source metadata, exotic arrays and byte storage perform no filesystem effect", () => {
  let calls = 0, getters = 0;
  const forbiddenIO = new Proxy({}, { get() { calls++; throw new Error("unexpected"); } });
  const input = { destinationDirectory: "/synthetic/private/source", sourceFiles: [item()] };
  const accessor = item(); Object.defineProperty(accessor, "bytes", { enumerable: true, get() { getters++; return Buffer.alloc(1); } });
  const arrAccessor = []; Object.defineProperty(arrAccessor, 0, { enumerable: true, get() { getters++; return item(); } });
  const revokedArray = Proxy.revocable([item()], {}); revokedArray.revoke();
  const detached = new Uint8Array(new ArrayBuffer(8)); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  const invalidBytes = [null, "abc", [1], new DataView(new ArrayBuffer(1)), new Uint16Array(1),
    new Uint8Array(new SharedArrayBuffer(1)), new Uint8Array(new ArrayBuffer(1, { maxByteLength: 2 })), detached,
    new Proxy(Buffer.from("abc"), { get() { getters++; throw new Error("unexpected"); } })];
  const sources = [[], null, {}, new Array(1), arrAccessor, revokedArray.proxy, Object.assign([item()], { extra: true }),
    new Proxy([item()], { get() { getters++; throw new Error("unexpected"); } }),
    [accessor], [Object.create(item())], [{ ...item(), extra: true }], [{ ...item(), [Symbol("extra")]: true }],
    ...invalidBytes.map((bytes) => [{ ...item(), bytes }]),
    ...[0, 0o600, 0o777, 0o100644, "644"].map((mode) => [{ ...item(), mode }])];
  for (const sourceFiles of sources) bad(hydrateWith({ ...input, sourceFiles }, forbiddenIO), "invalid_source");
  assert.equal(calls, 0); assert.equal(getters, 0);
});

test("source path and collision policy refuses the complete graph before writing", () => {
  const input = { destinationDirectory: "/synthetic/private/source", sourceFiles: [item()] };
  let effects = 0;
  const io = new Proxy({}, { get() { effects++; throw new Error("unexpected"); } });
  const paths = ["", "/a", "a/", "a//b", ".", "..", "a/../b", "a/./b", "a\\b", "a b", "a\nb", "a\rb", "a\0b", "é",
    "CON", "con.txt", "LPT9.x", "a/NUL", "a.", "a".repeat(256), "a".repeat(128) + "/" + "b".repeat(128)];
  for (const path of paths) bad(hydrateWith({ ...input, sourceFiles: [item(path)] }, io), "invalid_source");
  for (const paths of [["a", "a"], ["a", "A"], ["a", "a/b"], ["a/b", "a"], ["a/b", "A/c"], ["a/B", "a/b/c"]]) {
    bad(hydrateWith({ ...input, sourceFiles: paths.map((path) => item(path)) }, io), "invalid_source");
  }
  assert.equal(effects, 0);
  const exact = "a".repeat(127) + "/" + "b".repeat(128);
  assert.equal(prepare({ ...input, sourceFiles: [item(exact)] }).files[0].path, exact);
});

test("the exact source/count/entry bounds are admitted and one beyond refuses", () => {
  assert.deepEqual(LIMITS, { files: 2048, entries: 8192, source: 67108864, path: 256, destination: 4096, chunk: 65536 });
  const input = { destinationDirectory: "/synthetic/private/source", sourceFiles: [] };
  const count = Array.from({ length: 2048 }, (_, i) => item("f" + i, ""));
  assert.equal(prepare({ ...input, sourceFiles: count }).files.length, 2048);
  rejected(() => prepare({ ...input, sourceFiles: [...count, item("last", "")] }), "limit_exceeded");
  const entries = Array.from({ length: 2048 }, (_, i) => item("d" + i + (i === 0 ? "/a/f" : "/a/b/f"), ""));
  assert.equal(prepare({ ...input, sourceFiles: entries }).entries.size, 8192);
  entries[0] = item("d0/a/b/f", "");
  rejected(() => prepare({ ...input, sourceFiles: entries }), "limit_exceeded");
  const data = Buffer.alloc(LIMITS.source + 1, 42);
  const exact = prepare({ ...input, sourceFiles: [{ path: "a", mode: 0o644, bytes: data.subarray(0, LIMITS.source) }] });
  assert.equal(exact.files[0].bytes.length, LIMITS.source); assert.notEqual(exact.files[0].bytes.buffer, data.buffer);
  assert.equal(exact.files[0].bytes.byteOffset, 0); assert.equal(exact.files[0].bytes.buffer.byteLength, LIMITS.source);
  rejected(() => prepare({ ...input, sourceFiles: [{ path: "a", mode: 0o644, bytes: data }] }), "limit_exceeded");
  rejected(() => prepare({ ...input, sourceFiles: [item("b", "!"), { path: "a", mode: 0o644, bytes: data.subarray(0, LIMITS.source) }] }), "limit_exceeded");
});

test("only an existing owned mode0700 ordinary immediate parent is supported", (t) => {
  for (const permission of [0o755, 0o750, 0o770, 0o1700]) {
    const f = fixture(t); fs.chmodSync(f.parent, permission);
    bad(hydrateReleaseSource(f.input), "unsupported_destination"); assert.equal(fs.existsSync(f.destination), false);
  }
  const absent = fixture(t); fs.rmdirSync(absent.parent);
  bad(hydrateReleaseSource(absent.input), "unsupported_destination"); assert.equal(fs.existsSync(absent.parent), false);
  const linked = fixture(t); fs.renameSync(linked.parent, linked.base + "/elsewhere"); fs.symlinkSync(linked.base + "/elsewhere", linked.parent);
  bad(hydrateReleaseSource(linked.input), "unsupported_destination"); assert.equal(fs.existsSync(linked.base + "/elsewhere/source"), false);
  const foreign = fixture(t);
  bad(hydrateWith(foreign.input, { ...IO, getuid: () => process.getuid() + 1 }), "unsupported_destination");
  const unknown = fixture(t);
  bad(hydrateWith(unknown.input, { ...IO, getuid: () => undefined }), "unsupported_destination");
});

test("existing directories, files, and symlinks are never overwritten or adopted", (t) => {
  for (const kind of ["directory", "file", "symlink"]) {
    const f = fixture(t);
    if (kind === "directory") { fs.mkdirSync(f.destination); fs.writeFileSync(f.destination + "/canary", "preserve"); }
    else if (kind === "file") fs.writeFileSync(f.destination, "preserve");
    else fs.symlinkSync("/synthetic/nonexistent", f.destination);
    const before = fs.lstatSync(f.destination);
    bad(hydrateReleaseSource(f.input), "destination_exists");
    const after = fs.lstatSync(f.destination); assert.equal(after.ino, before.ino); assert.equal(after.mode, before.mode);
    if (kind === "directory") assert.equal(fs.readFileSync(f.destination + "/canary", "utf8"), "preserve");
    else if (kind === "file") assert.equal(fs.readFileSync(f.destination, "utf8"), "preserve");
    else assert.equal(fs.readlinkSync(f.destination), "/synthetic/nonexistent");
  }
});

test("a destination creation race is refused without modifying the competing directory", (t) => {
  const f = fixture(t);
  const io = { ...IO, mkdirSync(path, options) {
    if (path === f.destination) { fs.mkdirSync(path); fs.writeFileSync(path + "/canary", "competitor"); }
    return fs.mkdirSync(path, options);
  } };
  bad(hydrateWith(f.input, io), "destination_exists");
  assert.equal(fs.readFileSync(f.destination + "/canary", "utf8"), "competitor");
  assert.equal(fs.existsSync(f.destination + "/a"), false);
});

test("a nested collision refuses without overwrite or destructive rollback", (t) => {
  const f = fixture(t, [item("nested/a")]);
  const io = { ...IO, mkdirSync(path, options) {
    const result = fs.mkdirSync(path, options);
    if (path === f.destination) { fs.mkdirSync(path + "/nested"); fs.writeFileSync(path + "/nested/canary", "competitor"); }
    return result;
  } };
  bad(hydrateWith(f.input, io), "source_changed");
  assert.equal(fs.readFileSync(f.destination + "/nested/canary", "utf8"), "competitor");
  assert.equal(fs.existsSync(f.destination + "/nested/a"), false);
});

test("partial positive writes and reads preserve every byte with fixed chunk ceilings", (t) => {
  const f = fixture(t, [item("a", Buffer.alloc(65536 + 9, 173))]);
  let writes = 0, reads = 0;
  const io = { ...IO, writeSync(fd, bytes, offset, length, position) {
    assert.ok(length <= 65536); writes++; return fs.writeSync(fd, bytes, offset, Math.min(length, 4096), position);
  }, readSync(fd, bytes, offset, length, position) {
    assert.ok(length <= 65536); reads++; return fs.readSync(fd, bytes, offset, Math.min(length, 4096), position);
  } };
  assertPayload(f, good(hydrateWith(f.input, io))); assert.equal(writes, 17); assert.equal(reads, 18);
});

test("write errors and zero progress retain partial created files, close descriptors, and stop", (t) => {
  for (const fault of ["throw", "zero", "overflow"]) {
    const f = fixture(t, [item("a", "abcdef"), item("later", "not reached")]);
    const opened = new Set(); let calls = 0;
    const io = { ...IO, openSync(...args) { const fd = fs.openSync(...args); opened.add(fd); return fd; },
      closeSync(fd) { opened.delete(fd); return fs.closeSync(fd); },
      writeSync(fd, bytes, offset, length, position) {
        if (++calls === 1) return fs.writeSync(fd, bytes, offset, 2, position);
        if (fault === "throw") throw Object.assign(new Error("PRIVATE_DISK_CANARY"), { code: "ENOSPC" });
        return fault === "zero" ? 0 : length + 1;
      } };
    bad(hydrateWith(f.input, io), "write_failed"); assert.equal(opened.size, 0); assert.equal(calls, 2);
    assert.equal(fs.readFileSync(f.destination + "/a", "utf8"), "ab");
    assert.equal(fs.existsSync(f.destination + "/later"), false);
  }
});

test("chmod and close failures preserve their created target without claiming success", (t) => {
  for (const fault of ["chmod", "close"]) {
    const f = fixture(t); let injected = false;
    const io = { ...IO, fchmodSync(fd, permission) {
      if (fault === "chmod" && permission === 0o644) { injected = true; throw new Error("PRIVATE_CHMOD_CANARY"); }
      return fs.fchmodSync(fd, permission);
    }, closeSync(fd) {
      const isFile = fs.fstatSync(fd).isFile(); fs.closeSync(fd);
      if (fault === "close" && isFile && !injected) { injected = true; throw new Error("PRIVATE_CLOSE_CANARY"); }
    } };
    bad(hydrateWith(f.input, io), "write_failed"); assert.equal(injected, true);
    assert.equal(fs.readFileSync(f.destination + "/a", "utf8"), "abc");
  }
});

test("complete final enumeration detects extra, missing, symlinked, and hard-linked source entries", (t) => {
  for (const mutation of ["extra", "missing", "symlink", "hardlink", "mode", "bytes"]) {
    const f = fixture(t); let changed = false;
    const io = { ...IO, opendirSync(path) {
      if (!changed) {
        changed = true;
        if (mutation === "extra") fs.writeFileSync(f.destination + "/extra", "unexpected");
        if (mutation === "missing") fs.unlinkSync(f.destination + "/a");
        if (mutation === "symlink") { fs.unlinkSync(f.destination + "/a"); fs.symlinkSync("/synthetic/forbidden", f.destination + "/a"); }
        if (mutation === "hardlink") fs.linkSync(f.destination + "/a", f.parent + "/linked");
        if (mutation === "mode") fs.chmodSync(f.destination + "/a", 0o755);
        if (mutation === "bytes") fs.writeFileSync(f.destination + "/a", "xyz");
      }
      return fs.opendirSync(path);
    } };
    bad(hydrateWith(f.input, io), "source_changed"); assert.equal(changed, true);
    assert.ok(fs.lstatSync(f.destination).isDirectory());
  }
});

test("source hash verification detects wrong bytes even if metadata observations are held constant", (t) => {
  const f = fixture(t); let changed = false;
  const io = { ...IO, readSync(fd, bytes, offset, length, position) {
    const read = fs.readSync(fd, bytes, offset, length, position);
    if (read > 0) { bytes[offset] ^= 255; changed = true; }
    return read;
  } };
  bad(hydrateWith(f.input, io), "source_changed"); assert.equal(changed, true);
  assert.equal(fs.readFileSync(f.destination + "/a", "utf8"), "abc");
});

test("read truncation, extra EOF bytes, and I/O failure refuse without a partial inventory", (t) => {
  for (const mutation of ["short", "extra", "throw"]) {
    const f = fixture(t); let injected = false;
    const io = { ...IO, readSync(fd, bytes, offset, length, position) {
      injected = true;
      if (mutation === "throw") throw new Error("PRIVATE_READ_CANARY");
      if (mutation === "short") return 0;
      if (position === 3) { bytes[0] = 120; return 1; }
      return fs.readSync(fd, bytes, offset, length, position);
    } };
    bad(hydrateWith(f.input, io), mutation === "throw" ? "write_failed" : "source_changed"); assert.equal(injected, true);
  }
});

test("metadata rechecks catch parent replacement and changed previously read files", (t) => {
  const parent = fixture(t); let changed = false;
  bad(hydrateWith(parent.input, { ...IO, writeSync(...args) {
    const written = fs.writeSync(...args);
    if (!changed) { changed = true; fs.renameSync(parent.parent, parent.base + "/old"); fs.mkdirSync(parent.parent, { mode: 0o700 }); }
    return written;
  } }), "source_changed");
  assert.equal(fs.readFileSync(parent.base + "/old/source/a", "utf8"), "abc");
  const f = fixture(t, [item("a"), item("b")]); let eof = 0;
  bad(hydrateWith(f.input, { ...IO, readSync(...args) {
    const read = fs.readSync(...args);
    if (read === 0 && ++eof === 2) fs.writeFileSync(f.destination + "/a", "changed after first read");
    return read;
  } }), "source_changed");
  assert.equal(eof, 2);
});

test("post-enumeration membership changes are observed before success", (t) => {
  const f = fixture(t); let inserted = false;
  bad(hydrateWith(f.input, { ...IO, readSync(...args) {
    const read = fs.readSync(...args);
    if (!inserted) { inserted = true; fs.writeFileSync(f.destination + "/late-extra", "unexpected"); }
    return read;
  } }), "source_changed");
  assert.equal(inserted, true); assert.equal(fs.existsSync(f.destination + "/late-extra"), true);
});
