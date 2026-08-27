"use client";

import {
  createContext,
  useContext,
  useId,
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

type ModelCardFilterState = Readonly<{
  providerId: string;
  topOnly: boolean;
}>;

const ModelCardFilterContext = createContext<ModelCardFilterState>({
  providerId: "",
  topOnly: false,
});

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
  const [providerId, setProviderId] = useState("");
  const [topOnly, setTopOnly] = useState(false);
  const topDefinitionId = useId();
  const selectedProvider = providers.find(provider => provider.id === providerId);
  const visibleCount = selectedProvider === undefined
    ? (topOnly ? topCount : totalCount)
    : (topOnly ? selectedProvider.topCount : selectedProvider.count);
  const style: ModelCardFilterStyle = {
    "--model-card-filter-color": selectedProvider?.color ?? "var(--muted)",
  };

  return (
    <ModelCardFilterContext.Provider value={{ providerId, topOnly }}>
      <section aria-label="Filter model cards" className="model-card-gallery__filter-shell">
        <div className="model-card-gallery__filters" style={style}>
          <label className="model-card-gallery__provider-filter">
            <span>Provider</span>
            <span className="model-card-gallery__select-shell">
              <i aria-hidden="true" />
              <select
                aria-controls={gridId}
                onChange={event => setProviderId(event.currentTarget.value)}
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
            onClick={() => setTopOnly(current => !current)}
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
