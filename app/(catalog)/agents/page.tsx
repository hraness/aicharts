import type { Metadata } from "next";
import { AgentComparison } from "@/components/catalog/agent-comparison";
import { pageMetadata } from "@/journal/content";
import { agentDescription, harnessGroups } from "@/lib/agents";

const groups = harnessGroups();

export const metadata: Metadata = pageMetadata(
  `Best AI coding agent: ${groups.map((g) => g.harness.name).join(" vs ")}`,
  agentDescription(groups),
  "/agents",
);

export default function AgentsPage() {
  return <>
    <AgentComparison groups={groups} pair={null} />
    <p><a href="/benchmarks/terminal-bench">Terminal-Bench leaderboard by benchmark version</a></p>
  </>;
}
