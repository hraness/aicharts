"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AiChartsMark,
  ExternalArrowIcon,
  FrontierStarIcon,
  GitHubIcon,
  ProviderLogo,
  ThemeIcon,
} from "./brand-icon";
import { ParetoChart } from "./pareto-chart";
import {
  formatFullDate,
  formatScore,
  formatShortDate,
  formatTokens,
  formatUsd,
} from "@/lib/format";
import {
  buildPlottedPoints,
  comparePointToFrontier,
  computeParetoFrontier,
  getContextualReleases,
  getPointScore,
  getQualifiedFrontierKeys,
} from "@/lib/pareto";
import {
  BENCHMARKS,
  PROVIDERS,
  type BenchmarkId,
  type BudgetAxis,
  type ContextMode,
  type EffortPoint,
  type EffortSlug,
  type ModelRelease,
  type ProviderId,
  type ReleaseDataset,
} from "@/lib/types";

function pickPreferredEffort(release: ModelRelease, benchmark: BenchmarkId = "coding"): EffortSlug {
  let best = release.efforts[release.efforts.length - 1];
  for (const eff of release.efforts) {
    if (!best || eff.scores[benchmark] >= best.scores[benchmark]) {
      best = eff;
    }
  }
  return best?.effortSlug ?? "high";
}

