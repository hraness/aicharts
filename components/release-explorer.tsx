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
import { EpochScoreChart, GameBenchEfforts } from "./benchmark-scores";
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
  buildBenchmarkPoints,
  comparePointToFrontier,
  computeParetoFrontier,
  getChartScale,
  getContextualFrontierReleases,
  getContextualReleases,
  getQualifiedFrontierKeys,
  primaryPoint,
  type ChartBenchmark,
} from "@/lib/pareto";
import {
  EPOCH_BENCHMARKS,
  GAME_BENCH,
  PROVIDERS,
  TERMINAL_BENCH,
  type BudgetAxis,
  type ContextMode,
  type EffortSlug,
  type EpochBenchmarkId,
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

type Benchmark = ChartBenchmark | EpochBenchmarkId;

const BENCHMARKS: readonly { id: Benchmark; label: string }[] = [
  { id: "game-bench", label: GAME_BENCH.label },
  { id: "terminal-bench", label: TERMINAL_BENCH.label },
  ...EPOCH_BENCHMARKS,
];

function benchmarkScore(release: ModelRelease, benchmark: Benchmark): number | null {
  if (benchmark === "terminal-bench") return release.terminalBench?.accuracy ?? null;
  if (benchmark === "game-bench") {
    const runs = release.gameBench ?? [];
    return runs.length ? Math.max(...runs.map((run) => run.score)) : null;
  }
  return bestEpoch(release, benchmark)?.score ?? null;
}

/** Start on a release with a point or score on the chosen benchmark. */
function openingRelease(releases: readonly ModelRelease[], benchmark: Benchmark): ModelRelease {
  return releases.find((r) =>
    benchmark === "terminal-bench"
      ? r.terminalBench?.costPerTaskUsd != null
      : benchmarkScore(r, benchmark) !== null,
  ) ?? releases[0]!;
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
  const gameBenchSource = dataset.sources.find((source) => source.id === "gamebench-2");
  const defaultBenchmark = gameBenchSource ? "game-bench" : "terminal-bench";
  const [benchmark, setBenchmark] = useState<Benchmark>(defaultBenchmark);
  const [activeEffort, setActiveEffort] = useState<EffortSlug | null>(null);
  const openingSlug = useMemo(
    () => openingRelease(dataset.releases, benchmark).slug,
    [dataset.releases, benchmark],
  );
  const defaultRelease = useMemo(() => {
    if (initialReleaseSlug) {
      const found = dataset.releases.find((r) => r.slug === initialReleaseSlug);
      if (found) return found;
    }
    return openingRelease(dataset.releases, defaultBenchmark);
  }, [dataset.releases, initialReleaseSlug, defaultBenchmark]);

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
    const axisParam = params.get("axis");
    const benchParam = params.get("bench");
    const requested = BENCHMARKS.find((option) => option.id === benchParam)?.id;
    const wasTerminal = params.get("metric") === "terminalBench4" || axisParam === "tokens";
    const nextBenchmark = requested === "game-bench" && !gameBenchSource
      ? defaultBenchmark
      : requested ?? (wasTerminal ? "terminal-bench" : defaultBenchmark);
    setBenchmark(nextBenchmark);
    const relParam = params.get("release");
    const initial = dataset.releases.find((r) => r.slug === relParam) ??
      (initialReleaseSlug ? defaultRelease : openingRelease(dataset.releases, nextBenchmark));
    setSelectedSlug(initial.slug);
    const effort = initial.gameBench?.find((run) => run.effort === params.get("effort"))?.effort;
    if (effort && nextBenchmark === "game-bench") setActiveEffort(effort);
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
  }, [dataset.releases, defaultBenchmark, defaultRelease, gameBenchSource, initialReleaseSlug]);

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
    if (benchmark !== defaultBenchmark) params.set("bench", benchmark);
    if (benchmark === "terminal-bench" && axis !== "cost") params.set("axis", axis);
    if (benchmark === "game-bench" && activeEffort) params.set("effort", activeEffort);
    if (view !== "lineup") params.set("view", view);
    if (contextMode !== VIEW_CONTEXT[view]) params.set("ctx", contextMode);
    const qs = params.toString();
    const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [urlHydrated, selectedRelease.slug, openingSlug, benchmark, defaultBenchmark, activeEffort, axis, view, contextMode]);

  // Each order brings its own field: today's for the lineup, launch day's for releases.
  const selectView = useCallback((next: FeedView) => {
    setView(next);
    setContextMode(VIEW_CONTEXT[next]);
  }, []);

  const handleSelectRelease = useCallback(
    (slug: string, scrollIfNeeded = false, effort: EffortSlug | null = null) => {
      const target = dataset.releases.find((r) => r.slug === slug);
      if (!target) return;
      setSelectedSlug(target.slug);
      setActiveEffort(effort);
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

  const chartBenchmark = benchmark === "game-bench" || benchmark === "terminal-bench" ? benchmark : null;
  const isGameBench = benchmark === "game-bench";
  const chartAxis = isGameBench ? "cost" : axis;
  const epochBenchmark = EPOCH_BENCHMARKS.find((option) => option.id === benchmark);
  const scoreUnit = isGameBench ? "pts" : "%";
  const chartScale = useMemo(
    () => chartBenchmark ? getChartScale(dataset.releases, chartBenchmark) : undefined,
    [dataset.releases, chartBenchmark],
  );

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
    () => chartBenchmark ? buildBenchmarkPoints(contextualReleases, chartAxis, chartBenchmark) : [],
    [chartBenchmark, contextualReleases, chartAxis],
  );

  const frontier = useMemo(() => computeParetoFrontier(plottedPoints), [plottedPoints]);
  const qualifiedFrontierSet = useMemo(() => getQualifiedFrontierKeys(frontier), [frontier]);

  const selectedPoint = useMemo(
    () => primaryPoint(plottedPoints.filter((p) => p.release.slug === selectedRelease.slug), activeEffort),
    [plottedPoints, selectedRelease.slug, activeEffort],
  );

  const frontierComparison = useMemo(
    () => (selectedPoint ? comparePointToFrontier(selectedPoint, frontier) : null),
    [selectedPoint, frontier],
  );

  // A star for each release on the qualified frontier (>= 75% of the top
  // score) of the field its chart shows when selected, so stars follow
  // At release / Live and the lab filter.
  const frontierStars = useMemo(
    () => chartBenchmark
      ? getContextualFrontierReleases(dataset.releases, chartAxis, contextMode, enabledProvidersSet, chartBenchmark)
      : new Set<string>(),
    [dataset.releases, chartAxis, chartBenchmark, contextMode, enabledProvidersSet],
  );

  const feedScores = useMemo(
    () => new Map(dataset.releases.map((release) => [release.slug, benchmarkScore(release, benchmark)])),
    [dataset.releases, benchmark],
  );
  const globalMaxFeedScore = Math.ceil(Math.max(65, ...Array.from(feedScores.values(), (score) => score ?? 0)) / 5) * 5;
  const budgetText = (value: number) =>
    chartAxis === "tokens"
      ? `${formatTokens(value)} tok`
      : `${formatUsd(value)}/${isGameBench ? "program" : "task"}`;

  // One feed row; both orders list the same rows.
  const renderFeedRow = (rel: ModelRelease) => {
    const isSelected = rel.slug === selectedRelease.slug;
    const score = feedScores.get(rel.slug) ?? null;
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
            {score === null ? "—" : formatScore(score, scoreUnit)}
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
          aria-label="Benchmark comparison"
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
            <select
              className="benchmark-picker"
              aria-label="Benchmark"
              value={benchmark}
              onChange={(event) => {
                setBenchmark(event.currentTarget.value as Benchmark);
                setActiveEffort(null);
              }}
            >
              {BENCHMARKS.filter((option) => option.id !== "game-bench" || gameBenchSource).map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>

            <div className="chart-controls__right">
              {benchmark === "terminal-bench" && (
                <div className="seg-group" role="group" aria-label="Budget axis">
                  <button
                    type="button"
                    aria-pressed={axis === "cost"}
                    className={`seg-btn${axis === "cost" ? " is-active" : ""}`}
                    onClick={() => setAxis("cost")}
                  >
                    Cost
                  </button>
                  <button
                    type="button"
                    aria-pressed={axis === "tokens"}
                    className={`seg-btn${axis === "tokens" ? " is-active" : ""}`}
                    onClick={() => setAxis("tokens")}
                  >
                    Tokens
                  </button>
                </div>
              )}

              <div className="seg-group" role="group" aria-label="Comparison cohort">
                <button
                  type="button"
                  aria-pressed={contextMode === "release"}
                  className={`seg-btn${contextMode === "release" ? " is-active" : ""}`}
                  onClick={() => setContextMode("release")}
                  title="Compare against models available when this release launched"
                >
                  At release
                </button>
                <button
                  type="button"
                  aria-pressed={contextMode === "live"}
                  className={`seg-btn${contextMode === "live" ? " is-active" : ""}`}
                  onClick={() => setContextMode("live")}
                  title="Compare against all active models today"
                >
                  Live
                </button>
              </div>
            </div>
          </div>

          {chartBenchmark ? (
            <ParetoChart
              releases={contextualReleases}
              scale={chartScale}
              selectedRelease={selectedRelease}
              benchmark={chartBenchmark}
              activeEffort={activeEffort}
              axis={chartAxis}
              onSelectRelease={(slug, effort) => handleSelectRelease(slug, false, effort)}
            />
          ) : epochBenchmark && (
            <EpochScoreChart
              benchmark={epochBenchmark}
              releases={contextualReleases}
              selected={selectedRelease}
              onSelect={handleSelectRelease}
            />
          )}

          {chartBenchmark && (
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
                      {isGameBench
                        ? `GameBench 2 has no complete score and cost for ${selectedRelease.name} yet.`
                        : selectedRelease.terminalBench
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
                      <strong className="mono">{budgetText(selectedPoint.budget)}</strong>
                      {qualifiedFrontierSet.has(selectedPoint.key)
                        ? ": no model scores higher for less"
                        : "), below the bar for a star: 75% of the top score"}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="frontier-banner__btn"
                    onClick={() => handleSelectRelease(
                      frontierComparison.dominator.release.slug,
                      false,
                      isGameBench ? frontierComparison.dominator.run.effort : null,
                    )}
                  >
                    <ProviderLogo provider={frontierComparison.dominator.provider} size={14} />
                    <span>
                      Topped by <strong>{frontierComparison.dominator.release.name}</strong>
                      {isGameBench && ` · ${effortName(frontierComparison.dominator.run.effort)}`} ·{" "}
                      <strong className="mono">
                        {formatScore(frontierComparison.dominator.score, scoreUnit)}
                      </strong>{" "}
                      <span className="frontier-banner__delta mono">
                        (+{frontierComparison.scoreDeficit.toFixed(1)})
                      </span>{" "}
                      at{" "}
                      <span className="mono">{budgetText(frontierComparison.dominator.budget)}</span>
                    </span>
                    <span className="frontier-banner__arrow" aria-hidden="true">
                      →
                    </span>
                  </button>
                )}
              </div>

              {isGameBench ? (
                <GameBenchEfforts
                  release={selectedRelease}
                  active={selectedPoint?.run.effort ?? null}
                  frontierKeys={qualifiedFrontierSet}
                  onSelect={setActiveEffort}
                />
              ) : <MeasureTable release={selectedRelease} />}
            </div>
          )}
          {isGameBench && gameBenchSource && (
            <p className="benchmark-note">
              {GAME_BENCH.description}{" "}
              <a href={gameBenchSource.url}>DuelLab results</a> ·{" "}
              <a href={gameBenchSource.licenseUrl}>CC BY 4.0</a>
            </p>
          )}
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
