import {
  currentCodingAgentBenchmarkLeaders,
} from "@/lib/coding-agent-dataset";
import type { CodingAgentSnapshot } from "@/lib/coding-agent-data";

import { CodingAgentLeadersTable } from "./coding-agent-leaders-table";

export function HomeLeaders({
  snapshot,
}: Readonly<{ snapshot: CodingAgentSnapshot }>) {
  const leaders = currentCodingAgentBenchmarkLeaders(snapshot);

  return (
    <section aria-label="Current coding-agent benchmark leaders" className="home-leaders">
      <CodingAgentLeadersTable
        caption="Highest score by benchmark in the current snapshot"
        leaders={leaders}
      />
    </section>
  );
}
