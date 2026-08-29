"use client";

import { FoilCardDeck } from "@hraness/design-kit/react";
import { NativeSelectField, type NativeSelectOption } from "@hraness/ui";
import { useSearchParams } from "next/navigation";
import {
  Children,
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
  sort: "" | "new";
  topOnly: boolean;
}>;

const DEFAULT_MODEL_CARD_FILTER: ModelCardFilterState = {
  providerId: "",
  sort: "",
  topOnly: false,
};

const ModelCardFilterContext = createContext<ModelCardFilterState>(DEFAULT_MODEL_CARD_FILTER);

export function modelCardFilterFromSearch(
  search: string,
  providerIds: readonly string[],
): ModelCardFilterState {
  const parameters = new URLSearchParams(search);
  const providerValues = [...new Set(parameters.getAll("provider"))];
  const sortValues = [...new Set(parameters.getAll("sort"))];
  const topValues = [...new Set(parameters.getAll("top"))];
  const requestedProvider = providerValues.length === 1 ? providerValues[0] ?? "" : "";
  return {
    providerId: providerIds.includes(requestedProvider) ? requestedProvider : "",
    sort: sortValues.length === 1 && sortValues[0] === "new" ? "new" : "",
    topOnly: topValues.length === 1 && topValues[0] === "1",
  };
}

