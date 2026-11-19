import { bestEffort, catalog, defaultEffort, effortName, publishedEffortSteps, SITE_URL } from "@/lib/catalog";
import { effortStepTitle, orderedEffortSteps } from "@/lib/copy";
import { formatScore, formatUsd } from "@/lib/format";

export const dynamic = "force-static";

export function GET() {
  const model = (slug: string) => `${SITE_URL}/models/${slug}`;
  const lines = [
    "# aicharts",
    "",
    "> Coding scores, cost per task and output tokens for AI model releases from OpenAI, Anthropic and Google, measured at every effort setting each model offers. Data from Artificial Analysis and Terminal-Bench, refreshed several times a day. Made by Hraness (https://hraness.com).",
    "",
    "The coding composite is the mean of FrontierCode 2.0 and Terminal-Bench 4.0. A frontier star marks an effort setting on the live cost frontier: for that spend per task, no current model scores higher.",
    "",
    "## Models",
    "",
    ...catalog.current.map((r) => {
      const best = bestEffort(r);
      const preset = defaultEffort(r);
      return `- [${r.name}](${model(r.slug)}): ${formatScore(best.scores.coding, "%")} coding at ${effortName(best.effortSlug)} effort for ${formatUsd(best.costUsdPerTask.total)} per task; default ${effortName(preset.effortSlug)}.`;
    }),
    "",
    "## Effort levels",
    "",
    `- [Effort levels compared](${SITE_URL}/effort): what each step from Low to Max adds and costs.`,
    ...orderedEffortSteps(publishedEffortSteps(catalog.releases)).map(
      (step) => `- [${effortStepTitle(step)}](${SITE_URL}/effort/${step.slug})`,
    ),
    "",
    "## Comparisons",
    "",
    `- [All comparisons](${SITE_URL}/compare): ${catalog.pairs.length} head-to-head pages.`,
    ...catalog.pairs
      .filter((p) => p.current)
      .map((p) => `- [${p.first.name} vs ${p.second.name}](${SITE_URL}/compare/${p.slug})`),
    "",
    "## Data",
    "",
    `- [Release dataset (JSON)](${SITE_URL}/api/releases): every release and effort setting.`,
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
