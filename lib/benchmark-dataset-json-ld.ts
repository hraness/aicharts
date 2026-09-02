import type { TerminalBenchSnapshot } from "./terminal-bench-data";
import type { TerminalBenchScienceSnapshot } from "./terminal-bench-science-data";

type DatasetPublisher = Readonly<{
  name: string;
  origin: string;
}>;

function publisherNode(publisher: DatasetPublisher) {
  return {
    "@type": "Organization",
    name: publisher.name,
    url: new URL("/", publisher.origin).toString(),
  } as const;
}

export function terminalBenchDatasetJsonLd(
  snapshot: TerminalBenchSnapshot,
  publisher: DatasetPublisher,
) {
  const pageUrl = new URL("/data#terminal-bench-4", publisher.origin).toString();
  return {
    "@context": "https://schema.org",
    "@id": pageUrl,
    "@type": "Dataset",
    citation: snapshot.source.repositoryCommitUrl,
    creator: {
      "@type": "Organization",
      name: snapshot.source.name,
      url: snapshot.source.repositoryUrl,
    },
    dateModified: snapshot.source.repositoryCommittedAt,
    description:
      `Version-pinned Terminal-Bench ${snapshot.benchmark.version} owner snapshot with `
      + `${snapshot.records.length} model-agent configurations, ${snapshot.benchmark.taskCount} tasks, `
      + `and ${snapshot.benchmark.trialsPerTask} trials per task.`,
    distribution: {
      "@type": "DataDownload",
      contentUrl: new URL("/data/terminal-bench-4.json", publisher.origin).toString(),
      encodingFormat: "application/json",
    },
    identifier: "aicharts-terminal-bench-4",
    isAccessibleForFree: true,
    isBasedOn: snapshot.source.repositoryCommitUrl,
    keywords: [
      "Terminal-Bench 4",
      "coding agent benchmark",
      "terminal engineering benchmark",
    ],
    measurementTechnique: "Terminal-Bench 4 accuracy across version-pinned Harbor tasks",
    name: `Terminal-Bench ${snapshot.benchmark.version} benchmark snapshot`,
    publisher: publisherNode(publisher),
    url: pageUrl,
    variableMeasured: [
      { "@type": "PropertyValue", name: "Accuracy", unitText: "percent" },
      { "@type": "PropertyValue", name: "95% confidence interval", unitText: "percentage points" },
      { "@type": "PropertyValue", name: "Evaluation cost", unitText: "USD" },
      { "@type": "PropertyValue", name: "Total tokens", unitText: "tokens" },
      { "@type": "PropertyValue", name: "Average trial duration", unitText: "seconds" },
    ],
    version: snapshot.benchmark.version,
  } as const;
}

export function terminalBenchScienceDatasetJsonLd(
  snapshot: TerminalBenchScienceSnapshot,
  publisher: DatasetPublisher,
) {
  const pageUrl = new URL("/data#terminal-bench-science", publisher.origin).toString();
  return {
    "@context": "https://schema.org",
    "@id": pageUrl,
    "@type": "Dataset",
    citation: snapshot.source.releaseDoiUrl,
    creator: {
      "@type": "Organization",
      name: snapshot.source.name,
      url: snapshot.source.repositoryUrl,
    },
    dateModified: snapshot.source.leaderboardUpdatedAt,
    description:
      `Version-pinned Terminal-Bench-Science ${snapshot.benchmark.version} owner snapshot with `
      + `${snapshot.records.length} system configurations, ${snapshot.benchmark.taskCount} scientific tasks, `
      + `and ${snapshot.benchmark.trialsPerTask} trials per task.`,
    distribution: {
      "@type": "DataDownload",
      contentUrl: new URL(
        "/data/terminal-bench-science-0-1.json",
        publisher.origin,
      ).toString(),
      encodingFormat: "application/json",
    },
    identifier: "aicharts-terminal-bench-science-0-1",
    isAccessibleForFree: true,
    isBasedOn: snapshot.source.releaseCommitUrl,
    keywords: [
      "Terminal-Bench-Science",
      "scientific agent benchmark",
      "AI research workflow benchmark",
    ],
    measurementTechnique: "Terminal-Bench-Science 0.1 resolution rate across accepted scientific workflows",
    name: `Terminal-Bench-Science ${snapshot.benchmark.version} benchmark snapshot`,
    publisher: publisherNode(publisher),
    url: pageUrl,
    variableMeasured: [
      { "@type": "PropertyValue", name: "Resolution rate", unitText: "percent" },
      { "@type": "PropertyValue", name: "Binomial standard error", unitText: "percentage points" },
      { "@type": "PropertyValue", name: "Evaluation cost", unitText: "USD" },
      { "@type": "PropertyValue", name: "Total tokens", unitText: "tokens" },
    ],
    version: snapshot.benchmark.version,
  } as const;
}