export function ReleaseExplorer({
  dataset,
  initialReleaseSlug,
  initialBenchmark,
  initialAxis,
  initialContext,
}: Readonly<{
  dataset: ReleaseDataset;
  initialReleaseSlug?: string;
  initialBenchmark?: BenchmarkId;
  initialAxis?: BudgetAxis;
  initialContext?: ContextMode;
}>) {
  const chartSectionRef = useRef<HTMLElement>(null);

  const defaultRelease = useMemo(() => {
    if (initialReleaseSlug) {
      const found = dataset.releases.find((r) => r.slug === initialReleaseSlug);
      if (found) return found;
    }
    return dataset.releases[0]!;
  }, [dataset.releases, initialReleaseSlug]);

  const [selectedSlug, setSelectedSlug] = useState<string>(defaultRelease.slug);
  const [benchmarkId, setBenchmarkId] = useState<BenchmarkId>(initialBenchmark ?? "coding");
  const [axis, setAxis] = useState<BudgetAxis>(initialAxis ?? "cost");
  const [contextMode, setContextMode] = useState<ContextMode>(initialContext ?? "release");
  const [providerFilter, setProviderFilter] = useState<ProviderId | "all">("all");
  const [activeEffortSlug, setActiveEffortSlug] = useState<EffortSlug>(() =>
    pickPreferredEffort(defaultRelease, initialBenchmark ?? "coding"),
  );
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
    const metricParam = params.get("metric");
    const validMetric: BenchmarkId =
      metricParam === "coding" ||
      metricParam === "terminalBench4" ||
      metricParam === "frontierCode2" ||
      metricParam === "intelligence"
        ? metricParam
        : "coding";
    setBenchmarkId(validMetric);

    const relParam = params.get("release");
    if (relParam) {
      const found = dataset.releases.find((r) => r.slug === relParam);
      if (found) {
        setSelectedSlug(found.slug);
        setActiveEffortSlug(pickPreferredEffort(found, validMetric));
      }
    }
    const axisParam = params.get("axis");
    if (axisParam === "cost" || axisParam === "tokens") {
      setAxis(axisParam);
    }
    const ctxParam = params.get("ctx");
    if (ctxParam === "release" || ctxParam === "live") {
      setContextMode(ctxParam);
    }
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
    () => dataset.releases.find((r) => r.slug === selectedSlug) ?? dataset.releases[0]!,
    [dataset.releases, selectedSlug],
  );

  const activeEffort: EffortPoint = useMemo(() => {
    const match = selectedRelease.efforts.find((e) => e.effortSlug === activeEffortSlug);
    if (match) return match;
    return selectedRelease.efforts[selectedRelease.efforts.length - 1]!;
  }, [selectedRelease, activeEffortSlug]);

  useEffect(() => {
    if (!urlHydrated || typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (selectedRelease.slug !== dataset.releases[0]?.slug) {
      params.set("release", selectedRelease.slug);
    }
    if (benchmarkId !== "coding") params.set("metric", benchmarkId);
    if (axis !== "cost") params.set("axis", axis);
    if (contextMode !== "release") params.set("ctx", contextMode);
    const qs = params.toString();
    const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [urlHydrated, selectedRelease.slug, benchmarkId, axis, contextMode, dataset.releases]);

  const handleSelectRelease = useCallback(
    (slug: string, scrollIfNeeded = false) => {
      const target = dataset.releases.find((r) => r.slug === slug);
      if (!target) return;
      setSelectedSlug(target.slug);
      setActiveEffortSlug((prev) =>
        target.efforts.some((e) => e.effortSlug === prev)
          ? prev
          : pickPreferredEffort(target, benchmarkId),
      );
      if (scrollIfNeeded && chartSectionRef.current) {
        const rect = chartSectionRef.current.getBoundingClientRect();
        if (rect.top < -36) {
          chartSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    },
    [dataset.releases, benchmarkId],
  );

  const filteredFeedReleases = useMemo(() => {
    if (providerFilter === "all") return dataset.releases;
    return dataset.releases.filter((r) => r.provider === providerFilter);
  }, [dataset.releases, providerFilter]);

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
        const idx = filteredFeedReleases.findIndex((r) => r.slug === selectedRelease.slug);
        if (idx === -1) return;
        const nextIdx =
          e.key === "j"
            ? Math.min(filteredFeedReleases.length - 1, idx + 1)
            : Math.max(0, idx - 1);
        const nextRel = filteredFeedReleases[nextIdx];
        if (nextRel) handleSelectRelease(nextRel.slug, false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filteredFeedReleases, selectedRelease.slug, handleSelectRelease]);

  const benchmark = useMemo(
    () => BENCHMARKS.find((b) => b.id === benchmarkId) ?? BENCHMARKS[0]!,
    [benchmarkId],
  );

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
    () => buildPlottedPoints(contextualReleases, benchmark.id, axis),
    [contextualReleases, benchmark.id, axis],
  );

  const frontier = useMemo(() => computeParetoFrontier(plottedPoints), [plottedPoints]);
  const qualifiedFrontierSet = useMemo(() => getQualifiedFrontierKeys(frontier), [frontier]);

  const activePlottedPoint = useMemo(
    () =>
      plottedPoints.find(
        (p) =>
          p.release.slug === selectedRelease.slug &&
          p.effort.effortSlug === activeEffort.effortSlug,
      ) ?? plottedPoints[0]!,
    [plottedPoints, selectedRelease.slug, activeEffort.effortSlug],
  );

  const frontierComparison = useMemo(
    () => comparePointToFrontier(activePlottedPoint, frontier),
    [activePlottedPoint, frontier],
  );

  // Live qualified Pareto-frontier releases (current active frontier, >= 75% of peak score)
  const liveFrontierReleaseSlugs = useMemo(() => {
    const activeReleases = dataset.releases.filter((r) => !r.deprecated);
    const pts = buildPlottedPoints(activeReleases, benchmark.id, axis);
    const liveFront = computeParetoFrontier(pts);
    const qualified = getQualifiedFrontierKeys(liveFront);
    const slugs = new Set<string>();
    for (const f of liveFront) {
      if (qualified.has(f.key)) {
        slugs.add(f.release.slug);
      }
    }
    return slugs;
  }, [dataset.releases, benchmark.id, axis]);

  const globalMaxFeedScore = useMemo(() => {
    let max = 65;
    for (const r of dataset.releases) {
      for (const e of r.efforts) {
        const s = getPointScore(e, benchmark.id);
        if (s > max) max = s;
      }
    }
    return Math.ceil(max / 5) * 5;
  }, [dataset.releases, benchmark.id]);

  return (
    <div className="shell">
      {/* Minimal Header */}
      <header className="topbar">
        <div className="topbar__brand">
          <AiChartsMark size={23} />
          <span className="topbar__title">aicharts</span>
        </div>

        <div className="topbar__actions">
          <nav className="journal-nav" aria-label="Product pages"><a href="/blog">Blog</a><a href="/changelog">Changelog</a></nav>
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
                  {liveFrontierReleaseSlugs.has(selectedRelease.slug) && (
                    <span className="frontier-badge">
                      <FrontierStarIcon size={9} />
                      <span>Frontier</span>
                    </span>
                  )}
                </div>
                <div className="release-head__meta">
                  <span>{PROVIDERS[selectedRelease.provider].name}</span>
                  <span className="dot-sep">·</span>
                  <time dateTime={selectedRelease.releaseDate}>
                    {formatFullDate(selectedRelease.releaseDate)}
                  </time>
                </div>
              </div>
            </div>

            <a
              href={selectedRelease.announcementUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="source-link"
            >
              <span>Source</span>
              <ExternalArrowIcon size={10} />
            </a>
          </div>

          {/* Chart Controls */}
          <div className="chart-controls">
            <div className="seg-group seg-group--scroll" role="tablist" aria-label="Benchmark">
              {BENCHMARKS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="tab"
                  aria-selected={benchmarkId === b.id}
                  className={`seg-btn${benchmarkId === b.id ? " is-active" : ""}`}
                  onClick={() => setBenchmarkId(b.id)}
                  title={b.description}
                >
                  <span className="seg-btn__full">{b.label}</span>
                  <span className="seg-btn__short">{b.shortLabel}</span>
                </button>
              ))}
            </div>

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
            selectedRelease={selectedRelease}
            activeEffortSlug={activeEffort.effortSlug}
            benchmark={benchmark}
            axis={axis}
            onSelectEffort={setActiveEffortSlug}
            onSelectRelease={(slug) => handleSelectRelease(slug, false)}
          />

          {/* Clean Effort Breakdown & Frontier Verdict */}
          <div className="inspector">
            <div
              className={`frontier-banner${
                qualifiedFrontierSet.has(activePlottedPoint.key) ? " frontier-banner--optimal" : ""
              }`}
            >
              {frontierComparison.onFrontier ? (
                <div className="frontier-banner__line">
                  {qualifiedFrontierSet.has(activePlottedPoint.key) ? (
                    <span className="frontier-banner__star">
                      <FrontierStarIcon size={11} />
                    </span>
                  ) : (
                    <span className="effort-dot is-active" aria-hidden="true" />
                  )}
                  <span>
                    {qualifiedFrontierSet.has(activePlottedPoint.key) ? (
                      <>
                        <strong>{activeEffort.effortLabel}</strong> leads the{" "}
                        {contextMode === "release" ? "release-day" : "live"} Pareto frontier at{" "}
                      </>
                    ) : (
                      <>
                        <strong>{activeEffort.effortLabel}</strong> is undominated at low budget (
                      </>
                    )}
                    <strong className="mono">
                      {axis === "cost"
                        ? `${formatUsd(activeEffort.costUsdPerTask.total)}/task`
                        : `${formatTokens(activeEffort.tokensPerTask.total)} tok`}
                    </strong>
                    {!qualifiedFrontierSet.has(activePlottedPoint.key) && ")"}
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
                    Topped by{" "}
                    <strong>
                      {frontierComparison.dominator.release.name} (
                      {frontierComparison.dominator.effort.effortLabel})
                    </strong>{" "}
                    ·{" "}
                    <strong className="mono">
                      {formatScore(frontierComparison.dominator.score, benchmark.unit)}
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

            <div className="effort-table" role="listbox" aria-label="Effort levels">
              <div className="effort-table__head" aria-hidden="true">
                <span>Effort</span>
                <span className="align-right">{benchmark.shortLabel}</span>
                <span className="align-right">Cost / task</span>
                <span className="align-right">Tokens</span>
              </div>

              {selectedRelease.efforts.map((eff) => {
                const isAct = eff.effortSlug === activeEffort.effortSlug;
                const ptKey = `${selectedRelease.slug}:${eff.effortSlug}`;
                const isQualFrontier = qualifiedFrontierSet.has(ptKey);
                return (
                  <button
                    key={eff.effortSlug}
                    type="button"
                    role="option"
                    aria-selected={isAct}
                    className={`effort-row${isAct ? " is-active" : ""}`}
                    onClick={() => setActiveEffortSlug(eff.effortSlug)}
                  >
                    <span className="effort-row__name">
                      <span className={`effort-dot${isAct ? " is-active" : ""}`} />
                      <span className="effort-row__label">{eff.effortLabel}</span>
                      {isQualFrontier && (
                        <span className="effort-row__star" title="On Pareto frontier">
                          <FrontierStarIcon size={9} />
                        </span>
                      )}
                    </span>
                    <span className="effort-row__score mono align-right">
                      {formatScore(eff.scores[benchmark.id], benchmark.unit)}
                    </span>
                    <span className="effort-row__cell mono align-right">
                      {formatUsd(eff.costUsdPerTask.total)}
                    </span>
                    <span className="effort-row__cell mono align-right">
                      {formatTokens(eff.tokensPerTask.total)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Chronological Release Feed */}
        <section className="feed-section" aria-label="Coding model releases">
          <div className="feed-header">
            <div className="feed-header__left">
              <h2 className="feed-header__title">Releases</h2>
              <span className="feed-header__count mono">{filteredFeedReleases.length}</span>
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

          <div className="feed-list" role="listbox" aria-label="Model release feed">
            {filteredFeedReleases.map((rel) => {
              const isSelected = rel.slug === selectedRelease.slug;
              const bestScore = Math.max(
                ...rel.efforts.map((e) => getPointScore(e, benchmark.id)),
              );
              const isLiveFrontier = liveFrontierReleaseSlugs.has(rel.slug);
              const barPct = Math.max(
                2,
                Math.min(100, (bestScore / globalMaxFeedScore) * 100),
              );

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
                    {isLiveFrontier && (
                      <span
                        className="frontier-badge frontier-badge--sm"
                        title="On the live Pareto frontier"
                      >
                        <FrontierStarIcon size={8} />
                        <span>Frontier</span>
                      </span>
                    )}
                  </span>

                  <span className="feed-row__right">
                    <span className="score-track" aria-hidden="true">
                      <span
                        className={`score-fill score-fill--${rel.provider}`}
                        style={{ width: `${barPct}%` }}
                      />
                    </span>
                    <strong className="feed-row__score mono">
                      {formatScore(bestScore, benchmark.unit)}
                    </strong>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>
          Normalized from{" "}
          <a href="https://artificialanalysis.ai/models" target="_blank" rel="noopener noreferrer">
            Artificial Analysis v5.0
          </a>{" "}
          &{" "}
          <a href="https://tbench.ai" target="_blank" rel="noopener noreferrer">
            Terminal-Bench
          </a>{" "}
          · Updated {dataset.snapshotDate}
        </span>
        <span className="footer__links">
          <a href="/api/releases">API</a>
          <span>·</span>
          <a
            href="https://github.com/hraness/aicharts"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </span>
      </footer>
    </div>
  );
}
