import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "bun:test";
import {
  hasCurrentAgentRules,
  writeAgentFiles,
} from "next/dist/server/lib/generate-agent-files";

test("Next guidance preserves the KB guide format and both agent files", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
  const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8");
  expect(agents.match(/^#+ .+$/gm)).toEqual(["# Contents", "# Guidelines"]);
  expect(agents).toContain("read the relevant installed `node_modules/next/dist/docs/` guide");
  expect(claude.startsWith("@AGENTS.md\n")).toBe(true);
  expect(hasCurrentAgentRules(root)).toBe(true);

  const fixture = await mkdtemp(path.join(tmpdir(), "aicharts-agent-guidance-"));
  try {
    await writeFile(path.join(fixture, "AGENTS.md"), agents);
    await writeFile(path.join(fixture, "CLAUDE.md"), claude);
    expect(hasCurrentAgentRules(fixture)).toBe(true);
    expect(writeAgentFiles(fixture)).toEqual({
      agentsMd: "skipped",
      claudeMd: "unchanged",
    });
    expect(await readFile(path.join(fixture, "AGENTS.md"), "utf8")).toBe(agents);
    expect(await readFile(path.join(fixture, "CLAUDE.md"), "utf8")).toBe(claude);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