export function modelCardFilterSearch(
  currentSearch: string,
  filter: ModelCardFilterState,
): string {
  const parameters = new URLSearchParams(currentSearch);
  parameters.delete("provider");
  parameters.delete("sort");
  parameters.delete("top");
  if (filter.providerId !== "") parameters.append("provider", filter.providerId);
  if (filter.sort === "new") parameters.append("sort", "new");
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

export type ModelCardGalleryItemMetadata = Readonly<{
  isTop: boolean;
  providerId: string;
  releasedOn: string | null;
}>;

function releaseDateMilliseconds(value: string | null): number | null {
  if (value === null) return null;
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

/** Returns actual DOM order so visual, reading, and keyboard order stay aligned. */
export function modelCardGalleryItemOrder(
  items: readonly ModelCardGalleryItemMetadata[],
  filter: ModelCardFilterState,
): readonly number[] {
  const visible = items
    .map((item, index) => ({ index, item }))
    .filter(({ item }) => modelCardMatchesFilter(
      item,
      filter.providerId,
      filter.topOnly,
    ));

  if (filter.sort === "new") {
    visible.sort((left, right) => {
      const leftTime = releaseDateMilliseconds(left.item.releasedOn);
      const rightTime = releaseDateMilliseconds(right.item.releasedOn);
      if (leftTime === null && rightTime !== null) return 1;
      if (leftTime !== null && rightTime === null) return -1;
      if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return left.index - right.index;
    });
  }

  return visible.map(({ index }) => index);
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
  const providerOptions = useMemo<readonly NativeSelectOption<string>[]>(() => [
    { id: "", label: `All providers · ${totalCount}` },
    ...providers.map(provider => ({
      id: provider.id,
      label: `${provider.name} · ${provider.count}`,
    })),
  ], [providers, totalCount]);
  const newDefinitionId = useId();
  const topDefinitionId = useId();
  const { providerId, sort, topOnly } = filter;
  const selectedProvider = providers.find(provider => provider.id === providerId);
  const visibleCount = selectedProvider === undefined
    ? (topOnly ? topCount : totalCount)
    : (topOnly ? selectedProvider.topCount : selectedProvider.count);
  const resultStatus = visibleCount === 0
    ? "No model cards match the selected filters."
    : [
        `Showing ${visibleCount} ${visibleCount === 1 ? "model card" : "model cards"}`,
        selectedProvider === undefined ? "" : ` from ${selectedProvider.name}`,
        topOnly ? " on the cost and AA Index Pareto frontier" : "",
        sort === "new" ? ", sorted by official release date." : ".",
      ].join("");
  const style: ModelCardFilterStyle = {
    "--model-card-filter-color": selectedProvider?.color ?? "var(--muted)",
  };
  const syncFilterFromURL = useCallback((nextFilter: ModelCardFilterState) => {
    setFilter(current => (
      current.providerId === nextFilter.providerId
        && current.sort === nextFilter.sort
        && current.topOnly === nextFilter.topOnly
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
    <ModelCardFilterContext.Provider value={{ providerId, sort, topOnly }}>
      <section aria-label="Filter model cards" className="model-card-gallery__filter-shell">
        <Suspense fallback={null}>
          <ModelCardFilterURLSync onChange={syncFilterFromURL} providerIds={providerIds} />
        </Suspense>
        <div className="model-card-gallery__filters" style={style}>
          <NativeSelectField
            aria-controls={gridId}
            className="model-card-gallery__provider-filter"
            label="Provider"
            onChange={nextProviderId => pushFilterToURL({
              providerId: nextProviderId,
              sort,
              topOnly,
            })}
            options={providerOptions}
            showLabel={false}
            value={providerId}
          />
          <button
            aria-controls={gridId}
            aria-describedby={topDefinitionId}
            aria-label="Show only cost and AA Index Pareto-frontier cards"
            aria-pressed={topOnly}
            className="model-card-gallery__scope-filter"
            data-filter="top"
            data-selected={topOnly || undefined}
            onClick={() => pushFilterToURL({ providerId, sort, topOnly: !topOnly })}
            type="button"
          >
            <i aria-hidden="true" />
            <span>
              <strong>Top</strong>
              <small>{topCount} {topCount === 1 ? "card" : "cards"} · Cost ↓ · AAI ↑</small>
            </span>
          </button>
          <button
            aria-controls={gridId}
            aria-describedby={newDefinitionId}
            aria-label="Sort model cards by official release date"
            aria-pressed={sort === "new"}
            className="model-card-gallery__scope-filter"
            data-filter="new"
            data-selected={sort === "new" || undefined}
            onClick={() => pushFilterToURL({
              providerId,
              sort: sort === "new" ? "" : "new",
              topOnly,
            })}
            type="button"
          >
            <i aria-hidden="true" />
            <span>
              <strong>New</strong>
              <small>Newest releases first</small>
            </span>
          </button>
          <span className="model-card-gallery__filter-definition" id={topDefinitionId}>
            Top keeps profiles with an observed configuration for which no other configuration is at least as strong and no more expensive, with an advantage on one axis.
          </span>
          <span className="model-card-gallery__filter-definition" id={newDefinitionId}>
            New sorts benchmark cards by checked first-party release date. Models whose official date is still being verified follow dated releases in stable catalog order.
          </span>
          <p
            aria-atomic="true"
            aria-live="polite"
            className="model-card-gallery__filter-definition"
          >
            {resultStatus}
          </p>
        </div>
        {children}
        <p className="model-card-gallery__empty" hidden={visibleCount !== 0}>
          No cards match these filters. Try another provider or turn off Top.
        </p>
      </section>
    </ModelCardFilterContext.Provider>
  );
}

export function ModelCardGalleryItems({
  children,
  className,
  id,
  items,
}: Readonly<{
  children: ReactNode;
  className?: string;
  id: string;
  items: readonly ModelCardGalleryItemMetadata[];
}>) {
  const filter = useContext(ModelCardFilterContext);
  const nodes = Children.toArray(children);
  if (nodes.length !== items.length) {
    throw new Error("Model-card gallery metadata must align with its card children.");
  }
  const visibleNodes = modelCardGalleryItemOrder(items, filter).map(index => {
    const node = nodes[index];
    if (node === undefined) throw new Error("Model-card gallery order escaped its card children.");
    return node;
  });
  return <FoilCardDeck className={className} id={id}>{visibleNodes}</FoilCardDeck>;
}
