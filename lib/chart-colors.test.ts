import { describe, expect, test } from "bun:test";
import { rgbHexToLab } from "iwanthue/helpers";
import { openAiEffortColors, providerColors, providerColorRange, recordColor } from "./chart-colors";

function cie76(left: string, right: string): number {
  const leftLab = rgbHexToLab(left);
  const rightLab = rgbHexToLab(right);
  return Math.hypot(leftLab[0] - rightLab[0], leftLab[1] - rightLab[1], leftLab[2] - rightLab[2]);
}

function minimumPairDistance(colors: readonly string[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let leftIndex = 0; leftIndex < colors.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < colors.length; rightIndex += 1) {
      const left = colors[leftIndex];
      const right = colors[rightIndex];
      if (left !== undefined && right !== undefined) minimum = Math.min(minimum, cie76(left, right));
    }
  }
  return minimum;
}

describe("chart colors", () => {
  test("keeps every provider color unique with sufficient intrinsic lightness", () => {
    const colors = Object.values(providerColors);
    expect(new Set(colors).size).toBe(colors.length);
    expect(minimumPairDistance(colors)).toBeGreaterThan(9);
    for (const color of colors) expect(rgbHexToLab(color)[0]).toBeGreaterThan(49);
  });

  test("uses perceptually separated shades for OpenAI effort levels", () => {
    const colors = Object.values(openAiEffortColors);
    expect(new Set(colors).size).toBe(colors.length);
    expect(minimumPairDistance(colors)).toBeGreaterThan(8);
    expect(providerColorRange("openai")).toEqual({
      low: openAiEffortColors.none,
      base: providerColors.openai,
      high: openAiEffortColors.max,
    });
  });

  test("uses effort shades only for OpenAI records", () => {
    expect(recordColor({ providerId: "openai", setting: "max" })).toBe(openAiEffortColors.max);
    expect(recordColor({ providerId: "openai", setting: "default" })).toBe(providerColors.openai);
    expect(recordColor({ providerId: "anthropic", setting: "max" })).toBe(providerColors.anthropic);
  });
});
