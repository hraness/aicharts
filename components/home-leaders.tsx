import { homeHeading } from "@/app/site";
import {
  currentCodingAgentBenchmarkLeaders,
  currentCodingAgentLeadersHeading,
  homeLeadersParagraphs,
} from "@/lib/coding-agent-dataset";
import type { CodingAgentSnapshot } from "@/lib/coding-agent-data";

import { CodingAgentLeadersTable } from "./coding-agent-leaders-table";

export function HomeLeaders({
  snapshot,
}: Readonly<{ snapshot: CodingAgentSnapshot }>) {
  const retrievedAt = snapshot.source.retrievedAt;
  const paragraphs = homeLeadersParagraphs(snapshot);
  const leaders = currentCodingAgentBenchmarkLeaders(snapshot);

  return (
    <section className="home-leaders" aria-labelledby="home-heading">
      <h1 id="home-heading">{homeHeading}</h1>
      <h2>{currentCodingAgentLeadersHeading(retrievedAt)}</h2>
      {paragraphs.map(paragraph => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <CodingAgentLeadersTable
        caption="Highest score by benchmark in the current snapshot"
        leaders={leaders}
      />
    </section>
  );
}
