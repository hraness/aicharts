import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "..");
const recorded = readFileSync(join(root, "docs/brand-assets.md"), "utf8");

test("the derived browser icons match the SHA-256 recorded in docs/brand-assets.md", () => {
  for (const file of ["icon1.png", "favicon.ico"]) {
    const hash = createHash("sha256").update(readFileSync(join(root, "app", file))).digest("hex");
    expect(recorded).toContain(`\`${file}\` SHA-256: \`${hash}\``);
  }
});

test("the 96px icon and favicon frames are multiples of 48px or the 32px fallback", () => {
  const png = readFileSync(join(root, "app/icon1.png"));
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([96, 96]);
  const ico = readFileSync(join(root, "app/favicon.ico"));
  const count = ico.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, index) => ico[6 + index * 16] || 256).sort((a, b) => b - a);
  expect(sizes).toEqual([48, 32]);
});
