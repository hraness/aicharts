import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  filterPickerOptions,
  pickerColumnCount,
  pickerNavigationIndex,
  type PickerNavigationKey,
  type PickerOption,
} from "./option-picker";

const optionArbitrary = fc.record({
  description: fc.option(fc.string({ maxLength: 24 }), { nil: undefined }),
  id: fc.uuid(),
  label: fc.string({ maxLength: 40, minLength: 1 }),
}, { noNullPrototype: true });

const optionsArbitrary = fc.uniqueArray(optionArbitrary, {
  maxLength: 40,
  selector: option => option.id,
});

const queryArbitrary = fc.string({ maxLength: 12 });

const navigationKeyArbitrary = fc.constantFrom<PickerNavigationKey>(
  "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home",
);

describe("picker filter laws", () => {
  test("results are always a subset of the input without duplicates", () => {
    fc.assert(fc.property(optionsArbitrary, queryArbitrary, (options, query) => {
      const results = filterPickerOptions(options, query);
      const inputIds = new Set(options.map(option => option.id));
      expect(results.every(option => inputIds.has(option.id))).toBeTrue();
      expect(new Set(results.map(option => option.id)).size).toBe(results.length);
    }));
  });

  test("a blank query is the identity", () => {
    fc.assert(fc.property(optionsArbitrary, (options: readonly PickerOption[]) => {
      expect(filterPickerOptions(options, "")).toEqual(options);
    }));
  });

  test("every option matches its own label as a query", () => {
    fc.assert(fc.property(optionsArbitrary, options => {
      for (const option of options) {
        if (option.label.trim().length === 0) continue;
        const results = filterPickerOptions(options, option.label);
        expect(results.some(result => result.id === option.id)).toBeTrue();
      }
    }));
  });

  test("appending to the query never adds results", () => {
    fc.assert(fc.property(
      optionsArbitrary,
      queryArbitrary,
      fc.string({ maxLength: 4, minLength: 1 }).filter(text => !/\s/u.test(text)),
      (options, query, suffix) => {
        const before = new Set(filterPickerOptions(options, query).map(option => option.id));
        const after = filterPickerOptions(options, query + suffix);
        expect(after.every(option => before.has(option.id))).toBeTrue();
      },
    ));
  });
});

describe("picker grid navigation laws", () => {
  test("navigation stays inside the filtered results", () => {
    fc.assert(fc.property(
      navigationKeyArbitrary,
      fc.integer({ max: 60, min: -5 }),
      fc.integer({ max: 50, min: 1 }),
      fc.integer({ max: 6, min: 1 }),
      (key, activeIndex, optionCount, columnCount) => {
        const next = pickerNavigationIndex(key, activeIndex, optionCount, columnCount);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(optionCount);
      },
    ));
  });

  test("Home and End reach the exact boundaries", () => {
    fc.assert(fc.property(
      fc.integer({ max: 50, min: -1 }),
      fc.integer({ max: 50, min: 1 }),
      fc.integer({ max: 6, min: 1 }),
      (activeIndex, optionCount, columnCount) => {
        expect(pickerNavigationIndex("Home", activeIndex, optionCount, columnCount)).toBe(0);
        expect(pickerNavigationIndex("End", activeIndex, optionCount, columnCount)).toBe(optionCount - 1);
      },
    ));
  });

  test("column count is always at least one and never above the cap", () => {
    fc.assert(fc.property(
      fc.double({ max: 10_000, min: -100, noNaN: false }),
      fc.integer({ max: 400, min: 1 }),
      fc.integer({ max: 24, min: 0 }),
      fc.integer({ max: 8, min: 1 }),
      (width, minimumColumnWidth, gap, maximumColumns) => {
        const columns = pickerColumnCount(width, minimumColumnWidth, gap, maximumColumns);
        expect(columns).toBeGreaterThanOrEqual(1);
        expect(columns).toBeLessThanOrEqual(maximumColumns);
      },
    ));
  });
});
