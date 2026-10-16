// Writes the launch social kit to kb/launch/social-kit.md. Run with `bun run launch:kit`.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { renderSocialKitMarkdown } from "../app/launch/social-kit-markdown";

const out = join(import.meta.dir, "../kb/launch/social-kit.md");
const rendered = renderSocialKitMarkdown();
const checkOnly = Bun.argv.includes("--check");

if (checkOnly) {
  const current = await readFile(out, "utf8").catch(() => "");
  if (current !== rendered) {
    throw new Error("kb/launch/social-kit.md is stale. Run `bun run launch:kit`.");
  }
  console.log(`Validated ${out}`);
} else {
  await mkdir(join(out, ".."), { recursive: true });
  await writeFile(out, rendered);
  console.log(`Wrote ${out}`);
}
