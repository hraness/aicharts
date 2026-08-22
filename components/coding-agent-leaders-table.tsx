import {
  formatBenchmarkScore,
  type CodingAgentBenchmarkLeader,
} from "@/lib/coding-agent-dataset";

export function CodingAgentLeadersTable({
  caption,
  className = "plain-publication__table-scroll",
  leaders,
  tableClassName = "plain-publication__table",
}: Readonly<{
  caption: string;
  className?: string;
  leaders: readonly CodingAgentBenchmarkLeader[];
  tableClassName?: string;
}>) {
  return (
    <div className={className}>
      <table className={tableClassName}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Benchmark</th>
            <th scope="col">Model</th>
            <th scope="col">Agent</th>
            <th scope="col">Provider</th>
            <th scope="col">Setting</th>
            <th scope="col">Score</th>
          </tr>
        </thead>
        <tbody>
          {leaders.map(leader => (
            <tr key={leader.definition.id}>
              <th scope="row">{leader.definition.label}</th>
              <td>{leader.record.model}</td>
              <td>{leader.record.agent}</td>
              <td>{leader.record.providerName}</td>
              <td>{leader.record.setting}</td>
              <td>{formatBenchmarkScore(leader.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
