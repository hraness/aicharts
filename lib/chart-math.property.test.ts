import { expect, test } from "bun:test";
import { assertProperty, fc } from "./property-test";
import { computeDomain, isInPerformanceTier, linearScale, makeNiceTicks, makeTicks } from "./chart-math";

test("property: an economic domain contains every finite non-negative observation", () => {
  assertProperty(fc.property(
    fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 50 }),
    (values) => {
      const domain = computeDomain(values, { includeZero: true, minimum: 0 });
      expect(domain[0]).toBe(0);
      for (const value of values) {
        expect(value).toBeGreaterThanOrEqual(domain[0]);
        expect(value).toBeLessThanOrEqual(domain[1]);
      }
    },
  ));
});

test("property: an unpadded varying domain equals its observed extrema", () => {
  assertProperty(fc.property(
    fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { minLength: 2, maxLength: 50 }),
    (values) => {
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      fc.pre(minimum < maximum);
      expect(computeDomain(values, { paddingRatio: 0 })).toEqual([minimum, maximum]);
    },
  ));
});

test("property: a linear scale maps endpoints and midpoints", () => {
  assertProperty(fc.property(
    fc.integer({ min: -10_000, max: 10_000 }),
    fc.integer({ min: 1, max: 10_000 }),
    fc.integer({ min: -10_000, max: 10_000 }),
    fc.integer({ min: -10_000, max: 10_000 }),
    (domainStart, domainSpan, rangeStart, rangeEnd) => {
      const domainEnd = domainStart + domainSpan;
      const scale = linearScale([domainStart, domainEnd], [rangeStart, rangeEnd]);
      expect(scale(domainStart)).toBeCloseTo(rangeStart, 10);
      expect(scale(domainEnd)).toBeCloseTo(rangeEnd, 10);
      expect(scale(domainStart + domainSpan / 2)).toBeCloseTo((rangeStart + rangeEnd) / 2, 10);
    },
  ));
});

test("property: performance tiers are reflexive and symmetric", () => {
  assertProperty(fc.property(
    fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
    (left, right, radius) => {
      expect(isInPerformanceTier(left, left, radius)).toBe(true);
      expect(isInPerformanceTier(left, right, radius)).toBe(isInPerformanceTier(right, left, radius));
    },
  ));
});

test("property: ticks are inclusive, ordered, and evenly spaced", () => {
  assertProperty(fc.property(
    fc.integer({ min: -10_000, max: 10_000 }),
    fc.integer({ min: 1, max: 10_000 }),
    fc.integer({ min: 2, max: 20 }),
    (start, span, count) => {
      const end = start + span;
      const ticks = makeTicks([start, end], count);
      const expectedStep = span / (count - 1);
      expect(ticks).toHaveLength(count);
      expect(ticks[0]).toBeCloseTo(start, 10);
      expect(ticks.at(-1)).toBeCloseTo(end, 10);
      for (let index = 1; index < ticks.length; index += 1) {
        const previous = ticks[index - 1];
        const current = ticks[index];
        expect(previous).toBeDefined();
        expect(current).toBeDefined();
        if (previous !== undefined && current !== undefined) {
          expect(current).toBeGreaterThan(previous);
          expect(current - previous).toBeCloseTo(expectedStep, 10);
        }
      }
    },
  ));
});

test("property: nice ticks contain the domain on a finite human-friendly grid", () => {
  assertProperty(fc.property(
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
    fc.integer({ min: 0, max: 1_000_000 }),
    fc.integer({ min: 2, max: 20 }),
    (start, span, targetCount) => {
      const end = start + span;
      const ticks = makeNiceTicks([start, end], targetCount);
      const first = ticks[0];
      const last = ticks.at(-1);
      expect(first).toBeDefined();
      expect(last).toBeDefined();
      if (first === undefined || last === undefined) return;

      expect(first).toBeLessThanOrEqual(start);
      expect(last).toBeGreaterThanOrEqual(end);
      expect(ticks.length).toBeLessThanOrEqual(targetCount * 2 + 1);
      for (const tick of ticks) expect(Number.isFinite(tick)).toBe(true);

      if (ticks.length < 2) return;
      const second = ticks[1];
      expect(second).toBeDefined();
      if (second === undefined) return;
      const step = second - first;
      expect(step).toBeGreaterThan(0);
      const power = 10 ** Math.floor(Math.log10(step));
      const factor = step / power;
      expect([1, 2, 2.5, 5, 10].some((candidate) => Math.abs(candidate - factor) < 1e-6)).toBe(true);

      for (let index = 1; index < ticks.length; index += 1) {
        const previous = ticks[index - 1];
        const current = ticks[index];
        expect(previous).toBeDefined();
        expect(current).toBeDefined();
        if (previous !== undefined && current !== undefined) {
          expect(current).toBeGreaterThan(previous);
          expect(current - previous).toBeCloseTo(step, 8);
        }
      }
    },
  ));
});
