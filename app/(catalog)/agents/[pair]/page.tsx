import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentComparison } from "@/components/catalog/agent-comparison";
import { pageMetadata } from "@/journal/content";
import { agentDescription, agentPairs, findAgentPair, harnessGroups, searchName } from "@/lib/agents";

type Params = Promise<{ pair: string }>;

export const dynamicParams = false;

export function generateStaticParams() {
  return agentPairs().map((p) => ({ pair: p.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const pair = findAgentPair((await params).pair);
  if (!pair) return {};
  return pageMetadata(
    `${searchName(pair.first)} vs ${searchName(pair.second)}: benchmarks and cost per task`,
    agentDescription(harnessGroups([pair.first.id, pair.second.id])),
    `/agents/${pair.slug}`,
  );
}

export default async function AgentPairPage({ params }: { params: Params }) {
  const pair = findAgentPair((await params).pair);
  if (!pair) notFound();
  return <AgentComparison groups={harnessGroups([pair.first.id, pair.second.id])} pair={pair} />;
}
