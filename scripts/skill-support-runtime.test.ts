import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { admitSupportRuntime, synchronizeSupportRuntime } from "./skill-support-runtime";

test("generated skill runtime is exact and rejects extra or modified dependency inputs", async () => {
  const entries = await Promise.all(["dist/node.js", "package.json", "LICENSE"].map(async path => [path,
    await readFile(new URL(`../node_modules/@hraness/support-foundation/${path}`, import.meta.url))] as const));
  const files = Object.fromEntries(entries);
  expect(() => admitSupportRuntime(files)).not.toThrow();
  expect(() => admitSupportRuntime({ ...files, unexpected: Buffer.from("extra") })).toThrow();
  for (const path of Object.keys(files)) {
    expect(() => admitSupportRuntime({ ...files, [path]: Buffer.concat([files[path]!, Buffer.from("mutation")]) })).toThrow();
  }
  await synchronizeSupportRuntime(true);
});
