"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AiChartsMark,
  ExternalArrowIcon,
  FrontierStarIcon,
  GitHubIcon,
  ProviderLogo,
  ThemeIcon,
} from "./brand-icon";
import { FrontierStar } from "./frontier-stars";
import { ParetoChart } from "./pareto-chart";
import { SiteFooter } from "./site-footer";
import {
  formatFullDate,
  formatPrice,
  formatScore,
  formatShortDate,
  formatTokens,
  formatUsd,
} from "@/lib/format";
import { buildLineup } from "@/lib/lineup";
import { bestEpoch, effortName } from "@/lib/measures";
import {
  buildPlottedPoints,
  comparePointToFrontier,
  computeParetoFrontier,
  getChartScale,
  getContextualFrontierReleases,
  getContextualReleases,
  getQualifiedFrontierKeys,
} from "@/lib/pareto";
import {
  EPOCH_BENCHMARKS,
  PROVIDERS,
  TERMINAL_BENCH,
  type BudgetAxis,
  type ContextMode,
  type ModelRelease,
  type ProviderId,
  type ReleaseDataset,
} from "@/lib/types";

/**
 * The feed's two orders. Lineup groups current and superseded models by tier,
 * so siblings from each lab sit together, and charts them against today's
 * field. Releases lists them by date against the field each one launched into.
 */
type FeedView = "lineup" | "releases";
const VIEW_CONTEXT: Readonly<Record<FeedView, ContextMode>> = {
  lineup: "live",
  releases: "release",
};

/** The newest release whose run is on the cost chart, so the page opens on a dot. */
function openingRelease(releases: readonly ModelRelease[]): ModelRelease {
  return releases.find((r) => r.terminalBench?.costPerTaskUsd != null) ?? releases[0]!;
}

