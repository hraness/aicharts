import codingAgentData from "@/data/coding-agents.json";
import { CodingAgentExplorer } from "@/components/coding-agent-explorer";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import { site } from "./site";

export default function Home() {
  const input: unknown = codingAgentData;
  const parsed = parseCodingAgentSnapshot(input);
  if (!parsed.ok) throw new Error(`Checked coding-agent snapshot is invalid: ${parsed.error.message}`, { cause: parsed.error });
  return <CodingAgentExplorer brand={{ domain: site.domain }} snapshot={parsed.value} />;
}
