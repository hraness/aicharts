import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    tree: { type: "string" },
    head: { type: "string" },
  },
});
const revisions = [values.base, values.tree, values.head];
if (
  !revisions.every(
    (sha) => typeof sha === "string" && /^[a-f0-9]{40}$/.test(sha),
  )
)
  throw new Error("Supply full base, merge and PR head revisions");
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" });
const [base, tree, head] = revisions as string[];
const file = "journal/entries.json";
function entriesAt(ref: string): string[] {
  if (!git("ls-tree", ref!, "--", file).length) return [];
  const records = JSON.parse(git("show", ref + ":" + file)) as Array<{
    slug: string;
    date: string;
    title: string;
    summary: string;
    category: string;
    surfaces: string[];
  }>;
  const slugs = records.map((e) => {
    if (
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.slug) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(e.date) ||
      !e.title?.trim() ||
      !e.summary?.trim() ||
      !["New", "Improved", "Fixed", "Docs"].includes(e.category) ||
      !e.surfaces?.length
    )
      throw new Error("Incomplete public changelog entry");
    return e.slug;
  });
  if (new Set(slugs).size !== slugs.length)
    throw new Error("Duplicate changelog slug");
  return slugs;
}
const before = entriesAt(base!);
const after = entriesAt(tree!);
if (before.some((s) => !after.includes(s)))
  throw new Error("Keep published changelog anchors");
const changes = git("diff", "--name-only", "--no-renames", "-z", base!, tree!)
  .split("\0")
  .filter(Boolean);
const visible = changes.filter(
  (p) =>
    p !== file &&
    p !== "data/releases.json" &&
    !/(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(p) &&
    (/^(app|components|lib|journal|public|showcase|docs)\//.test(p) ||
      p === "README.md" ||
      p === "next.config.ts" ||
      p === "package.json"),
);
const reason = git(
  "show",
  "-s",
  "--format=%(trailers:key=Changelog-skip,valueonly)",
  head!,
).trim();
if (
  visible.length &&
  !after.some((s) => !before.includes(s)) &&
  reason.length < 12
)
  throw new Error(
    "Add a dated user-facing entry to journal/entries.json. For internal changes or an already documented release, explain in a Changelog-skip commit trailer.",
  );
