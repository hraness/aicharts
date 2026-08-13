import { expect, test } from "bun:test";
import { assertProperty, fc } from "./property-test";
import {
  placeChartTooltip,
  type TooltipPlacement,
  type TooltipRect,
} from "./chart-tooltip-layout";

function overlaps(left: TooltipRect, right: TooltipRect): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function connectorEndsOnPlacement(placement: TooltipPlacement): boolean {
  const { end } = placement.connector;
  const onVerticalEdge = (end.x === placement.x || end.x === placement.x + placement.width)
    && end.y >= placement.y
    && end.y <= placement.y + placement.height;
  const onHorizontalEdge = (end.y === placement.y || end.y === placement.y + placement.height)
    && end.x >= placement.x
    && end.x <= placement.x + placement.width;
  return onVerticalEdge || onHorizontalEdge;
}

function expectTranslationInvariant(
  placement: TooltipPlacement,
  translated: TooltipPlacement,
  translation: Readonly<{ x: number; y: number }>,
): void {
  expect(translated.x).toBeCloseTo(placement.x + translation.x, 8);
  expect(translated.y).toBeCloseTo(placement.y + translation.y, 8);
  expect(translated.connector.start.x).toBeCloseTo(placement.connector.start.x + translation.x, 8);
  expect(translated.connector.start.y).toBeCloseTo(placement.connector.start.y + translation.y, 8);
  expect(translated.connector.end.x).toBeCloseTo(placement.connector.end.x + translation.x, 8);
  expect(translated.connector.end.y).toBeCloseTo(placement.connector.end.y + translation.y, 8);
}

const layoutArbitrary = fc.record({
  anchorSeedX: fc.integer({ min: 0, max: 10_000 }),
  anchorSeedY: fc.integer({ min: 0, max: 10_000 }),
  height: fc.integer({ min: 300, max: 1_200 }),
  obstacleSeeds: fc.array(fc.tuple(
    fc.integer({ min: 0, max: 10_000 }),
    fc.integer({ min: 0, max: 10_000 }),
    fc.integer({ min: 8, max: 280 }),
    fc.integer({ min: 8, max: 180 }),
  ), { maxLength: 16 }),
  popupHeightSeed: fc.integer({ min: 120, max: 360 }),
  popupWidthSeed: fc.integer({ min: 180, max: 420 }),
  width: fc.integer({ min: 320, max: 2_000 }),
}).map((generated) => {
  const bounds = { bottom: generated.height - 8, left: 8, right: generated.width - 8, top: 8 };
  const availableWidth = bounds.right - bounds.left;
  const availableHeight = bounds.bottom - bounds.top;
  const popup = {
    height: Math.min(generated.popupHeightSeed, availableHeight),
    width: Math.min(generated.popupWidthSeed, availableWidth),
  };
  const anchor = {
    x: bounds.left + generated.anchorSeedX % (availableWidth + 1),
    y: bounds.top + generated.anchorSeedY % (availableHeight + 1),
  };
  const obstacles = generated.obstacleSeeds.map(([seedX, seedY, width, height]) => ({
    height,
    width,
    x: bounds.left + seedX % availableWidth,
    y: bounds.top + seedY % availableHeight,
  }));
  return { anchor, bounds, obstacles, popup };
});

test("property: tooltip geometry stays in the viewport and its leader terminates on the card", () => {
  assertProperty(fc.property(layoutArbitrary, ({ anchor, bounds, obstacles, popup }) => {
    const placement = placeChartTooltip(anchor, popup, bounds, { obstacles });

    expect(placement.x).toBeGreaterThanOrEqual(bounds.left);
    expect(placement.y).toBeGreaterThanOrEqual(bounds.top);
    expect(placement.x + placement.width).toBeLessThanOrEqual(bounds.right);
    expect(placement.y + placement.height).toBeLessThanOrEqual(bounds.bottom);
    expect(placement.connector.start).toEqual(anchor);
    expect(connectorEndsOnPlacement(placement)).toBeTrue();
    expect([
      placement.connector.end.x,
      placement.connector.end.y,
      placement.connector.start.x,
      placement.connector.start.y,
    ].every(Number.isFinite)).toBeTrue();
  }), { numRuns: 500 });
});

