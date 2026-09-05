import { describe, expect, test } from "bun:test";

import {
  clientPointThroughSvgBounds,
  clientPointThroughSvgTransform,
  isAssistiveSvgClick,
  svgUnitsForCssPixels,
} from "./svg-pointer-routing";

describe("SVG pointer coordinate routing", () => {
  test("inverts translated and scaled screen coordinates and converts a 24px hit radius", () => {
    const location = clientPointThroughSvgTransform(160, 100, {
      a: .5,
      b: 0,
      c: 0,
      d: .5,
      e: 60,
      f: 25,
    });

    expect(location).toEqual({ unitsPerCssPixel: 2, x: 200, y: 150 });
    expect(svgUnitsForCssPixels(24, location?.unitsPerCssPixel ?? 0)).toBe(48);
  });

  test("supports rotated uniform transforms and rejects singular matrices", () => {
    const location = clientPointThroughSvgTransform(80, 120, {
      a: 0,
      b: 2,
      c: -2,
      d: 0,
      e: 100,
      f: 100,
    });

    expect(location).toEqual({ unitsPerCssPixel: .5, x: 10, y: 10 });
    expect(clientPointThroughSvgTransform(10, 10, {
      a: 1,
      b: 2,
      c: 2,
      d: 4,
      e: 0,
      f: 0,
    })).toBeNull();
  });

  test("falls back to view-box scaling and keeps physical and assistive clicks distinct", () => {
    expect(clientPointThroughSvgBounds(
      450,
      255,
      { height: 470, left: 100, top: 20, width: 720 },
      1440,
      940,
    )).toEqual({ unitsPerCssPixel: 2, x: 700, y: 470 });
    expect(clientPointThroughSvgBounds(0, 0, { height: 0, left: 0, top: 0, width: 0 }, 1, 1)).toBeNull();
    expect(svgUnitsForCssPixels(24, 0)).toBeNull();
    expect(isAssistiveSvgClick(0)).toBeTrue();
    expect(isAssistiveSvgClick(1)).toBeFalse();
    expect(isAssistiveSvgClick(2)).toBeFalse();
  });
});
