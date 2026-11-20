export type BenchmarkChoice<Id extends string = string> = Readonly<{
  id: Id;
  label: string;
  summary: string;
  icon?: import("./device-kind").DeviceKind;
  keywords?: readonly string[];
}>;

function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function oneEditApart(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;

  let offset = 0;
  const sharedLength = Math.min(left.length, right.length);
  while (offset < sharedLength && left[offset] === right[offset]) offset++;

  if (left.length < right.length) return left.slice(offset) === right.slice(offset + 1);
  if (right.length < left.length) return right.slice(offset) === left.slice(offset + 1);
  if (offset === sharedLength) return false;
  if (left.slice(offset + 1) === right.slice(offset + 1)) return true;

  return (
    offset + 1 < sharedLength &&
    left[offset] === right[offset + 1] &&
    left[offset + 1] === right[offset] &&
    left.slice(offset + 2) === right.slice(offset + 2)
  );
}

function closeWord(term: string, word: string): boolean {
  if (oneEditApart(term, word)) return true;
  if (term[0] !== word[0]) return false;

  let end = 0;
  for (const letter of term) {
    const offset = word.indexOf(letter, end);
    if (offset === -1) return false;
    end = offset + 1;
  }
  // Let users omit letters in a name, but require a dense match near its start.
  return end - term.length <= Math.floor(term.length / 3);
}

function scoreTerm(term: string, names: string[], keywords: string[], summary: string[]): number {
  const startsWithTerm = (word: string) => word.startsWith(term);
  const closeToTerm = (word: string) => closeWord(term, word);
  if (names.includes(term)) return 8;
  if (names.some(startsWithTerm)) return 7;
  if (term.length >= 2 && keywords.includes(term)) return 6;
  if (term.length >= 3 && keywords.some(startsWithTerm)) return 5;
  if (term.length >= 4 && names.some(closeToTerm)) return 4;
  if (term.length >= 3 && summary.includes(term)) return 3;
  if (term.length >= 3 && summary.some(startsWithTerm)) return 2;
  if (term.length >= 4 && keywords.some(closeToTerm)) return 1;
  return 0;
}

export function searchBenchmarks<T extends BenchmarkChoice>(choices: readonly T[], query: string): T[] {
  const normalized = normalize(query);
  if (!normalized) return [...choices];

  const terms = new Set(normalized.split(" "));
  const compact = normalized.replaceAll(" ", "");
  const matches = choices.flatMap((choice, index) => {
    const names = [normalize(choice.label), normalize(choice.id)];
    const nameForms = names.flatMap((name) => [name, name.replaceAll(" ", "")]);
    if (nameForms.includes(normalized) || nameForms.includes(compact)) {
      return [{ choice, index, nameRank: 2, score: 0 }];
    }
    if (nameForms.some((name) => name.startsWith(normalized) || name.startsWith(compact))) {
      return [{ choice, index, nameRank: 1, score: 0 }];
    }

    const nameWords = names.flatMap((name) => name.split(" "));
    const keywords = normalize(choice.keywords?.join(" ") ?? "").split(" ");
    const summary = normalize(choice.summary).split(" ");
    let score = 0;
    for (const term of terms) {
      const match = scoreTerm(term, nameWords, keywords, summary);
      if (!match) return [];
      score += match;
    }
    return [{ choice, index, nameRank: 0, score }];
  });

  return matches
    .sort((a, b) => b.nameRank - a.nameRank || b.score - a.score || a.index - b.index)
    .map(({ choice }) => choice);
}
