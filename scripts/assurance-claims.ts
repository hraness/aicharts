import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Claim inventory check (finding F26).
 *
 * `docs/usage-claims.md` is a phrase registry: every sentence in README.md or
 * docs/usage-*.md that asserts positive support, qualification, live or
 * platform status must contain a registered phrase for its file, and every
 * registered phrase must still appear verbatim in that file with a dated
 * evidence reference or an explicit unsupported/unqualified status. A new
 * claim sentence, a stale row or an undated evidence cell fails the check.
 * Sentence detection is a bounded regular-expression heuristic, not a
 * grammar; it exists so that support claims cannot be added silently.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const INVENTORY_PATH = "docs/usage-claims.md";
export const STATUSES = Object.freeze(["evidenced", "historical", "source-only", "unqualified", "unsupported"] as const);
export type ClaimStatus = (typeof STATUSES)[number];
export type InventoryRow = { phrase: string; location: string; evidence: string; status: ClaimStatus; line: number };
export type Sentence = { line: number; sentence: string };
export type Claim = { file: string; line: number; sentence: string };
export type Document = { file: string; text: string };
export type CheckResult = { ok: boolean; problems: string[]; claims: number; rows: number; documents: number };

const MAX_DOCUMENT_BYTES = 1_048_576;
const MAX_ROWS = 4096;
const STATUS_WORDS = "(?:supported|qualified|live|deployed|published|notarized|verified|enabled|in production|production-ready)";
/** A sentence that asserts positive status: a copula or aspect verb followed by
 * a status word, an explicit "supports"/"qualified" verb, a platform name near
 * support/install/release vocabulary, or "live"/"production" near deployment,
 * serving, enabling, passing, verification or readback vocabulary. */
export const CLAIM_PATTERN = new RegExp(
  String.raw`\b(?:(?:is|are|was|were|remains?|stays?|now|already|currently|has been|have been|became|becomes)\s+(?:\w+\s+){0,2}${STATUS_WORDS}\b`
  + String.raw`|\b(?:supports?|qualif(?:ied|ies))\s+\S`
  + String.raw`|\b(?:Linux|macOS|Windows)\b[^.!?]*\b(?:support\w*|qualif\w*|install\w*|releas\w*|distribut\w*|notariz\w*)\b`
  + String.raw`|\b(?:live|production)\b[^.!?]*\b(?:deploy\w*|serv\w*|enabl\w*|pass\w*|verif\w*|qualif\w*|readback|confirm\w*)\b`
  + String.raw`|\bqualified\b)`, "u");
/** A sentence that limits, negates or conditions its own status is not a positive claim. */
export const NEGATION_PATTERN = /\b(?:not|never|no|nor|neither|cannot|without|unless|until|only after|only when|refus\w*|unqualified|unsupported|unverified|unexecuted|unimplemented|must|should|do not|does not|did not|before)\b/iu;
const DATE = /\b\d{4}-\d{2}-\d{2}(?!\d)/u;
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z`(\[*])/u;

export const normalize = (text: string): string => text.replace(/\s+/gu, " ").trim();

/** Splits Markdown prose into sentences with the line of their paragraph,
 * skipping fenced code, table rows, headings and blank lines. */
export function splitSentences(markdown: string): Sentence[] {
  const out: Sentence[] = [];
  let fence = false, start = 0, current: string[] = [];
  const flush = () => {
    if (current.length === 0) return;
    for (const piece of current.join(" ").split(SENTENCE_BOUNDARY)) {
      const sentence = normalize(piece);
      if (sentence.length > 0) out.push({ line: start, sentence });
    }
    current = [];
  };
  markdown.split("\n").forEach((raw, index) => {
    if (/^\s*(?:```|~~~)/u.test(raw)) { fence = !fence; flush(); return; }
    if (fence || /^\s*\|/u.test(raw) || /^#/u.test(raw) || raw.trim() === "") { flush(); return; }
    if (current.length === 0) start = index + 1;
    current.push(raw.trim());
  });
  flush();
  return out;
}

export function isClaim(sentence: string): boolean {
  return CLAIM_PATTERN.test(sentence) && !NEGATION_PATTERN.test(sentence);
}

export function findClaims(file: string, markdown: string): Claim[] {
  return splitSentences(markdown).filter(({ sentence }) => isClaim(sentence)).map(({ line, sentence }) => ({ file, line, sentence }));
}

/** Parses the four-column inventory table that follows the
 * `Claim | Location | Evidence | Status` header; earlier tables are ignored.
 * Every row needs a verbatim phrase, a repository-relative location, an
 * evidence cell and a known status; `evidenced` and `historical` rows must
 * cite an ISO date. */
