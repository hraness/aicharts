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
    "> AI model benchmarks for OpenAI, Anthropic and Google. The explorer opens on Argo-Bench reasoning effort curves. Made by Hraness (https://hraness.com).",
    "",
    "Argo-Bench covers 210 enterprise tasks. The explorer includes 60 settings from 16 models and plots score out of 100 against mean model API cost or output tokens per task. Each dot is a tested setting and curves connect settings of the same model.",
    "",
    "The benchmark picker includes Roboflow Visual Reasoning with judged accuracy and estimated cost or output tokens per sample, and IronBee Code Review with F₂ score and estimated uncached cost or output tokens per pull request. It also includes GameBench 2, Terminal-Bench, MirrorCode, GPQA Diamond and FrontierMath Tiers 1–3.",
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
    `- [Local AI benchmarks](${SITE_URL}/local): published quality benchmarks by workload.`,
    `- [Local measurements (JSON)](${SITE_URL}/api/local): models, metrics, scores and evaluation sources.`,
    `- [Release dataset (JSON)](${SITE_URL}/api/releases) contains the schema v2 catalog with GameBench 2 settings, Terminal-Bench runs, Epoch AI scores and API prices, plus each source's license and attribution. Argo-Bench, Roboflow and IronBee are explorer snapshots outside the release API.`,
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
