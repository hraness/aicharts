import { Cite } from "./sources";

/** One value in a comparison facts table: a ✓ and its word mark the better side. */
export type Cell = Readonly<{ value: string; note?: string; win?: string; cite?: number }>;

export function FactCell({ cell, label }: Readonly<{ cell: Cell; label: string }>) {
  return (
    <td role="cell" data-label={label}>
      <span className="fact-value">
        {cell.win && (
          <span className="mark mark--yes" aria-hidden="true">
            ✓
          </span>
        )}
        <strong>{cell.value}</strong>
        {cell.win && <span className="mark-label">{cell.win}</span>}
        {cell.cite && <Cite n={cell.cite} />}
      </span>
      {cell.note && <span className="fact-note">{cell.note}</span>}
    </td>
  );
}
