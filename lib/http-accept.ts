export const HTML_MEDIA_TYPE = "text/html";
export const MARKDOWN_MEDIA_TYPE = "text/markdown";
export const PRODUCED_MEDIA_TYPES = [HTML_MEDIA_TYPE, MARKDOWN_MEDIA_TYPE] as const;

export type ProducedMediaType = (typeof PRODUCED_MEDIA_TYPES)[number];

type AcceptEntry = Readonly<{
  position: number;
  q: number;
  specificity: number;
  type: string;
}>;

function parseQuality(value: string | undefined): number {
  if (value === undefined) return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.min(1, parsed));
}

function specificity(type: string): number {
  if (type === "*/*") return 0;
  if (type.endsWith("/*")) return 1;
  return 2;
}

/** RFC 9110 Accept entries, preserving client order for equal-q ties. */
export function parseAccept(header: string): AcceptEntry[] {
  return header.split(",").flatMap((raw, position) => {
    const parts = raw.trim().split(";").map(part => part.trim()).filter(Boolean);
    const type = parts[0]?.toLowerCase();
    if (type === undefined || type.length === 0) return [];
    let q = 1;
    for (const param of parts.slice(1)) {
      const separator = param.indexOf("=");
      if (separator === -1) continue;
      const name = param.slice(0, separator).trim().toLowerCase();
      const value = param.slice(separator + 1).trim();
      if (name === "q") q = parseQuality(value);
    }
    return [{ position, q, specificity: specificity(type), type }];
  });
}

function matches(entry: AcceptEntry, candidate: string): boolean {
  if (entry.type === "*/*") return true;
  if (entry.type.endsWith("/*")) return candidate.startsWith(entry.type.slice(0, -1));
  return entry.type === candidate;
}

/**
 * Choose among produced types using q-value, then specificity, then client
 * order. A missing or empty Accept header means no constraint.
 */
export function preferredType(
  header: string | null,
  produced: readonly string[] = PRODUCED_MEDIA_TYPES,
): string | null {
  if (header === null || header.trim() === "") return produced[0] ?? null;
  const entries = parseAccept(header);
  if (entries.length === 0) return produced[0] ?? null;

  let bestType: string | null = null;
  let bestQ = -1;
  let bestPosition = Number.POSITIVE_INFINITY;

  for (const candidate of produced) {
    let matched: AcceptEntry | null = null;
    for (const entry of entries) {
      if (!matches(entry, candidate)) continue;
      if (
        matched === null
        || entry.specificity > matched.specificity
        || (entry.specificity === matched.specificity && entry.position < matched.position)
      ) {
        matched = entry;
      }
    }
    if (matched === null || matched.q <= 0) continue;
    if (matched.q > bestQ || (matched.q === bestQ && matched.position < bestPosition)) {
      bestQ = matched.q;
      bestPosition = matched.position;
      bestType = candidate;
    }
  }

  return bestType;
}

export function appendVaryAccept(headers: Headers): void {
  const existing = headers.get("Vary");
  if (existing === null || existing.trim() === "") {
    headers.set("Vary", "Accept");
    return;
  }
  const tokens = existing.split(",").map(token => token.trim().toLowerCase());
  if (!tokens.includes("accept")) {
    headers.set("Vary", `${existing}, Accept`);
  }
}

export function isHtmlType(type: string | null): boolean {
  return type === HTML_MEDIA_TYPE;
}

export function isMarkdownType(type: string | null): boolean {
  return type === MARKDOWN_MEDIA_TYPE;
}
