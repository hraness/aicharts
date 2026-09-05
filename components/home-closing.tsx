import {
  MarketingCallToAction,
  MarketingMaker,
  MarketingQuestionList,
  MarketingStatStrip,
} from "@hraness/design-kit/react/server";
import Link from "next/link";

import type { CodingAgentSnapshot } from "@/lib/coding-agent-data";
import { codingAgentDatasetSummary } from "@/lib/coding-agent-dataset";
import { formatRetrievedAt, formatUpdateDate } from "@/lib/coding-agent-updates";

export const AI_CHARTS_REPOSITORY_URL = "https://github.com/hraness/aicharts";

/**
 * The closing homepage roles on the shared marketing grammar: a stat strip
 * from the checked coding-agent snapshot, the questions readers ask before
 * they trust a chart, the maker, and the call to action.
 */
export function HomeClosing({ snapshot }: Readonly<{ snapshot: CodingAgentSnapshot }>) {
  const summary = codingAgentDatasetSummary(snapshot);
  const retrievedAt = formatRetrievedAt(snapshot.source.retrievedAt);
  return (
    <>
      <MarketingStatStrip
        ariaLabel="Coding-agent snapshot in numbers"
        className="home-stats"
        source={(
          <>
            Counts from the checked{" "}
            <a
              data-analytics-destination-id="source:artificial-analysis"
              data-analytics-destination-kind="source"
              href={snapshot.source.url}
              rel="noreferrer"
              target="_blank"
            >
              {snapshot.source.name} coding-agent leaderboard
            </a>
            {" "}snapshot behind the chart above, retrieved{" "}
            <time dateTime={snapshot.source.retrievedAt}>{retrievedAt}</time>.
            Method and limits are on the <Link href="/data">data page</Link>.
          </>
        )}
        stats={[
          {
            detail: "Each a named model, agent harness, and effort setting",
            label: "Configurations",
            value: String(summary.recordCount),
          },
          {
            detail: "Distinct provider and model pairs",
            label: "Models",
            value: String(summary.modelCount),
          },
          {
            detail: `Across ${summary.agentCount} agent harnesses`,
            label: "Providers",
            value: String(summary.providerCount),
          },
          {
            detail: "Date of the checked snapshot",
            label: "Retrieved",
            value: formatUpdateDate(snapshot.source.retrievedAt),
          },
        ]}
      />
      <MarketingQuestionList
        heading="What to know before you trust a chart."
        headingId="home-questions-title"
        id="questions"
        label="Questions"
        questions={[
          {
            answer: (
              <p>
                Every chart reads from a checked snapshot of a published source: the
                Artificial Analysis Intelligence Index and coding-agent leaderboards,
                Terminal-Bench 4 submissions pinned to a commit in the Harbor Framework
                repository, the Terminal-Bench-Science leaderboard, and lab-owned release
                pages for the release radar. Each chart links to its source and shows the
                date it was retrieved. The <Link href="/data">data page</Link> lists every
                snapshot with its method, limits, and a JSON download.
              </p>
            ),
            question: "Where does the data come from?",
          },
          {
            answer: (
              <p>
                Scheduled jobs check lab release pages every hour, the benchmark
                leaderboards every four hours, and the Intelligence Index once a day. A new
                snapshot is published only when the guarded refresh finds a material change
                and the repository checks pass. A source that fails a check stays on its
                last good snapshot, so the retrieval date on each chart is the date of the
                data it shows.
              </p>
            ),
            question: "How often does it update?",
          },
          {
            answer: (
              <p>
                Benchmark families are never blended into one rank. Terminal-Bench 4 stays
                separate from the Terminal-Bench v2.1 that Artificial Analysis still
                reports, model-level output tokens stay separate from coding-agent total
                tokens, and benchmark-owner results stay distinct from vendor-reported ones.
                Missing values remain missing rather than estimated. AI Charts does not
                recalculate upstream outcomes and is not affiliated with the benchmark
                owners or listed providers.
              </p>
            ),
            question: "What is not compared?",
          },
          {
            answer: (
              <p>
                Ben Guo, building from Puerto Rico. The code is open source on{" "}
                <a href={AI_CHARTS_REPOSITORY_URL}>GitHub</a> under the MIT license, the
                site runs from checked data with no account and no runtime dependency on
                the upstream benchmark pages, and analytics are cookieless.
              </p>
            ),
            question: "Who made it?",
          },
        ]}
      />
      <MarketingMaker
        heading="Built by Ben Guo."
        headingId="home-maker-title"
        id="maker"
        label="Maker"
        links={[
          { href: "https://hraness.com", label: "hraness.com" },
          { href: "https://x.com/hraness", label: "@hraness on X" },
          { href: AI_CHARTS_REPOSITORY_URL, label: "Source on GitHub" },
        ]}
      >
        <p>
          Ben Guo is a musician and builder, formerly a founder and engineering leader at
          companies including Venmo and Stripe, now building from Puerto Rico. AI Charts is
          one of the projects he builds in the open.
        </p>
      </MarketingMaker>
      <MarketingCallToAction
        actions={[
          { href: "/models", label: "Browse the cards" },
          { href: "/data", label: "Read the method" },
        ]}
        footnote="Free to use, no account. Source code under the MIT license."
        heading="Every number here has a date and a source."
        headingId="home-cta-title"
      />
    </>
  );
}
