import { readFileSync } from "node:fs";
import { parse } from "yaml";

/** The change filters of CI's `changes` job, the single source for local skip decisions. */
export type ChangeFilters = Readonly<Record<string, readonly string[]>>;

export function ciChangeFilters(workflowText: string = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")): ChangeFilters {
  const workflow: unknown = parse(workflowText);
  const steps: unknown = (workflow as { jobs?: { changes?: { steps?: unknown } } } | null)?.jobs?.changes?.steps;
  if (!Array.isArray(steps)) throw new Error("ci_changes_job_missing");
  const filterStep: unknown = steps.find((step: unknown) => (step as { id?: unknown } | null)?.id === "filter");
  const text: unknown = (filterStep as { with?: { filters?: unknown } } | undefined)?.with?.filters;
  if (typeof text !== "string") throw new Error("ci_change_filters_missing");
  const filters: unknown = parse(text);
  if (filters === null || typeof filters !== "object" || Array.isArray(filters)) throw new Error("ci_change_filters_invalid");
  const result: Record<string, readonly string[]> = {};
  for (const [name, globs] of Object.entries(filters)) {
    if (!Array.isArray(globs) || globs.length === 0 || !globs.every(glob => typeof glob === "string" && glob.length > 0)) throw new Error(`ci_change_filter_invalid:${name}`);
    result[name] = globs as string[];
  }
  return result;
}

/** The subset of picomatch glob syntax the CI filters use: `**`, `*` and `?`. Dotfiles match. */
export function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let index = 0; index < glob.length; index++) {
    const character = glob[index];
    if (character === "*" && glob[index + 1] === "*") {
      index++;
      if (glob[index + 1] === "/") { index++; pattern += "(?:.*/)?"; } else pattern += ".*";
    } else if (character === "*") pattern += "[^/]*";
    else if (character === "?") pattern += "[^/]";
    else pattern += character.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`^${pattern}$`, "u");
}

export function matchesFilter(path: string, globs: readonly string[]): boolean {
  return globs.some(glob => globToRegExp(glob).test(path));
}

/** Filter names whose inputs any of `paths` touches. */
export function changedFilters(paths: readonly string[], filters: ChangeFilters = ciChangeFilters()): Set<string> {
  return new Set(Object.entries(filters).filter(([, globs]) => paths.some(path => matchesFilter(path, globs))).map(([name]) => name));
}