test("property: placement is deterministic and translation invariant", () => {
  assertProperty(fc.property(
    layoutArbitrary,
    fc.integer({ min: -2_000, max: 2_000 }),
    fc.integer({ min: -2_000, max: 2_000 }),
    ({ anchor, bounds, obstacles, popup }, deltaX, deltaY) => {
      const first = placeChartTooltip(anchor, popup, bounds, { obstacles });
      expect(placeChartTooltip(anchor, popup, bounds, { obstacles })).toEqual(first);

      const translated = placeChartTooltip(
        { x: anchor.x + deltaX, y: anchor.y + deltaY },
        popup,
        {
          bottom: bounds.bottom + deltaY,
          left: bounds.left + deltaX,
          right: bounds.right + deltaX,
          top: bounds.top + deltaY,
        },
        {
          obstacles: obstacles.map((obstacle) => ({
            ...obstacle,
            x: obstacle.x + deltaX,
            y: obstacle.y + deltaY,
          })),
        },
      );

      expectTranslationInvariant(first, translated, { x: deltaX, y: deltaY });
    },
  ), { numRuns: 300 });
});

test("regression: corner tangencies and overlap ties stay invariant across viewport origins", () => {
  const cases = [
    {
      anchor: { x: 700, y: 8 },
      bounds: { bottom: 1_011, left: 8, right: 992, top: 8 },
      obstacles: [{ height: 95, width: 8, x: 674, y: 58 }],
      popup: { height: 121, width: 299 },
      translation: { x: 0, y: -569 },
    },
    {
      anchor: { x: 12, y: 216 },
      bounds: { bottom: 320, left: 8, right: 817, top: 8 },
      obstacles: [
        { height: 109, width: 108, x: 141, y: 171 },
        { height: 109, width: 75, x: 514, y: 108 },
      ],
      popup: { height: 312, width: 338 },
      translation: { x: 1_762, y: -795 },
    },
  ] as const;

  for (const { anchor, bounds, obstacles, popup, translation } of cases) {
    const placement = placeChartTooltip(anchor, popup, bounds, { obstacles });
    const translated = placeChartTooltip(
      { x: anchor.x + translation.x, y: anchor.y + translation.y },
      popup,
      {
        bottom: bounds.bottom + translation.y,
        left: bounds.left + translation.x,
        right: bounds.right + translation.x,
        top: bounds.top + translation.y,
      },
      {
        obstacles: obstacles.map((obstacle) => ({
          ...obstacle,
          x: obstacle.x + translation.x,
          y: obstacle.y + translation.y,
        })),
      },
    );

    expectTranslationInvariant(placement, translated, translation);
  }
});

test("property: a blocked first choice yields to a clear placement", () => {
  assertProperty(fc.property(
    fc.integer({ min: 900, max: 2_000 }),
    fc.integer({ min: 700, max: 1_200 }),
    fc.integer({ min: 220, max: 360 }),
    fc.integer({ min: 180, max: 300 }),
    (viewportWidth, viewportHeight, popupWidth, popupHeight) => {
      const anchor = { x: viewportWidth / 2, y: viewportHeight / 2 };
      const bounds = { bottom: viewportHeight - 8, left: 8, right: viewportWidth - 8, top: 48 };
      const blockedAbove = {
        height: popupHeight + 24,
        width: popupWidth + 24,
        x: anchor.x - popupWidth / 2 - 12,
        y: anchor.y - popupHeight - 24,
      };
      const placement = placeChartTooltip(anchor, { height: popupHeight, width: popupWidth }, bounds, {
        obstacles: [blockedAbove],
      });

      expect(overlaps(placement, blockedAbove)).toBeFalse();
    },
  ), { numRuns: 300 });
});

test("regression: the dense pinned band sends the detail card into the open upper layer", () => {
  const anchor = { x: 640, y: 628 };
  const placement = placeChartTooltip(
    anchor,
    { height: 420, width: 360 },
    { bottom: 974, left: 8, right: 2552, top: 48 },
    {
      obstacles: [
        { height: 104, width: 360, x: 690, y: 550 },
        { height: 104, width: 310, x: 290, y: 650 },
        { height: 104, width: 250, x: 760, y: 690 },
      ],
    },
  );

  expect(placement.y + placement.height).toBeLessThan(550);
  expect(placement.connector.start).toEqual(anchor);
  expect(connectorEndsOnPlacement(placement)).toBeTrue();
});
