import { GuideChart } from "@/components/guide-chart";
import { ArticleAction } from "@/components/article-action";
import { guide, pageMetadata } from "@/journal/content";
import { catalog } from "@/lib/catalog";
import { formatRatio, formatScore, formatUsd } from "@/lib/format";
import { buildPlottedPoints, computeParetoFrontier, getQualifiedFrontierKeys } from "@/lib/pareto";
import { EPOCH_BENCHMARKS_URL, TERMINAL_BENCH } from "@/lib/types";

export const metadata = pageMetadata(
  "Introducing aicharts — How to read the cost chart",
  guide.summary,
  guide.href,
  true,
);
export default function Introduction() {
  const field = [...catalog.current];
  const frontier = computeParetoFrontier(buildPlottedPoints(field, "cost"));
  const starred = getQualifiedFrontierKeys(frontier);
  const qualified = frontier.filter((p) => starred.has(p.key));
  const top = qualified.at(-1);
  const cheap = qualified[0];
  const example = cheap ?? top;
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
        The best coding model on a leaderboard is rarely the best buy. The
        question is what the last few points cost.
      </p>
      <p>
        Say you run a coding agent on every pull request. A few more points of
        benchmark score might be worth paying for on a difficult review. Across
        hundreds of routine ones, the cost of those points starts to matter.
        aicharts puts the score and the cost on the same plot.
      </p>
      <h2>Read one model on the chart</h2>
      <p>
        Each dot is one model&apos;s run on {TERMINAL_BENCH.label}:{" "}
        {TERMINAL_BENCH.tasks} hard tasks done in a terminal, each attempted at
        least five times, with the model driving a coding agent. Higher means
        more tasks passed. Farther right means a higher cost per task. The
        dashed line is the Pareto frontier: the runs that no other run beats on
        score for the same cost or less.
      </p>
      {cheap && top && cheap !== top && (
        <p>
          On today&apos;s frontier, {cheap.release.name} passes{" "}
          {formatScore(cheap.score, "%")} of the tasks for{" "}
          {formatUsd(cheap.budget)} per task in {cheap.run.agent}.{" "}
          {top.release.name} passes {formatScore(top.score, "%")} for{" "}
          {formatUsd(top.budget)} in {top.run.agent}:{" "}
          {formatRatio(top.budget / cheap.budget)} the cost for{" "}
          {(top.score - cheap.score).toFixed(1)} more points. Those two dots
          put a price on the difference.
        </p>
      )}
      {example && <GuideChart releases={field} initialSlug={example.key} />}
      <h2>Compare against the field it actually faced</h2>
      <p>
        In the explorer, choose a model and select <strong>At release</strong>{" "}
        to compare it with the models available that day. Switch to{" "}
        <strong>Live</strong> to see how it holds up against today’s field. You
        can share the chart URL with its model, budget axis and comparison
        period.
      </p>
      <p>
        The cost is what a run reported spending across its trials, divided by
        the trials. Your own repository, prompts and workload will have a
        different bill. Each model page also lists Epoch AI&apos;s scores on
        MirrorCode, GPQA Diamond and FrontierMath, which test the model on its
        own, without an agent.
      </p>
      <p className="source-line">
        Explore the measurements at{" "}
        <a href={TERMINAL_BENCH.url}>Terminal-Bench</a> and{" "}
        <a href={EPOCH_BENCHMARKS_URL}>Epoch AI</a>, or get the{" "}
        <a href="/api/releases">public release data</a>.
      </p>
      <ArticleAction
        slug={guide.slug}
        heading="What does the next point cost?"
        description="Pick a model you use and see what the runs above it on the chart cost."
        href={`/?release=${example?.key ?? ""}`}
        label="Compare models"
      />
    </article>
  );
}
