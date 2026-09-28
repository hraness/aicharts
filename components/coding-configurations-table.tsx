import type { CodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  CODING_CONFIGURATION_COLUMNS,
  CODING_CONFIGURATION_IDENTITY_LABELS,
  MISSING_CONFIGURATION_LABEL,
  MISSING_CONFIGURATION_VALUE,
  codingConfigurationCell,
  codingConfigurationModelLabel,
  codingConfigurationRows,
} from "@/lib/coding-configurations-table";

export function CodingConfigurationsTable({ snapshot }: Readonly<{ snapshot: CodingAgentSnapshot }>) {
  const rows = codingConfigurationRows(snapshot.records);
  return <section aria-labelledby="coding-configurations-title" className="coding-configurations">
    <h2 id="coding-configurations-title">{`All ${rows.length} configurations`}</h2>
    <div className="coding-configurations__scroll">
      <table className="coding-configurations__table">
        <caption>Coding-agent configurations in the current snapshot</caption>
        <thead>
          <tr>
            {CODING_CONFIGURATION_IDENTITY_LABELS.map(label => <th key={label} scope="col">{label}</th>)}
            {CODING_CONFIGURATION_COLUMNS.map(column => <th key={column.id} scope="col">{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(record => <tr key={record.id}>
            <th scope="row">{codingConfigurationModelLabel(record)}</th>
            <td>{record.agent}</td>
            <td>{record.providerName}</td>
            {CODING_CONFIGURATION_COLUMNS.map(column => {
              const cell = codingConfigurationCell(column, record);
              return <td data-column={column.id} key={column.id}>
                {cell ?? <><span aria-hidden="true">{MISSING_CONFIGURATION_VALUE}</span><span className="sr-only">{MISSING_CONFIGURATION_LABEL}</span></>}
              </td>;
            })}
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}
