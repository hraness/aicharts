import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { menubarBinary, runMenubar } from "./menubar.ts";

test("production launcher refuses to build when the companion is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "aicharts-menubar-"));
  try {
    expect(menubarBinary(root)).toBe(join(root, "desktop", "target", "debug", "aicharts-menubar"));
    expect(await runMenubar(root)).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production launcher waits for the prebuilt singleton process", async () => {
  const root = await mkdtemp(join(tmpdir(), "aicharts-menubar-"));
  const target = join(root, "desktop", "target", "debug");
  try {
    await mkdir(target, { recursive: true });
    const binary = join(target, "aicharts-menubar");
    await writeFile(binary, "#!/bin/sh\nexit 7\n", { mode: 0o700 });
    await chmod(binary, 0o700);
    expect(await runMenubar(root)).toBe(7);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
