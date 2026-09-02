import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ModelCardGalleryFilters,
  ModelCardGalleryItems,
  modelCardFilterFromSearch,
  modelCardFilterResultCount,
  modelCardFilterSearch,
  modelCardGalleryItemOrder,
  modelCardMatchesFilter,
  type ModelCardProviderFilter,
} from "./model-card-gallery-filters";

const providers: readonly ModelCardProviderFilter[] = [
  { color: "#45a3ff", count: 2, id: "one", name: "One", topCount: 1 },
  { color: "#f08a6c", count: 1, id: "two", name: "Two", topCount: 0 },
];

describe("model-card gallery filters", () => {
  test("parses only canonical provider, Top, and New-sort query values", () => {
    const providerIds = providers.map(provider => provider.id);

    expect(modelCardFilterFromSearch("?provider=one&sort=new&top=1", providerIds)).toEqual({
      providerId: "one",
      sort: "new",
      topOnly: true,
    });
    expect(modelCardFilterFromSearch("?provider=unknown&sort=old&top=true", providerIds)).toEqual({
      providerId: "",
      sort: "",
      topOnly: false,
    });
    expect(modelCardFilterFromSearch("?provider=two&provider=one&sort=new&sort=old&top=0&top=1", providerIds)).toEqual({
      providerId: "",
      sort: "",
      topOnly: false,
    });
    expect(modelCardFilterFromSearch("?provider=two&provider=two&sort=new&sort=new&top=1&top=1", providerIds)).toEqual({
      providerId: "two",
      sort: "new",
      topOnly: true,
    });
  });

  test("writes stable filter permalinks while preserving unrelated parameters", () => {
    expect(modelCardFilterSearch("?campaign=folio&provider=old&sort=old&top=0", {
      providerId: "one",
      sort: "new",
      topOnly: true,
    })).toBe("campaign=folio&provider=one&sort=new&top=1");
    expect(modelCardFilterSearch("?provider=one&provider=two&sort=new&top=1", {
      providerId: "",
      sort: "",
      topOnly: false,
    })).toBe("");
    expect(modelCardFilterSearch("", {
      providerId: "two",
      sort: "",
      topOnly: false,
    })).toBe("provider=two");

    for (const providerId of ["", ...providers.map(provider => provider.id)]) {
      for (const topOnly of [false, true]) {
        for (const sort of ["", "new"] as const) {
          const filter = { providerId, sort, topOnly };
          expect(modelCardFilterFromSearch(
            modelCardFilterSearch("?campaign=folio", filter),
            providers.map(provider => provider.id),
          )).toEqual(filter);
        }
      }
    }
  });

  test("combines provider and Top as an intersection", () => {
    const topOne = { isTop: true, providerId: "one" };
    const ordinaryOne = { isTop: false, providerId: "one" };
    const topTwo = { isTop: true, providerId: "two" };

    expect(modelCardMatchesFilter(topOne, "", false)).toBeTrue();
    expect(modelCardMatchesFilter(ordinaryOne, "one", false)).toBeTrue();
    expect(modelCardMatchesFilter(topOne, "one", true)).toBeTrue();
    expect(modelCardMatchesFilter(ordinaryOne, "one", true)).toBeFalse();
    expect(modelCardMatchesFilter(topTwo, "one", true)).toBeFalse();
  });

  test("reports the visible result count for each controlled filter state", () => {
    expect(modelCardFilterResultCount(
      { providerId: "", sort: "", topOnly: false },
      providers,
      1,
      3,
    )).toBe(3);
    expect(modelCardFilterResultCount(
      { providerId: "one", sort: "", topOnly: false },
      providers,
      1,
      3,
    )).toBe(2);
    expect(modelCardFilterResultCount(
      { providerId: "one", sort: "new", topOnly: true },
      providers,
      1,
      3,
    )).toBe(1);
    expect(modelCardFilterResultCount(
      { providerId: "two", sort: "", topOnly: true },
      providers,
      1,
      3,
    )).toBe(0);
  });

  test("sorts official release dates in real DOM order without changing filtering", () => {
    const items = [
      { isTop: true, providerId: "one", releasedOn: "2026-07-01" },
      { isTop: false, providerId: "two", releasedOn: null },
      { isTop: true, providerId: "one", releasedOn: "2026-08-01" },
      { isTop: true, providerId: "one", releasedOn: "2026-08-01" },
      { isTop: false, providerId: "one", releasedOn: "not-a-date" },
    ] as const;

    expect(modelCardGalleryItemOrder(items, {
      providerId: "",
      sort: "",
      topOnly: false,
    })).toEqual([0, 1, 2, 3, 4]);
    expect(modelCardGalleryItemOrder(items, {
      providerId: "",
      sort: "new",
      topOnly: false,
    })).toEqual([2, 3, 0, 1, 4]);
    expect(modelCardGalleryItemOrder(items, {
      providerId: "one",
      sort: "new",
      topOnly: true,
    })).toEqual([2, 3, 0]);
    expect(items.map(item => item.providerId)).toEqual(["one", "two", "one", "one", "one"]);
  });

  test("server-renders compact accessible controls and every default card slot", () => {
    const markup = renderToStaticMarkup(
      <ModelCardGalleryFilters
        gridId="cards"
        providers={providers}
        topCount={1}
        totalCount={3}
      >
        <ModelCardGalleryItems
          id="cards"
          items={[
            { isTop: true, providerId: "one", releasedOn: "2026-08-01" },
            { isTop: false, providerId: "two", releasedOn: null },
          ]}
        >
          <a href="/one">One</a>
          <a href="/two">Two</a>
        </ModelCardGalleryItems>
      </ModelCardGalleryFilters>,
    );

    expect(markup).toContain('aria-label="Filter model cards"');
    expect(markup).toContain('data-slot="native-select-field"');
    expect(markup).toContain('class="hraness-field__label hraness-visually-hidden"');
    expect(markup).toContain('>Provider</label>');
    expect(markup).not.toContain('<span>Provider</span>');
    expect(markup).toContain('aria-label="Show only cost and AA Index Pareto-frontier cards"');
    expect(markup).toContain('aria-label="Sort model cards by official release date"');
    expect(markup.match(/aria-pressed="false"/gu)).toHaveLength(2);
    expect(markup).toContain("All providers · 3");
    expect(markup).toContain("One · 2");
    expect(markup).toContain("1 card · Cost ↓ · AAI ↑");
    expect(markup).toContain("Newest releases first");
    expect(markup).not.toContain("3 of 3 cards");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Showing 3 model cards.");
    expect(markup).toContain('href="/one"');
    expect(markup).toContain('href="/two"');
    expect(markup).toContain("no other configuration is at least as strong and no more expensive");
    expect(markup).toContain("checked first-party release date");
  });
});
