import { describe, expect, test } from "bun:test";
import { layoutChartLabels, type LabelPlacement } from "./chart-label-layout";

function overlaps(left: LabelPlacement, right: LabelPlacement, gap = 0): boolean {
  return left.x < right.x + right.width + gap
    && left.x + left.width + gap > right.x
    && left.y < right.y + right.height + gap
    && left.y + left.height + gap > right.y;
}

describe("chart label layout", () => {
  test("spreads a dense score cohort without overlapping labels", () => {
    const anchors = Array.from({ length: 12 }, (_, index) => ({
      height: 54,
      id: `point-${index}`,
      priority: index === 4 ? 2 : 1,
      width: 140,
      x: 170 + index * 16,
      y: 210 + (index % 3) * 12,
    }));
    const obstacles = anchors.map((anchor) => ({
      height: 24,
      width: 24,
      x: anchor.x - 12,
      y: anchor.y - 12,
    }));
    const placements = Array.from(layoutChartLabels(
      anchors,
      { bottom: 760, left: 80, right: 1360, top: 60 },
      { obstacles, offset: 18 },
    ).values());

    expect(placements).toHaveLength(12);
    for (const placement of placements) {
      expect(placement.x).toBeGreaterThanOrEqual(80);
      expect(placement.x + placement.width).toBeLessThanOrEqual(1360);
      expect(placement.y).toBeGreaterThanOrEqual(60);
      expect(placement.y + placement.height).toBeLessThanOrEqual(760);
      for (const obstacle of obstacles) expect(overlaps(placement, { ...obstacle, id: "obstacle" })).toBe(false);
    }
    for (let leftIndex = 0; leftIndex < placements.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < placements.length; rightIndex += 1) {
        const left = placements[leftIndex];
        const right = placements[rightIndex];
        if (left !== undefined && right !== undefined) expect(overlaps(left, right, 8)).toBe(false);
      }
    }
  });

  test("is deterministic and rejects labels larger than the plotting bounds", () => {
    const anchors = [{ height: 40, id: "a", priority: 1, width: 120, x: 200, y: 200 }];
    const bounds = { bottom: 500, left: 50, right: 700, top: 50 };
    expect(layoutChartLabels(anchors, bounds)).toEqual(layoutChartLabels(anchors, bounds));
    expect(() => layoutChartLabels(
      [{ height: 40, id: "wide", priority: 1, width: 800, x: 200, y: 200 }],
      bounds,
    )).toThrow(RangeError);
  });
});
