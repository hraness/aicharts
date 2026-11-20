import { agentDescription, agentPairs, harnessGroups } from "@/lib/agents";
import { bestEpoch, catalog, isComparable, SITE_URL } from "@/lib/catalog";
import { agentLabel } from "@/lib/copy";
import { formatScore, formatUsd } from "@/lib/format";

export const dynamic = "force-static";

export function GET() {
  const model = (slug: string) => `${SITE_URL}/models/${slug}`;
  const pct = (value: number) => formatScore(value, "%");
  const comparable = catalog.pairs.filter(isComparable);
  const lines = [
    "# aicharts",
    "",
    "> Terminal-Bench scores, cost per task and output tokens for AI model releases from OpenAI, Anthropic and Google, with Epoch AI scores and API prices. Data from the official Terminal-Bench leaderboard (Apache-2.0), Epoch AI (CC BY 4.0) and LiteLLM's price list (MIT), refreshed several times a day. Made by Hraness (https://hraness.com).",
    "",
    "Each model is one point: its run on the Terminal-Bench leaderboard, in the coding agent and setting it was submitted with. A frontier star marks a model on the live cost frontier: for its cost per task, no current model scores higher. Model pages also list release-day stars, measured against the models out on that release's launch day.",
    "",
    "## Models",
    "",
    ...catalog.current.map((r) => {
      const run = r.terminalBench;
      const mirror = bestEpoch(r, "mirrorCode");
      const parts: string[] = [];
      if (run) {
        parts.push(
          `${pct(run.accuracy)} on Terminal-Bench in ${agentLabel(run)}${run.costPerTaskUsd !== null ? ` for ${formatUsd(run.costPerTaskUsd)} per task` : ""}`,
        );
      }
      if (mirror) parts.push(`${pct(mirror.score)} on MirrorCode (Epoch AI)`);
      return `- [${r.name}](${model(r.slug)}): ${parts.length > 0 ? parts.join("; ") : "no results published yet"}.`;
    }),
    "",
    "## Comparisons",
    "",
    `- [All comparisons](${SITE_URL}/compare): ${comparable.length} head-to-head pages.`,
    ...comparable
      .filter((p) => p.current)
      .map((p) => `- [${p.first.name} vs ${p.second.name}](${SITE_URL}/compare/${p.slug})`),
    "",
    "## Coding agents",
    "",
    `- [Best AI coding agent](${SITE_URL}/agents): ${agentDescription(harnessGroups())}`,
    ...agentPairs().map(
      (p) =>
        `- [${p.first.name} vs ${p.second.name}](${SITE_URL}/agents/${p.slug}): ${agentDescription(harnessGroups([p.first.id, p.second.id]))}`,
    ),
    "",
    "## Data",
    "",
    `- [Release dataset (JSON)](${SITE_URL}/api/releases): every release with its Terminal-Bench run, Epoch AI scores and API prices, plus each source's license and attribution.`,
    "",
    "## Optional",
    "",
    `- [Superseded models](${SITE_URL}/models#superseded)`,
    `- [Blog](${SITE_URL}/blog)`,
    `- [Changelog](${SITE_URL}/changelog)`,
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
