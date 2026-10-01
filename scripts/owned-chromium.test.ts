import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownedChromiumOptions } from "./owned-chromium.mjs";

test("owned browser options preserve Playwright features in one muted launch switch", () => {
  const options = ownedChromiumOptions(process.execPath);
  expect(options.args).toContain("--mute-audio");
  const switches = options.args.filter((argument: string) => argument.startsWith("--disable-features="));
  expect(switches).toHaveLength(1);
  const features = switches[0]!.slice("--disable-features=".length).split(",");
  for (const feature of ["PaintHolding", "MacAppCodeSignClone", "MediaRouter", "ThirdPartyStoragePartitioning", "BlockOriginHeaderModificationOnRedirect"]) {
    expect(features).toContain(feature);
  }
  expect(new Set(features).size).toBe(features.length);
  expect(options.ignoreDefaultArgs).toHaveLength(1);
  expect(options.ignoreDefaultArgs[0]).toStartWith("--disable-features=");
});

test("rejects the installed Chrome app even through an executable symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "aicharts-browser-selection-"));
  try {
    const app = join(root, "Google Chrome.app", "Contents", "MacOS");
    await mkdir(app, { recursive: true });
    const executable = join(app, "Google Chrome");
    await writeFile(executable, "inert test fixture");
    const alias = join(root, "browser");
    await symlink(executable, alias);
    expect(() => ownedChromiumOptions(executable)).toThrow("not an owned test browser");
    expect(() => ownedChromiumOptions(alias)).toThrow("not an owned test browser");
    expect(() => ownedChromiumOptions("./browser")).toThrow("absolute executable path");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
