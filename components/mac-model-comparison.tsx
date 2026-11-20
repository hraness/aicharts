import { number, type Run } from "@/lib/local-hardware-format";

const baseline = " · mlx / metal · int4 · batch 1 · 1024 in / 100 out";

export function MacModelComparison({runs}: {runs: Run[]}) {
  const byModel = new Map<string, Map<string, Run>>();
  const machines = new Set<string>();
  for (const run of runs) {
    if (!run.config.endsWith(baseline)) continue;
    const machine = run.config.slice(0, -baseline.length);
    machines.add(machine);
    const matched = byModel.get(run.model) ?? new Map();
    matched.set(machine, run);
    byModel.set(run.model, matched);
  }
  if (machines.size < 2) return null;
  const columns = [...machines].sort();
  const common = [...byModel].filter(([, measurements]) => measurements.size === columns.length);
  if (!common.length) return null;

  return <section>
    <h2>How fast do the same models reply?</h2>
    <p>Both Macs ran one request at a time in MLX Metal with 4-bit weights, a 1,024-token prompt and 100 output tokens. Each speed links to its measured run.</p>
    <table className="vision-table"><thead><tr><th>Model</th>{columns.map(machine=><th key={machine}>{machine}</th>)}</tr></thead>
      <tbody>{common.map(([model, measurements])=><tr key={model}><th scope="row">{model}</th>{columns.map(machine=>{
        const run=measurements.get(machine)!;
        return <td key={machine}><a href={run.source}>{number.format(run.values.generation!)} tok/s</a></td>;
      })}</tr>)}</tbody></table>
  </section>;
}
