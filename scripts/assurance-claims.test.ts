import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INVENTORY_PATH, checkClaims, findClaims, isClaim, listDocuments, parseInventory, splitSentences } from "./assurance-claims";

const inventory = (rows: string[]) => ["| Claim | Location | Evidence | Status |", "| --- | --- | --- | --- |", ...rows].join("\n");

test("sentences are split on terminal punctuation and skip code fences, tables and headings", () => {
  const text = "# Heading is supported\n\nThe Linux build is supported. It `remains live` now.\n\n```text\nmacOS is supported inside a fence.\n```\n\n| Windows is supported | in a table |\n\nA second paragraph\nspans lines.\n";
  expect(splitSentences(text)).toEqual([
    { line: 3, sentence: "The Linux build is supported." }, { line: 3, sentence: "It `remains live` now." }, { line: 11, sentence: "A second paragraph spans lines." },
  ]);
});

test("claim detection admits positive status assertions and excludes negated or conditioned sentences", () => {
  for (const sentence of [
    "The production site is deployed from `main` with Vercel.", "It qualified `x86_64-unknown-linux-gnu` on Ubuntu 22.04.", "Windows installation is supported.",
    "The reader supports an existing normal checkout.", "The live provider readback confirmed the namespaces.",
  ]) expect(isClaim(sentence)).toBe(true);
  for (const sentence of [
    "Windows is not supported.", "Live qualification remains unqualified.", "Keep it disabled until qualification passes.", "The workflow must pass before publication.",
    "A plain sentence about charts.", "It refuses unsupported profiles.",
  ]) expect(isClaim(sentence)).toBe(false);
  expect(findClaims("docs/usage-x.md", "Alpha.\n\nThe CLI is supported on Linux. Not on Windows.\n")).toEqual([{ file: "docs/usage-x.md", line: 3, sentence: "The CLI is supported on Linux." }]);
});

test("the inventory table requires four cells, known locations, dated evidence for evidenced and historical rows and unique phrases", () => {
  const good = parseInventory(inventory([
    "| is deployed from `main` | README.md | GitHub deployment 6647776777, 2026-09-24 | evidenced |",
    "| supports an existing normal checkout | docs/usage-release-source.md | `bun run release:source:check` (source tests) | source-only |",
  ]));
  expect(good.errors).toEqual([]);
  expect(good.rows.map(row => row.status)).toEqual(["evidenced", "source-only"]);
  const bad = parseInventory(inventory([
    "| too short | README.md | 2026-09-24 | evidenced |",
    "| is deployed from `main` one | docs/other.md | 2026-09-24 | evidenced |",
    "| is deployed from `main` two | README.md |  | maybe |",
    "| is deployed from `main` three | README.md | no date here | historical |",
    "| is deployed from `main` four | README.md | 2026-09-24 | evidenced |",
    "| is deployed from `main` four | README.md | 2026-09-24 | evidenced |",
    "| three | cells |",
  ]));
  expect(bad.errors).toEqual([
    `${INVENTORY_PATH}:3: phrase must be at least 12 characters`,
    `${INVENTORY_PATH}:4: location must be README.md or docs/usage-*.md`,
    `${INVENTORY_PATH}:5: evidence cell is empty`, `${INVENTORY_PATH}:5: unknown status "maybe"`,
    `${INVENTORY_PATH}:6: historical rows must cite a YYYY-MM-DD date`,
    `${INVENTORY_PATH}:8: duplicate phrase for README.md`,
    `${INVENTORY_PATH}:9: expected four cells, found 2`,
  ]);
  expect(parseInventory("no table").errors).toEqual([`${INVENTORY_PATH}: no inventory table found`]);
  expect(parseInventory("| Surface | State |\n| --- | --- |\n| Linux | qualified once |\n").errors).toEqual([`${INVENTORY_PATH}: no inventory table found`]);
  const summaryThenInventory = parseInventory(`| Surface | State |\n| --- | --- |\n| Linux | qualified once |\n\n${inventory(["| is deployed from `main` | README.md | receipt 2026-09-24T22:33:45Z | evidenced |"])}`);
  expect(summaryThenInventory.errors).toEqual([]);
  expect(summaryThenInventory.rows).toHaveLength(1);
});

test("every claim sentence needs a registered phrase and every registered phrase must still appear", () => {
  const documents = [
    { file: "README.md", text: "The production site is deployed from `main` with Vercel.\n\nCharts are static.\n" },
    { file: "docs/usage-a.md", text: "The CLI is supported on Linux.\n" },
  ];
  const pass = checkClaims(documents, inventory([
    "| is deployed from `main` with Vercel | README.md | deployment 6647776777, 2026-09-24 | evidenced |",
    "| is supported on Linux | docs/usage-a.md | run 35498763628, 2026-09-20 | evidenced |",
  ]));
  expect(pass).toEqual({ ok: true, problems: [], claims: 2, rows: 2, documents: 2 });
  const fail = checkClaims(documents, inventory([
    "| is deployed from `main` with Vercel | README.md | deployment 6647776777, 2026-09-24 | evidenced |",
    "| a phrase that vanished | README.md | 2026-09-24 | evidenced |",
    "| is supported on Linux | docs/usage-missing.md | 2026-09-20 | evidenced |",
  ]));
  expect(fail.ok).toBe(false);
  expect(fail.problems).toEqual([
    `${INVENTORY_PATH}:5: location docs/usage-missing.md is not a scanned document`,
    `${INVENTORY_PATH}:4: phrase no longer appears in README.md: "a phrase that vanished"`,
    'docs/usage-a.md:1: unregistered claim: "The CLI is supported on Linux."',
  ]);
  const oversized = checkClaims([{ file: "README.md", text: "x".repeat(1_048_577) }], inventory([]));
  expect(oversized.problems).toEqual(["README.md: exceeds 1048576 bytes"]);
});

test("the checked-in inventory covers the repository documents", () => {
  const base = resolve(import.meta.dir, "..");
  const files = listDocuments(base);
  expect(files[0]).toBe("README.md");
  expect(files).not.toContain(INVENTORY_PATH);
  expect(files).toContain("docs/usage-activation.md");
  const result = checkClaims(files.map(file => ({ file, text: readFileSync(resolve(base, file), "utf8") })), readFileSync(resolve(base, INVENTORY_PATH), "utf8"));
  expect(result.problems).toEqual([]);
  expect(result.ok).toBe(true);
  expect(result.claims).toBeGreaterThan(40);
});
