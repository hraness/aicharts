/** A total text order: English display collation followed by exact UTF-16 identity. */
export function compareStableText(left: string, right: string): number {
  return left.localeCompare(right, "en") || (left < right ? -1 : left > right ? 1 : 0);
}