export function ReleaseExplorer({
  dataset,
  initialReleaseSlug,
  initialAxis,
  initialContext,
}: Readonly<{
  dataset: ReleaseDataset;
  initialReleaseSlug?: string;
  initialAxis?: BudgetAxis;
  initialContext?: ContextMode;
}>) {
  const chartSectionRef = useRef<HTMLElement>(null);

  const openingSlug = useMemo(() => openingRelease(dataset.releases).slug, [dataset.releases]);
  const defaultRelease = useMemo(() => {
    if (initialReleaseSlug) {
      const found = dataset.releases.find((r) => r.slug === initialReleaseSlug);
      if (found) return found;
    }
    return openingRelease(dataset.releases);
  }, [dataset.releases, initialReleaseSlug]);

  const [selectedSlug, setSelectedSlug] = useState<string>(defaultRelease.slug);
  const [axis, setAxis] = useState<BudgetAxis>(initialAxis ?? "cost");
  const [view, setView] = useState<FeedView>("lineup");
  const [contextMode, setContextMode] = useState<ContextMode>(
    initialContext ?? VIEW_CONTEXT.lineup,
  );
  const [providerFilter, setProviderFilter] = useState<ProviderId | "all">("all");
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [urlHydrated, setUrlHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("aicharts-theme");
      if (saved === "light" || saved === "dark") {
        setTheme(saved);
      }
    } catch {
      // ignore storage errors
    }

    const params = new URLSearchParams(window.location.search);
    const relParam = params.get("release");
    if (relParam) {
      const found = dataset.releases.find((r) => r.slug === relParam);
      if (found) setSelectedSlug(found.slug);
    }
    const axisParam = params.get("axis");
    if (axisParam === "cost" || axisParam === "tokens") {
      setAxis(axisParam);
    }
    const viewParam: FeedView = params.get("view") === "releases" ? "releases" : "lineup";
    setView(viewParam);
    const ctxParam = params.get("ctx");
    setContextMode(
      ctxParam === "release" || ctxParam === "live" ? ctxParam : VIEW_CONTEXT[viewParam],
    );
    setUrlHydrated(true);
  }, [dataset.releases]);

  const cycleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "system" ? "dark" : prev === "dark" ? "light" : "system";
      try {
        if (next === "system") {
          localStorage.removeItem("aicharts-theme");
          document.documentElement.removeAttribute("data-theme");
        } else {
          localStorage.setItem("aicharts-theme", next);
          document.documentElement.setAttribute("data-theme", next);
        }
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const selectedRelease = useMemo(
    () => dataset.releases.find((r) => r.slug === selectedSlug) ?? defaultRelease,
    [dataset.releases, selectedSlug, defaultRelease],
  );

  useEffect(() => {
    if (!urlHydrated || typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (selectedRelease.slug !== openingSlug) {
      params.set("release", selectedRelease.slug);
    }
    if (axis !== "cost") params.set("axis", axis);
    if (view !== "lineup") params.set("view", view);
    if (contextMode !== VIEW_CONTEXT[view]) params.set("ctx", contextMode);
    const qs = params.toString();
    const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [urlHydrated, selectedRelease.slug, openingSlug, axis, view, contextMode]);

  // Each order brings its own field: today's for the lineup, launch day's for releases.
  const selectView = useCallback((next: FeedView) => {
    setView(next);
    setContextMode(VIEW_CONTEXT[next]);
  }, []);

  const handleSelectRelease = useCallback(
    (slug: string, scrollIfNeeded = false) => {
      const target = dataset.releases.find((r) => r.slug === slug);
      if (!target) return;
      setSelectedSlug(target.slug);
      if (scrollIfNeeded && chartSectionRef.current) {
        const rect = chartSectionRef.current.getBoundingClientRect();
        if (rect.top < -36) {
          chartSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    },
    [dataset.releases],
  );

  const filteredFeedReleases = useMemo(() => {
    if (providerFilter === "all") return dataset.releases;
    return dataset.releases.filter((r) => r.provider === providerFilter);
  }, [dataset.releases, providerFilter]);

  const lineupSections = useMemo(() => {
    const lineup = buildLineup(dataset.releases);
    const shown = (groups: typeof lineup.current) =>
      groups
        .map((g) => ({
          ...g,
          releases: g.releases.filter(
            (r) => providerFilter === "all" || r.provider === providerFilter,
          ),
        }))
        .filter((g) => g.releases.length > 0);
    return [
      { key: "current", title: "Current", groups: shown(lineup.current) },
      { key: "superseded", title: "Superseded", groups: shown(lineup.superseded) },
    ].filter((section) => section.groups.length > 0);
  }, [dataset.releases, providerFilter]);

  // The order on screen, for j/k stepping.
  const feedOrder = useMemo(
    () =>
      view === "lineup"
        ? lineupSections.flatMap((section) => section.groups.flatMap((g) => g.releases))
        : filteredFeedReleases,
    [view, lineupSections, filteredFeedReleases],
  );

  // One set of axes for every selection, field and lab filter.
  const chartScale = useMemo(() => getChartScale(dataset.releases), [dataset.releases]);

  // Silent keyboard j/k stepping
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      ) {
        return;
      }
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const idx = feedOrder.findIndex((r) => r.slug === selectedRelease.slug);
        if (idx === -1) return;
        const nextIdx =
          e.key === "j" ? Math.min(feedOrder.length - 1, idx + 1) : Math.max(0, idx - 1);
        const nextRel = feedOrder[nextIdx];
        if (nextRel) handleSelectRelease(nextRel.slug, false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [feedOrder, selectedRelease.slug, handleSelectRelease]);

  const enabledProvidersSet = useMemo(() => {
    if (providerFilter === "all") return undefined;
    return new Set<ProviderId>([providerFilter]);
  }, [providerFilter]);

  const contextualReleases = useMemo(
    () =>
      getContextualReleases(
        dataset.releases,
        selectedRelease,
        contextMode,
        enabledProvidersSet,
      ),
    [dataset.releases, selectedRelease, contextMode, enabledProvidersSet],
  );

  const plottedPoints = useMemo(
    () => buildPlottedPoints(contextualReleases, axis),
    [contextualReleases, axis],
  );

  const frontier = useMemo(() => computeParetoFrontier(plottedPoints), [plottedPoints]);
  const qualifiedFrontierSet = useMemo(() => getQualifiedFrontierKeys(frontier), [frontier]);

  // Null when the selected model has no dot on this chart.
  const selectedPoint = useMemo(
    () => plottedPoints.find((p) => p.key === selectedRelease.slug) ?? null,
    [plottedPoints, selectedRelease.slug],
  );

  const frontierComparison = useMemo(
    () => (selectedPoint ? comparePointToFrontier(selectedPoint, frontier) : null),
    [selectedPoint, frontier],
  );

  // A star for each release on the qualified frontier (>= 75% of the top
  // score) of the field its chart shows when selected, so stars follow
  // At release / Live and the lab filter.
  const frontierStars = useMemo(
    () => getContextualFrontierReleases(dataset.releases, axis, contextMode, enabledProvidersSet),
    [dataset.releases, axis, contextMode, enabledProvidersSet],
  );

  const globalMaxFeedScore = useMemo(() => {
    let max = 65;
    for (const r of dataset.releases) {
      const s = r.terminalBench?.accuracy ?? 0;
      if (s > max) max = s;
    }
    return Math.ceil(max / 5) * 5;
  }, [dataset.releases]);

  // One feed row; both orders list the same rows.
  const renderFeedRow = (rel: ModelRelease) => {
    const isSelected = rel.slug === selectedRelease.slug;
    const score = rel.terminalBench?.accuracy ?? null;
    const barPct = score === null ? 0 : Math.max(2, Math.min(100, (score / globalMaxFeedScore) * 100));

    return (
      <button
        key={rel.slug}
        type="button"
        role="option"
        aria-selected={isSelected}
        className={`feed-row feed-row--${rel.provider}${isSelected ? " is-selected" : ""}${rel.deprecated ? " is-deprecated" : ""}`}
        onClick={() => handleSelectRelease(rel.slug, true)}
      >
        <span className="feed-row__date mono">{formatShortDate(rel.releaseDate)}</span>

        <span className="feed-row__main">
          <ProviderLogo provider={rel.provider} size={18} />
          <span className="feed-row__name">{rel.name}</span>
          {frontierStars.has(rel.slug) && <FrontierStar size={8} context={contextMode} />}
        </span>

        <span className="feed-row__right">
          <span className="score-track" aria-hidden="true">
            <span
              className={`score-fill score-fill--${rel.provider}`}
              style={{ width: `${barPct}%` }}
            />
          </span>
          <strong className="feed-row__score mono">
            {score === null ? "—" : formatScore(score, "%")}
          </strong>
        </span>
      </button>
    );
  };

  return (
    <div className="shell">
      {/* Minimal Header */}
      <header className="topbar">
        <div className="topbar__brand">
          <AiChartsMark size={23} />
          <span className="topbar__title">aicharts</span>
        </div>

        <div className="topbar__actions">
          <nav className="journal-nav" aria-label="Product pages">
            <a href="/models">Models</a>
            <a href="/compare">Compare</a>
            <a href="/agents">Agents</a>
            <a href="/blog">Blog</a>
            <a href="/changelog">Changelog</a>
          </nav>
          <div className="brand-legend" aria-label="Tracked labs">
            {(["anthropic", "openai", "google"] as const).map((pid) => (
              <span key={pid} className="legend-item">
                <ProviderLogo provider={pid} size={12} />
                <span>{PROVIDERS[pid].shortName}</span>
              </span>
            ))}
          </div>

          <a
            href="/api/releases"
            className="icon-btn icon-btn--text"
            title="Normalized JSON dataset"
          >
            JSON
          </a>
          <a
            href="https://github.com/hraness/aicharts"
            target="_blank"
            rel="noopener noreferrer"
            className="icon-btn"
            aria-label="GitHub repository"
            title="Open-source repository on GitHub"
          >
            <GitHubIcon size={14} />
          </a>
          <button
            type="button"
            onClick={cycleTheme}
            className="icon-btn"
            aria-label={`Appearance: ${theme}`}
            title={`Theme: ${theme} (click to switch)`}
          >
            <ThemeIcon mode={theme} />
          </button>
        </div>
      </header>

      <main className="main-stack">
        {/* Selected Release Pareto Card */}
        <section
          ref={chartSectionRef}
          className={`pareto-card pareto-card--${selectedRelease.provider}`}
          aria-label="Selected release Pareto curve"
        >
          <div className="release-head">
            <div className="release-head__identity">
              <ProviderLogo provider={selectedRelease.provider} size={22} />
              <div className="release-head__titles">
                <div className="release-head__title-row">
                  <h1 className="release-head__name">{selectedRelease.name}</h1>
                  {frontierStars.has(selectedRelease.slug) && (
                    <FrontierStar size={9} labelled context={contextMode} />
                  )}
                </div>
                <div className="release-head__meta">
                  <span>{PROVIDERS[selectedRelease.provider].name}</span>
                  <span className="dot-sep">·</span>
                  <time dateTime={selectedRelease.releaseDate}>
                    {formatFullDate(selectedRelease.releaseDate)}
                  </time>
                  <span className="dot-sep">·</span>
                  <a className="release-head__page" href={`/models/${selectedRelease.slug}`}>
                    Model page
                  </a>
                </div>
              </div>
            </div>

            {selectedRelease.announcementUrl && (
              <a
                href={selectedRelease.announcementUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="source-link"
              >
                <span>Source</span>
                <ExternalArrowIcon size={10} />
              </a>
            )}
          </div>

          {/* Chart Controls */}
          <div className="chart-controls">
            <p className="chart-controls__title" title={TERMINAL_BENCH.description}>
              {TERMINAL_BENCH.label} score
            </p>

            <div className="chart-controls__right">
              <div className="seg-group" role="group" aria-label="Budget axis">
                <button
                  type="button"
                  className={`seg-btn${axis === "cost" ? " is-active" : ""}`}
                  onClick={() => setAxis("cost")}
                >
                  Cost
                </button>
                <button
                  type="button"
                  className={`seg-btn${axis === "tokens" ? " is-active" : ""}`}
                  onClick={() => setAxis("tokens")}
                >
                  Tokens
                </button>
              </div>

              <div className="seg-group" role="group" aria-label="Comparison cohort">
                <button
                  type="button"
                  className={`seg-btn${contextMode === "release" ? " is-active" : ""}`}
                  onClick={() => setContextMode("release")}
                  title="Compare against models available when this release launched"
                >
                  At release
                </button>
                <button
                  type="button"
                  className={`seg-btn${contextMode === "live" ? " is-active" : ""}`}
                  onClick={() => setContextMode("live")}
                  title="Compare against all active models today"
                >
                  Live
                </button>
              </div>
            </div>
          </div>

          {/* Interactive SVG Pareto Curve */}
          <ParetoChart
            releases={contextualReleases}
            scale={chartScale}
            selectedRelease={selectedRelease}
            axis={axis}
            onSelectRelease={(slug) => handleSelectRelease(slug, false)}
          />

          {/* Frontier verdict and the model's scores */}
          <div className="inspector">
            <div
              className={`frontier-banner${
                selectedPoint && qualifiedFrontierSet.has(selectedPoint.key)
                  ? " frontier-banner--optimal"
                  : ""
              }`}
            >
              {!selectedPoint || !frontierComparison ? (
                <div className="frontier-banner__line">
                  <span className="effort-dot" aria-hidden="true" />
                  <span>
                    {selectedRelease.terminalBench
                      ? "Its Terminal-Bench run reported no cost, so it is on the tokens chart only."
                      : `No Terminal-Bench run yet, so ${selectedRelease.name} is not on the chart.`}
                  </span>
                </div>
              ) : frontierComparison.onFrontier ? (
                <div className="frontier-banner__line">
                  {qualifiedFrontierSet.has(selectedPoint.key) ? (
                    <span className="frontier-banner__star">
                      <FrontierStarIcon size={11} />
                    </span>
                  ) : (
                    <span className="effort-dot is-active" aria-hidden="true" />
                  )}
                  <span>
                    {qualifiedFrontierSet.has(selectedPoint.key) ? (
                      <>
                        On the {contextMode === "release" ? "release-day" : "live"} Pareto frontier at{" "}
                      </>
                    ) : (
                      <>Undominated at low budget (</>
                    )}
                    <strong className="mono">
                      {axis === "cost"
                        ? `${formatUsd(selectedPoint.budget)}/task`
                        : `${formatTokens(selectedPoint.budget)} tok`}
                    </strong>
                    {qualifiedFrontierSet.has(selectedPoint.key)
                      ? ": no model scores higher for less"
                      : "), below the bar for a star: 75% of the top score"}
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="frontier-banner__btn"
                  onClick={() =>
                    handleSelectRelease(frontierComparison.dominator.release.slug, false)
                  }
                >
                  <ProviderLogo provider={frontierComparison.dominator.provider} size={14} />
                  <span>
                    Topped by <strong>{frontierComparison.dominator.release.name}</strong> ·{" "}
                    <strong className="mono">
                      {formatScore(frontierComparison.dominator.score, "%")}
                    </strong>{" "}
                    <span className="frontier-banner__delta mono">
                      (+{frontierComparison.scoreDeficit.toFixed(1)})
                    </span>{" "}
                    at{" "}
                    <span className="mono">
                      {axis === "cost"
                        ? `${formatUsd(frontierComparison.dominator.budget)}/task`
                        : `${formatTokens(frontierComparison.dominator.budget)} tok`}
                    </span>
                  </span>
                  <span className="frontier-banner__arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              )}
            </div>

            <MeasureTable release={selectedRelease} />
          </div>
        </section>

        {/* Model feed: lineup tiers or release dates */}
        <section className="feed-section" aria-label="Coding models">
          <div className="feed-header">
            <div className="feed-header__left">
              <h2 className="feed-header__title">Models</h2>
              <span className="feed-header__count mono">{filteredFeedReleases.length}</span>
              <div className="seg-group" role="group" aria-label="Order models by">
                <button
                  type="button"
                  aria-pressed={view === "lineup"}
                  className={`seg-btn${view === "lineup" ? " is-active" : ""}`}
                  onClick={() => selectView("lineup")}
                  title="Current and superseded models, each lab's flagships together, against today's models"
                >
                  Lineup
                </button>
                <button
                  type="button"
                  aria-pressed={view === "releases"}
                  className={`seg-btn${view === "releases" ? " is-active" : ""}`}
                  onClick={() => selectView("releases")}
                  title="Every model by release date, against the models out on its release day"
                >
                  Releases
                </button>
              </div>
            </div>

            <div className="provider-filters" role="tablist" aria-label="Filter by lab">
              <button
                type="button"
                role="tab"
                aria-selected={providerFilter === "all"}
                className={`filter-pill${providerFilter === "all" ? " is-active" : ""}`}
                onClick={() => setProviderFilter("all")}
              >
                All
              </button>
              {(["anthropic", "openai", "google"] as const).map((pid) => (
                <button
                  key={pid}
                  type="button"
                  role="tab"
                  aria-selected={providerFilter === pid}
                  className={`filter-pill filter-pill--${pid}${providerFilter === pid ? " is-active" : ""}`}
                  onClick={() => setProviderFilter((curr) => (curr === pid ? "all" : pid))}
                >
                  <ProviderLogo provider={pid} size={13} />
                  <span>{PROVIDERS[pid].shortName}</span>
                </button>
              ))}
            </div>
          </div>

          {view === "lineup" ? (
            <div className="feed-list" role="listbox" aria-label="Models by lineup tier">
              {lineupSections.map((section) => (
                <Fragment key={section.key}>
                  <div className="feed-band" aria-hidden="true">
                    <span id={`lineup-${section.key}`}>{section.title}</span>
                    <span className="feed-band__count mono">
                      {section.groups.reduce((n, g) => n + g.releases.length, 0)}
                    </span>
                  </div>
                  {section.groups.map((g) => {
                    const labelId = `lineup-${section.key}-${g.tier}`;
                    return (
                      <div
                        key={labelId}
                        className="feed-group"
                        role="group"
                        aria-labelledby={`lineup-${section.key} ${labelId}`}
                      >
                        <div id={labelId} className="feed-group__label" role="presentation">
                          {g.label}
                        </div>
                        {g.releases.map(renderFeedRow)}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          ) : (
            <div className="feed-list" role="listbox" aria-label="Models by release date">
              {filteredFeedReleases.map(renderFeedRow)}
            </div>
          )}
        </section>
        <p className="data-note">
          Data from{" "}
          {dataset.sources.map((source, i) => (
            <Fragment key={source.id}>
              {i > 0 && ", "}
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.name}
              </a>{" "}
              ({source.license})
            </Fragment>
          ))}{" "}
          · Updated {dataset.snapshotDate}
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}

/**
 * The selected model's scores: its Terminal-Bench run, then its best Epoch AI
 * score on each benchmark, with the setting each was run at.
 */
function MeasureTable({ release }: Readonly<{ release: ModelRelease }>) {
  const run = release.terminalBench;
  const facts = [
    run && run.costPerTaskUsd !== null ? `${formatUsd(run.costPerTaskUsd)} per task` : null,
    run ? `${formatTokens(run.tokensPerTask.output)} output tokens` : null,
    run?.minutesPerTask != null ? `${Math.round(run.minutesPerTask)} min per task` : null,
    release.pricing
      ? `API ${formatPrice(release.pricing.inputPer1M)}/${formatPrice(release.pricing.outputPer1M)} per 1M tokens`
      : null,
  ].filter((fact): fact is string => fact !== null);
  return (
    <>
      <div className="effort-table measure-table" role="table" aria-label={`${release.name} scores`}>
        <div className="effort-table__head" role="row">
          <span role="columnheader">Benchmark</span>
          <span role="columnheader" className="align-right">
            Score
          </span>
          <span role="columnheader">Run</span>
        </div>
        <div className="effort-row" role="row">
          <span role="cell" className="effort-row__label" title={TERMINAL_BENCH.description}>
            {TERMINAL_BENCH.label}
            {run ? ` ${run.version}` : ""}
          </span>
          <span role="cell" className="effort-row__score mono align-right">
            {run ? formatScore(run.accuracy, "%") : "—"}
          </span>
          <span role="cell" className="effort-row__cell">
            {run ? `${run.agent} · ${effortName(run.effort)}` : "No run yet"}
          </span>
        </div>
        {EPOCH_BENCHMARKS.map((benchmark) => {
          const best = bestEpoch(release, benchmark.id);
          return (
            <div key={benchmark.id} className="effort-row" role="row">
              <span role="cell" className="effort-row__label" title={benchmark.description}>
                {benchmark.label}
              </span>
              <span role="cell" className="effort-row__score mono align-right">
                {best ? formatScore(best.score, "%") : "—"}
              </span>
              <span role="cell" className="effort-row__cell">
                {best ? `Epoch AI · ${effortName(best.effort)}` : "Not run by Epoch AI"}
              </span>
            </div>
          );
        })}
      </div>
      {facts.length > 0 && <p className="measure-facts mono">{facts.join(" · ")}</p>}
    </>
  );
}
