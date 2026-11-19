import data from "@/data/releases.json";
import { GuideChart } from "@/components/guide-chart";
import { ArticleAction } from "@/components/article-action";
import { guide, pageMetadata } from "@/journal/content";
import { formatScore, formatUsd } from "@/lib/format";
import { getContextualReleases } from "@/lib/pareto";
import type { ReleaseDataset } from "@/lib/types";

export const metadata = pageMetadata(
  "Introducing aicharts — How to read a model’s effort curve",
  guide.summary,
  guide.href,
  true,
);
export default function Introduction() {
  const { releases } = data as unknown as ReleaseDataset;
  const example =
    releases.find((r) => r.slug === "gemini-4-neon") ??
    releases.find((r) => r.efforts.length > 1) ??
    releases[0]!;
  const field = getContextualReleases(releases, example, "release");
  const last = example.efforts.at(-1)!;
  const previous = example.efforts.at(-2);
  const url = "https://aicharts.io" + guide.href;
  return (
    <article className="introduction" data-pj-article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: guide.title,
            description: guide.summary,
            datePublished: guide.published,
            mainEntityOfPage: url,
            author: {
              "@type": "Organization",
              name: "Hraness",
              url: "https://hraness.com",
            },
          }),
        }}
      />
      <a className="back" href="/blog">
        Blog
      </a>
      <h1>{guide.title}</h1>
      <p className="dek">
        A coding model can sit in several places on the same leaderboard. It
        depends how hard you ask it to think.
      </p>
      <p>
        Say you run a coding assistant on every pull request. A small gain in
        benchmark score might be worth paying for on a difficult review. Across
        hundreds of routine ones, the cost of that last point starts to matter.
        aicharts puts the score and the cost on the same plot.
      </p>
      <h2>Read one release across the chart</h2>
      <p>
        Each dot represents a model at one reasoning effort setting. Higher
        means a better score. Farther right means a higher cost per task. The
        Pareto frontier connects the settings for which no other setting scores
        as well at a lower cost, or scores higher at the same cost.
      </p>
      {previous && (
        <p>
          For {example.name}, {previous.effortLabel.toLowerCase()} effort scores{" "}
          {formatScore(previous.scores.coding, "%")} at{" "}
          {formatUsd(previous.costUsdPerTask.total)} per task. At{" "}
          {last.effortLabel.toLowerCase()} effort, the score is{" "}
          {formatScore(last.scores.coding, "%")} and the cost is{" "}
          {formatUsd(last.costUsdPerTask.total)}. Those two dots let you put a
          price on the difference.
        </p>
      )}
      <GuideChart releases={field} initialSlug={example.slug} />
      <h2>Compare against the field it actually faced</h2>
      <p>
        In the explorer, choose a release and select <strong>At release</strong>{" "}
        to compare it with the models available that day. Switch to{" "}
        <strong>Live</strong> to see how it holds up against today’s field. You
        can share the chart URL with its model, benchmark, budget axis, and
        comparison period.
      </p>
      <p>
        The default Coding score gives equal weight to FrontierCode and
        Terminal-Bench. If your work mostly happens in a terminal, select
        Terminal-Bench on its own. The cost shown belongs to the measured task.
        Your own repository, prompts, and workload will have a different bill.
      </p>
      <p className="source-line">
        Explore the measurements at{" "}
        <a href="https://artificialanalysis.ai/models">Artificial Analysis</a>{" "}
        and <a href="https://tbench.ai">Terminal-Bench</a>, or get the{" "}
        <a href="/api/releases">public release data</a>.
      </p>
      <ArticleAction
        slug={guide.slug}
        heading="What does the next point cost?"
        description="Pick a release you use and compare two effort settings on the same benchmark."
        href={`/?release=${example.slug}`}
        label="Compare models"
      />
    </article>
  );
}
