import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const supportRevision = "ed89e584c2c420e3e0547bbe8f32baf8e3a2ae4d";
const inputs = {
  "dist/node.js": "a46faacc63511ab6f0ca4f80fc0823a8f1676f00e0bdb6a0af62eebd07d97e96",
  "package.json": "48a38d5a1b453762875bca5fe3a85a884e2720fad2287892010f8c3dc3c03768",
  LICENSE: "74b69bf37c8f340c9c2a54d431a15218738d9c463d0e014fa6a8bb8edce4e539",
} as const;
const root = new URL("../", import.meta.url);

/** Exact released bytes, with no runtime dependency installation or copied policy. */
export function admitSupportRuntime(files: Readonly<Record<string, Uint8Array>>): void {
  if (Object.keys(files).sort().join("\0") !== Object.keys(inputs).sort().join("\0")) throw new Error("Unexpected support runtime inputs.");
  for (const [path, expected] of Object.entries(inputs)) {
    if (createHash("sha256").update(files[path] ?? new Uint8Array()).digest("hex") !== expected) throw new Error(`Unreviewed support input: ${path}`);
  }
}

export async function synchronizeSupportRuntime(check: boolean): Promise<void> {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  if (pkg.devDependencies?.["@hraness/support-foundation"] !== `github:hraness/support-foundation#${supportRevision}`) throw new Error("Support release pin changed.");
  const entries = await Promise.all(Object.keys(inputs).map(async path => [path, await readFile(new URL(`node_modules/@hraness/support-foundation/${path}`, root))] as const));
  const files = Object.fromEntries(entries);
  admitSupportRuntime(files);
  const notice = `# Shared support runtime\n\nThe generated scripts/support-foundation.mjs is the unmodified Node entry from @hraness/support-foundation 0.4.1, source ${supportRevision}. Regenerate through bun run skill:support:sync; do not edit it by hand.\n\n## @hraness/support-foundation (MIT)\n\n${files.LICENSE!.toString("utf8")}`;
  for (const [path, bytes] of [["scripts/support-foundation.mjs", files["dist/node.js"]!], ["THIRD_PARTY_NOTICES.md", Buffer.from(notice)]] as const) {
    const destination = new URL(`skills/aicharts/${path}`, root);
    if (check) {
      if (!(await readFile(destination)).equals(bytes)) throw new Error(`Generated support artifact differs: ${path}`);
    } else await writeFile(destination, bytes);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw new Error("Expected only --check.");
  await synchronizeSupportRuntime(process.argv.includes("--check"));
}
