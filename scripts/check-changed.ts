// Local handoff gate: `bun run check` minus the Rust and Worker gates whose CI
// change filters report no touched input since the merge base with origin/main.
// CI's Required stays the complete gate; this only avoids repeating untouched
// heavy suites on a developer machine. `--dry-run` prints the plan.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { changedFilters, ciChangeFilters } from "./ci-changes";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Commands of `bun run check` whose CI job is filtered, keyed by the filter that gates it. */
export const filteredGateCommands: Readonly<Record<string, string>> = {
  "bun run usage:check": "rust",
  "bun run usage:worker:check": "worker",
};

export function planChangedCheck(checkScript: string, changed: ReadonlySet<string>): { run: string[]; skipped: string[] } {
  const commands = checkScript.split(" && ");
  for (const command of Object.keys(filteredGateCommands)) if (!commands.includes(command)) throw new Error(`check_script_drift:${command}`);
  const run: string[] = [], skipped: string[] = [];
  for (const command of commands) {
    const filter = filteredGateCommands[command];
    (filter === undefined || changed.has(filter) ? run : skipped).push(command);
  }
  return { run, skipped };
}

function git(args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

export function changedPaths(base: string): string[] {
  const mergeBase = git(["merge-base", base, "HEAD"]).trim();
  const lines = [
    git(["diff", "--name-only", mergeBase]),
    git(["ls-files", "--others", "--exclude-standard"]),
  ].join("\n").split("\n").map(line => line.trim()).filter(Boolean);
  return [...new Set(lines)].sort();
}

if (import.meta.main) {
  const { values } = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: false,
    options: { base: { type: "string", default: "origin/main" }, "dry-run": { type: "boolean", default: false } } });
  const paths = changedPaths(values.base);
  const changed = changedFilters(paths, ciChangeFilters());
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  const plan = planChangedCheck(pkg.scripts.check, changed);
  console.log(`check:changed: ${String(paths.length)} changed paths since ${values.base}; touched CI filters: ${[...changed].sort().join(", ") || "none"}.`);
  for (const command of plan.skipped) console.log(`check:changed: skipping ${command} (inputs unchanged; CI still runs it when they change).`);
  if (changed.has("formal")) console.log("check:changed: formal inputs changed; CI runs that job (it is not part of `bun run check`).");
  if (values["dry-run"]) {
    for (const command of plan.run) console.log(command);
  } else {
    for (const command of plan.run) {
      console.log(`$ ${command}`);
      const result = spawnSync("sh", ["-c", command], { cwd: root, stdio: "inherit" });
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
  }
}
