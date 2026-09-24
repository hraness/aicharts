import type { CSSProperties, ReactNode } from "react";

import { formatUpdateDate } from "@/lib/coding-agent-updates";
import {
  DIRECT_DEEP_SWE_EVIDENCE,
  directDeepSweEvidenceForRelease,
} from "@/lib/deep-swe-evidence-collection";
import {
  DEEP_SWE_LEADERBOARD_URL,
  formatDeepSweEvidenceScore,
} from "@/lib/deep-swe-evidence";
import {
  FIRST_PARTY_RELEASE_HIGHLIGHTS,
  FIRST_PARTY_RELEASE_SOURCE_SUMMARY,
} from "@/lib/first-party-release-collection";
import { modelCardArtDirection } from "@/lib/model-card-art-direction";
import {
  MODEL_RELEASE_RADAR,
  MODEL_RELEASES_AWAITING_BENCHMARK,
  MODEL_RELEASES_WITH_EARLY_DEEP_SWE,
  modelReleaseRadarHighlightsExcluding,
} from "@/lib/model-release-collection";

const MODEL_RELEASE_RADAR_PAGE_HIGHLIGHTS = modelReleaseRadarHighlightsExcluding(
  FIRST_PARTY_RELEASE_HIGHLIGHTS.flatMap(release => release.namedModels),
);

type RadarItem = Readonly<{
  detail: ReactNode;
  href: string;
  id: string;
  meta: string | null;
  providerColor: string;
  title: string;
}>;

function ReleaseRadarSection({
  items,
  note,
  summary,
  title,
  titleId,
  eyebrow,
}: Readonly<{
  eyebrow: string;
  items: readonly RadarItem[];
  note: ReactNode;
  summary: ReactNode;
  title: string;
  titleId: string;
}>) {
  if (items.length === 0) return null;
  return (
    <section
      aria-labelledby={titleId}
      className="model-release-radar"
      data-analytics-surface="model_release_radar"
    >
      <div className="model-release-radar__heading">
        <p>{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
        <small>{summary}</small>
      </div>
      <ul className="hraness-marketing-card-row">
        {items.map(item => (
          <li
            key={item.id}
            style={{ "--release-provider": item.providerColor } as CSSProperties}
          >
            <a href={item.href}>
              <i aria-hidden="true" />
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
                <small className="hraness-marketing-card__meta model-release-radar__early-score">
                  {item.meta ?? "\u00a0"}
                </small>
              </span>
              <span aria-hidden="true">↗</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="model-release-radar__note">{note}</p>
    </section>
  );
}

export function ModelReleaseRadars() {
  return (
    <>
      <ReleaseRadarSection
        eyebrow="First-party release radar"
        items={FIRST_PARTY_RELEASE_HIGHLIGHTS.map(release => ({
          detail: (
            <>
              {release.providerName} · first observed{" "}
              <time dateTime={release.firstSeenAt}>
                {formatUpdateDate(release.firstSeenAt)}
              </time>
            </>
          ),
          href: release.canonicalUrl,
          id: release.id,
          meta: null,
          providerColor: modelCardArtDirection(release.providerId, "standard", "default").providerColor,
          title: release.namedModels.join(" and "),
        }))}
        note={(
          <>
            These links come from each lab&apos;s own release pages, so a model can
            appear here before aggregators such as OpenRouter list it. The date shows
            when AI Charts first found the page, which can differ from the official
            release date. Official dates and benchmark scores come from their own
            sources.
          </>
        )}
        summary={(
          <>
            {FIRST_PARTY_RELEASE_SOURCE_SUMMARY.labCount} labs · {FIRST_PARTY_RELEASE_SOURCE_SUMMARY.sourceCount} first-party sources
          </>
        )}
        title="New releases found at first-party sources"
        titleId="first-party-release-radar-title"
      />
      <ReleaseRadarSection
        eyebrow="Release radar"
        items={MODEL_RELEASE_RADAR_PAGE_HIGHLIGHTS.map(release => {
          const earlyEvidence = directDeepSweEvidenceForRelease(release);
          return {
            detail: (
              <>
                {release.providerName} · first observed{" "}
                <time dateTime={release.sourceAddedAt}>
                  {formatUpdateDate(release.sourceAddedAt)}
                </time>
              </>
            ),
            href: release.modelUrl,
            id: release.id,
            meta: earlyEvidence === null
              ? null
              : `Early DeepSWE ${formatDeepSweEvidenceScore(earlyEvidence.passAt1)} pass@1 · ${earlyEvidence.reasoningEffort ?? "default"} · ${earlyEvidence.runs} runs · ${earlyEvidence.identity.resolver.name} match`,
            providerColor: modelCardArtDirection(release.providerId, "standard", "default").providerColor,
            title: release.model,
          };
        })}
        note={(
          <>
            Models listed here do not yet have a complete result on the Artificial
            Analysis coding-agent chart. Where shown, an early{" "}
            <a href={DEEP_SWE_LEADERBOARD_URL}>DeepSWE v{DIRECT_DEEP_SWE_EVIDENCE.source.benchmarkVersion}</a>
            {" "}pass@1 comes straight from DataCurve&apos;s mini-swe-agent leaderboard,
            matched to the model through OpenRouter&apos;s catalog, or through Artificial
            Analysis when OpenRouter has no match. That result depends on DataCurve&apos;s
            harness, so it stays off the Artificial Analysis chart and model cards.
            Models with partial Artificial Analysis results can appear there, with
            missing metrics marked.
          </>
        )}
        summary={(
          <>
            {MODEL_RELEASES_AWAITING_BENCHMARK.length} incomplete · {MODEL_RELEASES_WITH_EARLY_DEEP_SWE.length} with early DeepSWE · OpenRouter checked{" "}
            <time dateTime={MODEL_RELEASE_RADAR.source.retrievedAt}>
              {formatUpdateDate(MODEL_RELEASE_RADAR.source.retrievedAt)}
            </time>
          </>
        )}
        title="New, awaiting complete benchmark coverage"
        titleId="model-release-radar-title"
      />
    </>
  );
}
