"use client";

import { useSearchParams } from "next/navigation";
import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export type ModelCardProviderFilter = Readonly<{
  color: string;
  count: number;
  id: string;
  name: string;
  topCount: number;
}>;

type ModelCardFilterStyle = CSSProperties & Readonly<{
  "--model-card-filter-color": string;
}>;

export type ModelCardFilterState = Readonly<{
  providerId: string;
  topOnly: boolean;
}>;

const DEFAULT_MODEL_CARD_FILTER: ModelCardFilterState = {
  providerId: "",
  topOnly: false,
};

const ModelCardFilterContext = createContext<ModelCardFilterState>(DEFAULT_MODEL_CARD_FILTER);

export function modelCardFilterFromSearch(
  search: string,
  providerIds: readonly string[],
): ModelCardFilterState {
  const parameters = new URLSearchParams(search);
  const providerValues = [...new Set(parameters.getAll("provider"))];
  const topValues = [...new Set(parameters.getAll("top"))];
  const requestedProvider = providerValues.length === 1 ? providerValues[0] ?? "" : "";
  return {
    providerId: providerIds.includes(requestedProvider) ? requestedProvider : "",
    topOnly: topValues.length === 1 && topValues[0] === "1",
  };
}

export function modelCardFilterSearch(
  currentSearch: string,
  filter: ModelCardFilterState,
): string {
  const parameters = new URLSearchParams(currentSearch);
  parameters.delete("provider");
  parameters.delete("top");
  if (filter.providerId !== "") parameters.append("provider", filter.providerId);
  if (filter.topOnly) parameters.append("top", "1");
  return parameters.toString();
}

function ModelCardFilterURLSync({
  onChange,
  providerIds,
}: Readonly<{
  onChange: (filter: ModelCardFilterState) => void;
  providerIds: readonly string[];
}>) {
  const searchParameters = useSearchParams();
  const search = searchParameters?.toString() ?? "";

  useEffect(() => {
    const filter = modelCardFilterFromSearch(search, providerIds);
    onChange(filter);

    const canonicalSearch = modelCardFilterSearch(search, filter);
    if (canonicalSearch !== search) {
      const nextURL = `${window.location.pathname}${canonicalSearch === "" ? "" : `?${canonicalSearch}`}${window.location.hash}`;
      window.history.replaceState(null, "", nextURL);
    }
  }, [onChange, providerIds, search]);

  return null;
}

export function modelCardMatchesFilter(
  card: Readonly<{ isTop: boolean; providerId: string }>,
  providerId: string,
  topOnly: boolean,
): boolean {
  return (providerId === "" || card.providerId === providerId)
    && (!topOnly || card.isTop);
}

export function ModelCardGalleryFilters({
  children,
  gridId,
  providers,
  topCount,
  totalCount,
}: Readonly<{
  children: ReactNode;
  gridId: string;
  providers: readonly ModelCardProviderFilter[];
  topCount: number;
  totalCount: number;
}>) {
  const [filter, setFilter] = useState<ModelCardFilterState>(DEFAULT_MODEL_CARD_FILTER);
  const providerIds = useMemo(() => providers.map(provider => provider.id), [providers]);
  const topDefinitionId = useId();
  const { providerId, topOnly } = filter;
  const selectedProvider = providers.find(provider => provider.id === providerId);
  const visibleCount = selectedProvider === undefined
    ? (topOnly ? topCount : totalCount)
    : (topOnly ? selectedProvider.topCount : selectedProvider.count);
  const style: ModelCardFilterStyle = {
    "--model-card-filter-color": selectedProvider?.color ?? "var(--muted)",
  };
  const syncFilterFromURL = useCallback((nextFilter: ModelCardFilterState) => {
    setFilter(current => (
      current.providerId === nextFilter.providerId && current.topOnly === nextFilter.topOnly
        ? current
        : nextFilter
    ));
  }, []);

  function pushFilterToURL(nextFilter: ModelCardFilterState) {
    setFilter(nextFilter);
    const search = modelCardFilterSearch(window.location.search, nextFilter);
    const nextURL = `${window.location.pathname}${search === "" ? "" : `?${search}`}${window.location.hash}`;
    const currentURL = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextURL !== currentURL) window.history.pushState(null, "", nextURL);
  }

  return (
    <ModelCardFilterContext.Provider value={{ providerId, topOnly }}>
      <section aria-label="Filter model cards" className="model-card-gallery__filter-shell">
        <Suspense fallback={null}>
          <ModelCardFilterURLSync onChange={syncFilterFromURL} providerIds={providerIds} />
        </Suspense>
        <div className="model-card-gallery__filters" style={style}>
          <label className="model-card-gallery__provider-filter">
            <span>Provider</span>
            <span className="model-card-gallery__select-shell">
              <i aria-hidden="true" />
              <select
                aria-controls={gridId}
                onChange={event => pushFilterToURL({
                  providerId: event.currentTarget.value,
                  topOnly,
                })}
                value={providerId}
              >
                <option value="">All providers · {totalCount}</option>
                {providers.map(provider => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name} · {provider.count}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <button
            aria-controls={gridId}
            aria-describedby={topDefinitionId}
            aria-label="Show only cost and AA Index Pareto-frontier cards"
            aria-pressed={topOnly}
            className="model-card-gallery__top-filter"
            data-selected={topOnly || undefined}
            onClick={() => pushFilterToURL({ providerId, topOnly: !topOnly })}
            type="button"
          >
            <i aria-hidden="true" />
            <span>
              <strong>Top</strong>
              <small>{topCount} {topCount === 1 ? "card" : "cards"} · Cost ↓ · AA Index ↑</small>
            </span>
          </button>
          <span className="model-card-gallery__top-definition" id={topDefinitionId}>
            Top keeps profiles with an observed configuration for which no other configuration is at least as strong and no more expensive, with an advantage on one axis.
          </span>
          <output aria-live="polite" className="model-card-gallery__filter-count">
            {visibleCount} of {totalCount} cards
          </output>
        </div>
        {children}
        <p className="model-card-gallery__empty" hidden={visibleCount !== 0}>
          No cards match both filters. Try another provider or turn off Top.
        </p>
      </section>
    </ModelCardFilterContext.Provider>
  );
}

export function ModelCardGalleryFilterItem({
  children,
  isTop,
  providerId,
}: Readonly<{
  children: ReactNode;
  isTop: boolean;
  providerId: string;
}>) {
  const filter = useContext(ModelCardFilterContext);
  return modelCardMatchesFilter({ isTop, providerId }, filter.providerId, filter.topOnly)
    ? children
    : null;
}
