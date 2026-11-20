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
    "> AI model benchmarks for OpenAI, Anthropic and Google. The explorer defaults to GameBench 2 scores and costs by reasoning effort, with Terminal-Bench agent runs and Epoch AI benchmark views. Made by Hraness (https://hraness.com).",
    "",
    "In GameBench 2, each dot is a tested reasoning setting and each line connects the settings of one model. Scores measure the strength of generated game-playing programs, and costs are per program. Terminal-Bench shows one submitted agent run per model, with cost per task and output tokens. MirrorCode, GPQA Diamond and FrontierMath show Epoch AI scores.",
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
    `- [Release dataset (JSON)](${SITE_URL}/api/releases): each release's GameBench 2 settings, Terminal-Bench run, Epoch AI scores and API prices, plus each source's license and attribution.`,
    `- [API documentation](${SITE_URL}/api): the dataset's fields, examples in the shell and JavaScript, caching and licenses. Free, no key, callable from any website.`,
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
