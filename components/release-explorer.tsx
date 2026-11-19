"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AiChartsMark,
  ExternalArrowIcon,
  GitHubIcon,
  ProviderBadge,
  ProviderLogo,
  ThemeIcon,
} from "./brand-icon";
import { ParetoChart } from "./pareto-chart";
import {
  formatFullDate,
  formatPricePair,
  formatScore,
  formatShortDate,
  formatTokens,
  formatUsd,
  shortModelName,
} from "@/lib/format";
import {
  buildPlottedPoints,
  comparePointToFrontier,
  computeParetoFrontier,
  getContextualReleases,
  getPointScore,
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

function pickPreferredEffort(release: ModelRelease): EffortSlug {
  let best = release.efforts[release.efforts.length - 1];
  for (const eff of release.efforts) {
    if (!best || eff.scores.coding >= best.scores.coding) {
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
    pickPreferredEffort(defaultRelease),
  );
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [urlHydrated, setUrlHydrated] = useState(false);

  // Hydrate saved theme preference and optional deep-link query params
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
      if (found) {
        setSelectedSlug(found.slug);
        setActiveEffortSlug(pickPreferredEffort(found));
      }
    }
    const metricParam = params.get("metric");
    if (
      metricParam === "coding" ||
      metricParam === "terminalBench4" ||
      metricParam === "frontierCode2" ||
      metricParam === "intelligence"
    ) {
      setBenchmarkId(metricParam);
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

  // Ensure activeEffortSlug belongs to selectedRelease
  const activeEffort: EffortPoint = useMemo(() => {
    const match = selectedRelease.efforts.find((e) => e.effortSlug === activeEffortSlug);
    if (match) return match;
    return selectedRelease.efforts[selectedRelease.efforts.length - 1]!;
  }, [selectedRelease, activeEffortSlug]);

  // Sync shallow URL state for easy sharing
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
      // Preserve effort slug if available on target, otherwise pick highest effort
      setActiveEffortSlug((prev) =>
        target.efforts.some((e) => e.effortSlug === prev) ? prev : pickPreferredEffort(target),
      );
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

  // Keyboard j/k or Up/Down navigation across visible feed releases
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
  const frontierKeySet = useMemo(() => new Set(frontier.map((p) => p.key)), [frontier]);

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

  const selectedFrontierCount = useMemo(
    () =>
      selectedRelease.efforts.filter((e) =>
        frontierKeySet.has(`${selectedRelease.slug}:${e.effortSlug}`),
      ).length,
    [selectedRelease, frontierKeySet],
  );

  // Precompute which releases had at least 1 Pareto-optimal effort on their launch day for the active benchmark/axis
  const launchFrontierSlugs = useMemo(() => {
    const slugs = new Set<string>();
    for (const rel of dataset.releases) {
      const peersAtLaunch = getContextualReleases(dataset.releases, rel, "release");
      const pts = buildPlottedPoints(peersAtLaunch, benchmark.id, axis);
      const front = computeParetoFrontier(pts);
      if (front.some((f) => f.release.slug === rel.slug)) {
        slugs.add(rel.slug);
      }
    }
    return slugs;
  }, [dataset.releases, benchmark.id, axis]);

  // Global max score for feed mini-bars so every row shares a consistent horizontal scale
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

  // Best CLI harness eval on selected release (active effort first, fallback to highest effort with cliEval)
  const displayCliEval = useMemo(() => {
    if (activeEffort.cliEval) return { eval: activeEffort.cliEval, effort: activeEffort.effortLabel };
    const withCli = [...selectedRelease.efforts].reverse().find((e) => e.cliEval !== null);
    return withCli?.cliEval ? { eval: withCli.cliEval, effort: withCli.effortLabel } : null;
  }, [activeEffort, selectedRelease.efforts]);

  return (
    <div className="shell">
      {/* Minimal Single-Line Header */}
      <header className="topbar">
        <div className="topbar__brand">
          <AiChartsMark size={17} />
          <span className="topbar__title">aicharts</span>
          <span className="topbar__tag">coding pareto</span>
        </div>

        <div className="topbar__actions">
          <div className="brand-legend" aria-label="Tracked labs">
            {(["anthropic", "openai", "google"] as const).map((pid) => (
              <span key={pid} className={`legend-item legend-item--${pid}`}>
                <ProviderLogo provider={pid} size={11} />
                <span className="legend-item__label">{PROVIDERS[pid].shortName}</span>
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
          {/* Release Header Strip */}
          <div className="release-head">
            <div className="release-head__identity">
              <ProviderBadge provider={selectedRelease.provider} size="md" />
              <div className="release-head__titles">
                <div className="release-head__title-row">
                  <h1 className="release-head__name">{selectedRelease.name}</h1>
                  {selectedFrontierCount > 0 && (
                    <span className="status-pill status-pill--frontier">
                      {selectedFrontierCount === 1
                        ? "1 frontier effort"
                        : `${selectedFrontierCount} frontier efforts`}
                    </span>
                  )}
                  {selectedRelease.deprecated && (
                    <span className="status-pill status-pill--muted">Superseded</span>
                  )}
                </div>
                <div className="release-head__meta">
                  <span>{PROVIDERS[selectedRelease.provider].name}</span>
                  <span className="dot-sep">·</span>
                  <time dateTime={selectedRelease.releaseDate}>
                    {formatFullDate(selectedRelease.releaseDate)}
                  </time>
                  <span className="dot-sep">·</span>
                  <span className="mono">
                    {formatPricePair(
                      selectedRelease.pricing.inputPer1M,
                      selectedRelease.pricing.outputPer1M,
                    )}
                    /M
                  </span>
                </div>
              </div>
            </div>

            <a
              href={selectedRelease.announcementUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="source-link"
            >
              <span>Release</span>
              <ExternalArrowIcon size={10} />
            </a>
          </div>

          {/* Compact Chart Controls */}
          <div className="chart-controls">
            <div className="seg-group" role="tablist" aria-label="Benchmark">
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
                  $ / task
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
                  title="Compare against models available on this release's launch date"
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

          {/* Compact Effort Selector & Key Details Inspector */}
          <div className="inspector">
            <div className="effort-bar" role="tablist" aria-label="Effort levels">
              <span className="effort-bar__label">Effort</span>
              <div className="effort-pills">
                {selectedRelease.efforts.map((eff) => {
                  const isAct = eff.effortSlug === activeEffort.effortSlug;
                  const onFront = frontierKeySet.has(
                    `${selectedRelease.slug}:${eff.effortSlug}`,
                  );
                  return (
                    <button
                      key={eff.effortSlug}
                      type="button"
                      role="tab"
                      aria-selected={isAct}
                      className={`effort-pill${isAct ? " is-active" : ""}${onFront ? " is-frontier" : ""}`}
                      onClick={() => setActiveEffortSlug(eff.effortSlug)}
                    >
                      <span>{eff.effortLabel}</span>
                      <span className="effort-pill__sub mono">
                        {axis === "cost"
                          ? formatUsd(eff.costUsdPerTask.total)
                          : formatTokens(eff.tokensPerTask.total)}
                      </span>
                      {onFront && <span className="frontier-pip" title="On Pareto frontier" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="metrics-grid">
              <div className="metric-cell">
                <span className="metric-cell__label">{benchmark.label}</span>
                <span className="metric-cell__value mono">
                  {formatScore(activeEffort.scores[benchmark.id], benchmark.unit)}
                </span>
                <span className="metric-cell__sub mono">
                  TB {activeEffort.scores.terminalBench4.toFixed(1)}% · FC{" "}
                  {activeEffort.scores.frontierCode2.toFixed(1)}% · AAI{" "}
                  {activeEffort.scores.intelligence.toFixed(1)}
                </span>
              </div>

              <div className="metric-cell">
                <span className="metric-cell__label">Cost / task</span>
                <span className="metric-cell__value mono">
                  {formatUsd(activeEffort.costUsdPerTask.total)}
                </span>
                <span className="metric-cell__sub mono">
                  in {formatUsd(activeEffort.costUsdPerTask.input)} · out{" "}
                  {formatUsd(activeEffort.costUsdPerTask.output)}
                </span>
              </div>

              <div className="metric-cell">
                <span className="metric-cell__label">Output tokens</span>
                <span className="metric-cell__value mono">
                  {formatTokens(activeEffort.tokensPerTask.total)}
                </span>
                <span className="metric-cell__sub mono">
                  {formatTokens(activeEffort.tokensPerTask.reasoning)} think
                  {activeEffort.speedTokPerSec !== null
                    ? ` · ${Math.round(activeEffort.speedTokPerSec)} tok/s`
                    : ""}
                </span>
              </div>

              <div className="metric-cell metric-cell--context">
                <span className="metric-cell__label">
                  {contextMode === "release" ? "Frontier at release" : "Live frontier"}
                </span>
                {frontierComparison.onFrontier ? (
                  <>
                    <span className="metric-cell__value metric-cell__value--positive">
                      Pareto-optimal
                    </span>
                    <span className="metric-cell__sub">
                      {frontierComparison.previousStep &&
                      frontierComparison.scoreGainOverPrevious !== null
                        ? `+${frontierComparison.scoreGainOverPrevious.toFixed(1)} over ${shortModelName(frontierComparison.previousStep.release.name)} (${frontierComparison.previousStep.effort.effortLabel})`
                        : "Lowest-budget point on the frontier"}
                    </span>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="dominator-link"
                      onClick={() =>
                        handleSelectRelease(frontierComparison.dominator.release.slug, false)
                      }
                    >
                      −{frontierComparison.scoreDeficit.toFixed(1)} vs{" "}
                      {shortModelName(frontierComparison.dominator.release.name)} (
                      {frontierComparison.dominator.effort.effortLabel}) →
                    </button>
                    <span className="metric-cell__sub mono">
                      Scores{" "}
                      {formatScore(frontierComparison.dominator.score, benchmark.unit)} at{" "}
                      {axis === "cost"
                        ? formatUsd(frontierComparison.dominator.budget)
                        : `${formatTokens(frontierComparison.dominator.budget)} tok`}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="inspector-foot">
              <p className="inspector-foot__summary">{selectedRelease.summary}</p>
              <div className="inspector-foot__badges">
                {displayCliEval && (
                  <span className="harness-chip mono" title="Artificial Analysis Coding Agents">
                    {displayCliEval.eval.harness} ({displayCliEval.effort}):{" "}
                    {displayCliEval.eval.codingAgentScore.toFixed(1)}% ·{" "}
                    {formatUsd(displayCliEval.eval.costUsdPerTask)}
                  </span>
                )}
                {selectedRelease.harborEval && (
                  <span
                    className="harness-chip mono"
                    title="Official 330-trial Harbor Terminal-Bench submission"
                  >
                    Harbor TB ({selectedRelease.harborEval.agent}):{" "}
                    {selectedRelease.harborEval.accuracy.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Chronological Release Feed */}
        <section className="feed-section" aria-label="Coding model releases">
          <div className="feed-header">
            <div className="feed-header__left">
              <h2 className="feed-header__title">Releases</h2>
              <span className="feed-header__count mono">{filteredFeedReleases.length}</span>
              <span className="feed-header__hint">j / k to step</span>
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
                  <ProviderLogo provider={pid} size={11} />
                  <span>{PROVIDERS[pid].shortName}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="feed-list" role="listbox" aria-label="Model release feed">
            {filteredFeedReleases.map((rel, index) => {
              const isSelected = rel.slug === selectedRelease.slug;
              const scores = rel.efforts.map((e) => getPointScore(e, benchmark.id));
              const minScore = Math.min(...scores);
              const maxScore = Math.max(...scores);
              const minCost = rel.efforts[0]!.costUsdPerTask.total;
              const maxCost = rel.efforts[rel.efforts.length - 1]!.costUsdPerTask.total;
              const minTokens = rel.efforts[0]!.tokensPerTask.total;
              const maxTokens = rel.efforts[rel.efforts.length - 1]!.tokensPerTask.total;
              const wasFrontierAtLaunch = launchFrontierSlugs.has(rel.slug);

              const leftPct = Math.max(0, Math.min(100, (minScore / globalMaxFeedScore) * 100));
              const rightPct = Math.max(
                leftPct + 1.5,
                Math.min(100, (maxScore / globalMaxFeedScore) * 100),
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
                    <ProviderBadge provider={rel.provider} size="sm" />
                    <span className="feed-row__text">
                      <span className="feed-row__name-line">
                        <span className="feed-row__name">{rel.name}</span>
                        {index === 0 && providerFilter === "all" && (
                          <span className="micro-badge micro-badge--latest">Latest</span>
                        )}
                        {wasFrontierAtLaunch && (
                          <span
                            className="micro-badge micro-badge--frontier"
                            title="Shifted the Pareto frontier at launch"
                          >
                            Frontier
                          </span>
                        )}
                      </span>
                      <span className="feed-row__sub mono">
                        {rel.efforts.length === 1
                          ? rel.efforts[0]!.effortLabel
                          : `${rel.efforts.length} efforts (${rel.efforts[0]!.shortTag}→${rel.efforts[rel.efforts.length - 1]!.shortTag})`}{" "}
                        · {formatPricePair(rel.pricing.inputPer1M, rel.pricing.outputPer1M)}/M
                      </span>
                    </span>
                  </span>

                  <span className="feed-row__right">
                    <span className="range-track" aria-hidden="true">
                      <span
                        className={`range-bar range-bar--${rel.provider}`}
                        style={{
                          left: `${leftPct}%`,
                          width: `${Math.max(2, rightPct - leftPct)}%`,
                        }}
                      />
                      {rel.efforts.map((e) => {
                        const pct = Math.max(
                          0,
                          Math.min(100, (getPointScore(e, benchmark.id) / globalMaxFeedScore) * 100),
                        );
                        return (
                          <span
                            key={e.effortSlug}
                            className={`range-dot range-dot--${rel.provider}`}
                            style={{ left: `${pct}%` }}
                          />
                        );
                      })}
                    </span>

                    <span className="feed-row__numbers mono">
                      <strong className="feed-row__peak">
                        {rel.efforts.length > 1
                          ? `${minScore.toFixed(0)}–${formatScore(maxScore, benchmark.unit)}`
                          : formatScore(maxScore, benchmark.unit)}
                      </strong>
                      <span className="feed-row__cost">
                        {axis === "cost"
                          ? rel.efforts.length > 1
                            ? `${formatUsd(minCost)}–${formatUsd(maxCost)}`
                            : formatUsd(maxCost)
                          : rel.efforts.length > 1
                            ? `${formatTokens(minTokens)}–${formatTokens(maxTokens)}`
                            : formatTokens(maxTokens)}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </main>

      {/* Ultra-Minimal Footer */}
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
          · Snapshot {dataset.snapshotDate}
        </span>
        <span className="footer__links">
          <a href="/api/releases">API</a>
          <span>·</span>
          <a
            href="https://github.com/hraness/aicharts"
            target="_blank"
            rel="noopener noreferrer"
          >
            MIT Source
          </a>
        </span>
      </footer>
    </div>
  );
}
