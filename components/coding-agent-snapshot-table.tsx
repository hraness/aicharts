import {
  COMPACT_SNAPSHOT_COLUMNS,
  FULL_SNAPSHOT_COLUMNS,
  SNAPSHOT_COLUMN_LABELS,
  snapshotRowCell,
  type CodingAgentSnapshotRow,
  type SnapshotTableColumn,
} from "@/lib/coding-agent-snapshot-rows";

export type SnapshotTableVariant = "compact" | "full";

const variantColumns = {
  compact: COMPACT_SNAPSHOT_COLUMNS,
  full: FULL_SNAPSHOT_COLUMNS,
} as const satisfies Record<SnapshotTableVariant, readonly SnapshotTableColumn[]>;

export function CodingAgentSnapshotTable({
  caption,
  className,
  id,
  rows,
  tableClassName,
  variant,
}: Readonly<{
  caption: string;
  className?: string;
  id?: string;
  rows: readonly CodingAgentSnapshotRow[];
  tableClassName?: string;
  variant: SnapshotTableVariant;
}>) {
  const columns = variantColumns[variant];
  return (
    <div className={className}>
      <table className={tableClassName} id={id}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column} scope="col">{SNAPSHOT_COLUMN_LABELS[column]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              {columns.map((column, index) => {
                const value = snapshotRowCell(row, column);
                return index === 0
                  ? <th key={column} scope="row">{value}</th>
                  : <td key={column}>{value}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