export function parseInventory(markdown: string): { rows: InventoryRow[]; errors: string[] } {
  const rows: InventoryRow[] = [], errors: string[] = [];
  const seen = new Set<string>();
  let header = false;
  markdown.split("\n").forEach((raw, index) => {
    const line = index + 1;
    if (!/^\s*\|/u.test(raw)) return;
    const cells = raw.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map(cell => cell.trim());
    // Tables before the inventory header (the platform summary) are prose, not rows.
    if (!header) { header = cells.join("|").toLowerCase() === "claim|location|evidence|status"; return; }
    if (cells.length !== 4) { errors.push(`${INVENTORY_PATH}:${line}: expected four cells, found ${cells.length}`); return; }
    if (cells.every(cell => /^:?-{3,}:?$/u.test(cell))) return;
    const [phrase, location, evidence, statusText] = cells as [string, string, string, string];
    if (phrase.length < 12) errors.push(`${INVENTORY_PATH}:${line}: phrase must be at least 12 characters`);
    if (!/^(?:README\.md|docs\/usage-[a-z0-9-]+\.md)$/u.test(location)) errors.push(`${INVENTORY_PATH}:${line}: location must be README.md or docs/usage-*.md`);
    if (evidence.length === 0) errors.push(`${INVENTORY_PATH}:${line}: evidence cell is empty`);
    if (!(STATUSES as readonly string[]).includes(statusText)) errors.push(`${INVENTORY_PATH}:${line}: unknown status ${JSON.stringify(statusText)}`);
    const status = statusText as ClaimStatus;
    if ((status === "evidenced" || status === "historical") && !DATE.test(evidence)) errors.push(`${INVENTORY_PATH}:${line}: ${status} rows must cite a YYYY-MM-DD date`);
    const key = `${location}\u0000${normalize(phrase)}`;
    if (seen.has(key)) errors.push(`${INVENTORY_PATH}:${line}: duplicate phrase for ${location}`);
    seen.add(key);
    rows.push({ phrase: normalize(phrase), location, evidence, status, line });
  });
  if (rows.length > MAX_ROWS) errors.push(`${INVENTORY_PATH}: more than ${MAX_ROWS} rows`);
  if (!header) errors.push(`${INVENTORY_PATH}: no inventory table found`);
  return { rows, errors };
}

export function checkClaims(documents: readonly Document[], inventory: string): CheckResult {
  const { rows, errors } = parseInventory(inventory);
  const problems = [...errors];
  const byFile = new Map<string, InventoryRow[]>();
  for (const row of rows) byFile.set(row.location, [...(byFile.get(row.location) ?? []), row]);
  const files = new Set(documents.map(document => document.file));
  for (const row of rows) if (!files.has(row.location)) problems.push(`${INVENTORY_PATH}:${row.line}: location ${row.location} is not a scanned document`);
  let claims = 0;
  for (const document of documents) {
    if (Buffer.byteLength(document.text, "utf8") > MAX_DOCUMENT_BYTES) { problems.push(`${document.file}: exceeds ${MAX_DOCUMENT_BYTES} bytes`); continue; }
    const registered = byFile.get(document.file) ?? [];
    const flat = normalize(document.text);
    for (const row of registered) if (!flat.includes(row.phrase)) problems.push(`${INVENTORY_PATH}:${row.line}: phrase no longer appears in ${document.file}: ${JSON.stringify(row.phrase)}`);
    for (const claim of findClaims(document.file, document.text)) {
      claims += 1;
      if (!registered.some(row => claim.sentence.includes(row.phrase))) {
        problems.push(`${claim.file}:${claim.line}: unregistered claim: ${JSON.stringify(claim.sentence)}`);
      }
    }
  }
  return { ok: problems.length === 0, problems, claims, rows: rows.length, documents: documents.length };
}

export function listDocuments(base: string = root): string[] {
  const usage = readdirSync(resolve(base, "docs")).filter(name => /^usage-[a-z0-9-]+\.md$/u.test(name) && `docs/${name}` !== INVENTORY_PATH).sort();
  return ["README.md", ...usage.map(name => `docs/${name}`)];
}

export function main(base: string = root): number {
  const documents = listDocuments(base).map(file => ({ file, text: readFileSync(resolve(base, file), "utf8") }));
  const result = checkClaims(documents, readFileSync(resolve(base, INVENTORY_PATH), "utf8"));
  for (const problem of result.problems) console.error(problem);
  console.log(JSON.stringify({ operation: "claims-check", ok: result.ok, documents: result.documents, claims: result.claims, rows: result.rows, problems: result.problems.length }));
  return result.ok ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
