/**
 * Inline product mark for social cards: an abstract benchmark scatter
 * climbing toward a highlighted point, echoing the AI Charts ringed dot.
 * Strokes and fills use currentColor; no remote or raster assets.
 */
export function AichartsMark() {
  return (
    <svg
      aria-label="AI Charts"
      fill="none"
      height="42"
      role="img"
      viewBox="0 0 40 40"
      width="42"
    >
      <path
        d="M6 5v29h29"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />
      <circle cx="13" cy="27" fill="currentColor" r="3" />
      <circle cx="20" cy="21" fill="currentColor" r="3" />
      <circle cx="27" cy="15" fill="currentColor" r="3" />
      <circle
        cx="32.5"
        cy="8.5"
        fill="none"
        r="4"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <circle cx="32.5" cy="8.5" fill="currentColor" r="1.6" />
    </svg>
  );
}
