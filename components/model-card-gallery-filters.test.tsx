import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ModelCardGalleryFilterItem,
  ModelCardGalleryFilters,
  modelCardFilterFromSearch,
  modelCardFilterSearch,
  modelCardMatchesFilter,
  type ModelCardProviderFilter,
} from "./model-card-gallery-filters";

const providers: readonly ModelCardProviderFilter[] = [
  { color: "#45a3ff", count: 2, id: "one", name: "One", topCount: 1 },
  { color: "#f08a6c", count: 1, id: "two", name: "Two", topCount: 0 },
];

describe("model-card gallery filters", () => {
  test("parses only canonical provider and Top query values", () => {
    const providerIds = providers.map(provider => provider.id);

    expect(modelCardFilterFromSearch("?provider=one&top=1", providerIds)).toEqual({
      providerId: "one",
      topOnly: true,
    });
    expect(modelCardFilterFromSearch("?provider=unknown&top=true", providerIds)).toEqual({
      providerId: "",
      topOnly: false,
    });
    expect(modelCardFilterFromSearch("?provider=two&provider=one&top=0&top=1", providerIds)).toEqual({
      providerId: "",
      topOnly: false,
    });
    expect(modelCardFilterFromSearch("?provider=two&provider=two&top=1&top=1", providerIds)).toEqual({
      providerId: "two",
      topOnly: true,
    });
  });

  test("writes stable filter permalinks while preserving unrelated parameters", () => {
    expect(modelCardFilterSearch("?campaign=folio&provider=old&top=0", {
      providerId: "one",
      topOnly: true,
    })).toBe("campaign=folio&provider=one&top=1");
    expect(modelCardFilterSearch("?provider=one&provider=two&top=1", {
      providerId: "",
      topOnly: false,
    })).toBe("");
    expect(modelCardFilterSearch("", {
      providerId: "two",
      topOnly: false,
    })).toBe("provider=two");

    for (const providerId of ["", ...providers.map(provider => provider.id)]) {
      for (const topOnly of [false, true]) {
        const filter = { providerId, topOnly };
        expect(modelCardFilterFromSearch(
          modelCardFilterSearch("?campaign=folio", filter),
          providers.map(provider => provider.id),
        )).toEqual(filter);
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

  test("server-renders labelled controls and every default card slot", () => {
    const markup = renderToStaticMarkup(
      <ModelCardGalleryFilters
        gridId="cards"
        providers={providers}
        topCount={1}
        totalCount={3}
      >
        <div id="cards">
          <ModelCardGalleryFilterItem isTop providerId="one"><a href="/one">One</a></ModelCardGalleryFilterItem>
          <ModelCardGalleryFilterItem isTop={false} providerId="two"><a href="/two">Two</a></ModelCardGalleryFilterItem>
        </div>
      </ModelCardGalleryFilters>,
    );

    expect(markup).toContain('aria-label="Filter model cards"');
    expect(markup).toContain('<span>Provider</span>');
    expect(markup).toContain('aria-label="Show only cost and AA Index Pareto-frontier cards"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain("All providers · 3");
    expect(markup).toContain("One · 2");
    expect(markup).toContain("1 card · Cost ↓ · AA Index ↑");
    expect(markup).toContain("3 of 3 cards");
    expect(markup).toContain('href="/one"');
    expect(markup).toContain('href="/two"');
    expect(markup).toContain("no other configuration is at least as strong and no more expensive");
  });
});
