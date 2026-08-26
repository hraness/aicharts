import { readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const iconPackagePaths = {
  alibabacloud: "@lobehub/icons-static-svg/icons/alibabacloud.svg",
  claude: "@lobehub/icons-static-svg/icons/claude.svg",
  cursor: "@lobehub/icons-static-svg/icons/cursor.svg",
  deepseek: "@lobehub/icons-static-svg/icons/deepseek.svg",
  gemini: "@lobehub/icons-static-svg/icons/gemini.svg",
  meta: "@lobehub/icons-static-svg/icons/meta.svg",
  moonshot: "@lobehub/icons-static-svg/icons/moonshot.svg",
  openai: "@lobehub/icons-static-svg/icons/openai.svg",
  xai: "@lobehub/icons-static-svg/icons/xai.svg",
  zai: "@lobehub/icons-static-svg/icons/zai.svg",
} as const;

const entries = await Promise.all(Object.entries(iconPackagePaths).map(async ([key, packagePath]) => {
  const svg = (await readFile(require.resolve(packagePath), "utf8"))
    .replaceAll("currentColor", "#f7f6f2");
  return [key, `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`] as const;
}));

const output = [
  "// Generated from @lobehub/icons-static-svg by scripts/generate-model-card-icons.ts. Do not edit by hand.",
  "export const lobeModelIconDataUrls = {",
  ...entries.map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`),
  "} as const;",
  "",
].join("\n");

const targetPath = fileURLToPath(new URL("../lib/model-card-icons.generated.ts", import.meta.url));
const checkOnly = Bun.argv.includes("--check");

if (checkOnly) {
  const current = await readFile(targetPath, "utf8").catch(() => "");
  if (current !== output) {
    throw new Error("Generated model-card icons are stale. Run `bun run model-icons:generate`.");
  }
  console.info(`Validated ${entries.length} pinned LobeHub model-card icons.`);
} else {
  const temporaryPath = `${targetPath}.tmp`;
  await writeFile(temporaryPath, output, "utf8");
  await rename(temporaryPath, targetPath);
  console.info(`Wrote ${targetPath}.`);
}
