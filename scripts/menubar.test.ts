import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { installMenubar, installedMenubarBinary, menubarBinary, runMenubar, uninstallMenubar } from "./menubar";

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
