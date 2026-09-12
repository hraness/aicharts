/**
 * Pure state for the shared searchable option-grid picker. Keeping filtering,
 * ranking, and grid keyboard geometry here lets tests exercise the behavior
 * without a DOM while the component owns only focus and rendering.
 */

export type PickerOption = Readonly<{
  description?: string;
  id: string;
  keywords?: readonly string[];
  label: string;
  qualifier?: string;
}>;

export type PickerNavigationKey =
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "End"
  | "Home";

const MAX_QUERY_LENGTH = 80;

const WORD_START_SCORE = 4;
const SUBSTRING_SCORE = 2;
const SUBSEQUENCE_SCORE = 1;

export function isPickerNavigationKey(key: string): key is PickerNavigationKey {
  return key === "ArrowDown"
    || key === "ArrowLeft"
    || key === "ArrowRight"
    || key === "ArrowUp"
    || key === "End"
    || key === "Home";
}

function foldedText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/gu, "");
}

function pickerHaystack(option: PickerOption): string {
  return foldedText([
    option.label,
    option.qualifier ?? "",
    option.description ?? "",
    ...(option.keywords ?? []),
  ].join(" "));
}

/**
 * Moves a single trailing parenthetical onto a quieter second line so the
 * meaningful suffix of a long model name stays readable in a compact cell.
 * Nested or mid-label parentheses stay on the primary line.
 */
export function splitPickerLabel(name: string): Readonly<{ label: string; qualifier?: string }> {
  const trimmed = name.trim();
  const match = /^(?<label>.+?)\s*\((?<qualifier>[^()]*)\)\s*$/u.exec(trimmed);
  const label = match?.groups?.label?.trim() ?? "";
  const qualifier = match?.groups?.qualifier?.trim() ?? "";
  return label.length === 0 || qualifier.length === 0
    ? { label: trimmed }
    : { label, qualifier };
}

function isWordStart(haystack: string, index: number): boolean {
  if (index === 0) return true;
  const previous = haystack[index - 1] ?? "";
  return !/[a-z0-9]/u.test(previous);
}

/**
 * Length of the shortest haystack window containing the needle characters in
 * order, or null without a full match. Bounding the window keeps loose
 * matches local: "gpt6a" finds "GPT-6 Astra", while scattered single letters
 * across a long description no longer count.
 */
function tightestSubsequenceSpan(needle: string, haystack: string): number | null {
  if (needle.length === 0) return 0;
  let best: number | null = null;
  for (let start = 0; start < haystack.length; start += 1) {
    if (haystack[start] !== needle[0]) continue;
    let cursor = 0;
    let end = start;
    for (let index = start; index < haystack.length && cursor < needle.length; index += 1) {
      if (haystack[index] === needle[cursor]) {
        cursor += 1;
        end = index;
      }
    }
    // A greedy scan from this start consumes everything after it, so later
    // starts cannot succeed either.
    if (cursor < needle.length) break;
    const span = end - start + 1;
    if (best === null || span < best) best = span;
  }
  return best;
}

function tokenScore(token: string, haystack: string): number | null {
  const index = haystack.indexOf(token);
  if (index >= 0) {
    return isWordStart(haystack, index) ? WORD_START_SCORE : SUBSTRING_SCORE;
  }
  const span = tightestSubsequenceSpan(token, haystack);
  return span !== null && span <= token.length * 3 ? SUBSEQUENCE_SCORE : null;
}

function optionScore(option: PickerOption, tokens: readonly string[]): number | null {
  const haystack = pickerHaystack(option);
  let score = 0;
  for (const token of tokens) {
    const scored = tokenScore(token, haystack);
    if (scored === null) return null;
    score += scored;
  }
  return score;
}

/**
 * Fuzzy-filters options for a free-text query. Every whitespace-separated
 * token must match as a substring or an in-order character subsequence, and
 * stronger matches (word starts, then substrings) rank before loose
 * subsequences. Ties keep the caller's option order so curated grouping,
 * such as provider-sorted model lists, survives filtering.
 */
export function filterPickerOptions<Option extends PickerOption>(
  options: readonly Option[],
  query: string,
): readonly Option[] {
  const tokens = foldedText(query.slice(0, MAX_QUERY_LENGTH))
    .split(/\s+/u)
    .filter(token => token.length > 0);
  if (tokens.length === 0) return options;
  return options
    .flatMap(option => {
      const score = optionScore(option, tokens);
      return score === null ? [] : [{ option, score }];
    })
    .toSorted((left, right) => right.score - left.score)
    .map(entry => entry.option);
}

/** Columns that fit the panel while every option keeps a readable width. */
export function pickerColumnCount(
  panelWidth: number,
  minimumColumnWidth: number,
  gap: number,
  maximumColumns: number,
): number {
  if (!Number.isFinite(panelWidth) || minimumColumnWidth <= 0 || maximumColumns < 1) return 1;
  const fitted = Math.floor((panelWidth + gap) / (minimumColumnWidth + gap));
  return Math.max(1, Math.min(maximumColumns, fitted));
}

/**
 * Moves the virtually focused option through a row-major grid. Horizontal
 * arrows step one option and clamp at the ends; vertical arrows step one row
 * and stay put when the target row does not exist, so focus never leaves the
 * filtered results.
 */
export function pickerNavigationIndex(
  key: PickerNavigationKey,
  activeIndex: number,
  optionCount: number,
  columnCount: number,
): number {
  if (optionCount <= 0) return -1;
  const columns = Math.max(1, columnCount);
  const lastIndex = optionCount - 1;
  if (key === "Home") return 0;
  if (key === "End") return lastIndex;
  if (activeIndex < 0 || activeIndex > lastIndex) {
    return key === "ArrowUp" || key === "ArrowLeft" ? lastIndex : 0;
  }
  if (key === "ArrowRight") return Math.min(activeIndex + 1, lastIndex);
  if (key === "ArrowLeft") return Math.max(activeIndex - 1, 0);
  if (key === "ArrowDown") {
    const target = activeIndex + columns;
    return target <= lastIndex ? target : activeIndex;
  }
  const target = activeIndex - columns;
  return target >= 0 ? target : activeIndex;
}
