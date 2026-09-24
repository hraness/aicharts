import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { installMenubar, installedMenubarBinary, menubarBinary, runMenubar, uninstallMenubar } from "./menubar";
import { buildMenubar } from "./menubar-build";

test("production launcher refuses to build when the companion is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "aicharts-menubar-"));
  try {
    const home = join(root, "home");
    expect(menubarBinary(root, home)).toBe(join(root, "desktop", "target", "release", "aicharts-menubar"));
    expect(await runMenubar(root, home)).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production launcher waits for the prebuilt singleton process", async () => {
  const root = await mkdtemp(join(tmpdir(), "aicharts-menubar-"));
  try {
    const target = join(root, "desktop", "target", "debug");
    await mkdir(target, { recursive: true });
    const binary = join(target, "aicharts-menubar");
    await Bun.write(binary, "#!/bin/sh\nexit 7\n");
    await chmod(binary, 0o700);
    const previous = process.env.AICHARTS_MENUBAR_DEV_BINARY;
    process.env.AICHARTS_MENUBAR_DEV_BINARY = binary;
    try {
      expect(await runMenubar(root, join(root, "home"))).toBe(7);
    } finally {
      if (previous === undefined) delete process.env.AICHARTS_MENUBAR_DEV_BINARY;
      else process.env.AICHARTS_MENUBAR_DEV_BINARY = previous;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("install copies only the release companion and uninstall removes it", async () => {
  const root = await mkdtemp(join(tmpdir(), "aicharts-menubar-"));
  const home = join(root, "home");
  const target = join(root, "desktop", "target", "release");
  try {
    await mkdir(target, { recursive: true });
    const binary = join(target, "aicharts-menubar");
    await Bun.write(binary, "#!/bin/sh\nexit 0\n");
    await chmod(binary, 0o755);
    expect(await installMenubar(root, home)).toBe(0);
    expect((await stat(installedMenubarBinary(home))).mode & 0o111).not.toBe(0);
    expect(menubarBinary(root, home)).toBe(installedMenubarBinary(home));
    expect(await uninstallMenubar(home)).toBe(0);
    expect(await Bun.file(installedMenubarBinary(home)).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("install cannot overwrite a predictable temporary-path symlink target", async () => {
  const root = await mkdtemp(join(tmpdir(), "aicharts-menubar-"));
  const home = join(root, "home");
  try {
    const release = join(root, "desktop", "target", "release");
    await mkdir(release, { recursive: true });
    const binary = join(release, "aicharts-menubar");
    await Bun.write(binary, "#!/bin/sh\nexit 0\n");
    await chmod(binary, 0o755);
    const destination = installedMenubarBinary(home);
    await mkdir(join(destination, ".."), { recursive: true });
    const unrelated = join(root, "unrelated");
    await Bun.write(unrelated, "preserve me");
    await symlink(unrelated, `${destination}.tmp-${process.pid}`);
    expect(await installMenubar(root, home)).toBe(0);
    expect(await readFile(unrelated, "utf8")).toBe("preserve me");
    expect(await readFile(destination, "utf8")).toBe(await readFile(binary, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("install and uninstall refuse a symlinked managed ancestor without touching its target", async () => {
  const root = await mkdtemp(join(tmpdir(), "aicharts-menubar-"));
  const home = join(root, "home");
  try {
    const release = join(root, "desktop", "target", "release");
    await mkdir(release, { recursive: true });
    const binary = join(release, "aicharts-menubar");
    await Bun.write(binary, "#!/bin/sh\nexit 0\n");
    await chmod(binary, 0o755);
    const shared = join(home, "Library", "Application Support");
    const unrelated = join(root, "unrelated");
    await mkdir(shared, { recursive: true });
    await mkdir(join(unrelated, "bin"), { recursive: true });
    const retained = join(unrelated, "bin", "aicharts-menubar");
    const retainedBytes = "#!/bin/sh\nexit 17\n";
    await Bun.write(retained, retainedBytes);
    await chmod(retained, 0o755);
    await symlink(unrelated, join(shared, "AI Charts"));
    expect(await installMenubar(root, home)).toBe(1);
    expect(await readFile(retained, "utf8")).toBe(retainedBytes);
    expect(await runMenubar(root, home)).toBe(1);
    expect(await uninstallMenubar(home)).toBe(1);
    expect(await readFile(retained, "utf8")).toBe(retainedBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release admission refuses symlinked and externally writable executables", async () => {
  const root = await mkdtemp(join(tmpdir(), "aicharts-menubar-"));
  const home = join(root, "home");
  try {
    const release = join(root, "desktop", "target", "release");
    await mkdir(release, { recursive: true });
    const binary = join(release, "aicharts-menubar");
    const other = join(root, "other-executable");
    await Bun.write(other, "#!/bin/sh\nexit 17\n");
    await chmod(other, 0o755);
    await symlink(other, binary);
    expect(await installMenubar(root, home)).toBe(1);
    expect(await runMenubar(root, home)).toBe(1);
    await rm(binary);
    await Bun.write(binary, "#!/bin/sh\nexit 17\n");
    await chmod(binary, 0o777);
    expect(await installMenubar(root, home)).toBe(1);
    expect(await runMenubar(root, home)).toBe(1);
    expect(await Bun.file(installedMenubarBinary(home)).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit build retains lockfile enforcement and returns cargo's failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "aicharts-menubar-"));
  const previousPath = process.env.PATH;
  try {
    const executable = join(root, "cargo");
    await Bun.write(executable, "#!/bin/sh\nprintf '%s\\n' \"$@\" > cargo-arguments\nexit 7\n");
    await chmod(executable, 0o700);
    process.env.PATH = root;
    expect(await buildMenubar(root)).toBe(7);
    expect((await readFile(join(root, "cargo-arguments"), "utf8")).split("\n")).toEqual([
      "build", "--release", "--locked", "--manifest-path", join(root, "desktop", "Cargo.toml"), "",
    ]);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
});
