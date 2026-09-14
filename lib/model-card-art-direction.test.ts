import { describe, expect, test } from "bun:test";

import {
  modelCardArtDirection,
  modelCardProviderColors,
  modelCardSecondaryColors,
} from "./model-card-art-direction";
import {
  MODEL_CARD_SNAPSHOT,
} from "./model-card-collection";

function channelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= .04045
    ? normalized / 12.92
    : ((normalized + .055) / 1.055) ** 2.4;
}

function linearRgb(hex: string): readonly [number, number, number] {
  const channels = [1, 3, 5].map(offset => (
    channelToLinear(Number.parseInt(hex.slice(offset, offset + 2), 16))
  ));
  return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0];
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = linearRgb(hex);
  return red * .2126 + green * .7152 + blue * .0722;
}

function cieLab(hex: string): readonly [number, number, number] {
  const [red, green, blue] = linearRgb(hex);
  const pivot = (value: number) => (
    value > .008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116
  );
  const x = pivot((red * .4124 + green * .3576 + blue * .1805) / .95047);
  const y = pivot(red * .2126 + green * .7152 + blue * .0722);
  const z = pivot((red * .0193 + green * .1192 + blue * .9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function cie76(left: string, right: string): number {
  const leftLab = cieLab(left);
  const rightLab = cieLab(right);
  return Math.hypot(...leftLab.map((value, index) => value - (rightLab[index] ?? 0)));
}

describe("model card art direction", () => {
  test("uses one gilded family for high, x-high, and max profiles", () => {
    const directions = ["high", "xhigh", "max"].map(profileSlug => (
      modelCardArtDirection("openai", "standard", profileSlug)
    ));
    for (const direction of directions) {
      expect(direction).toMatchObject({
        accentFamily: "elevated",
        secondaryColor: modelCardSecondaryColors.elevated,
      });
    }
    expect(directions.map(direction => direction.illuminationDensity)).toEqual([3, 4, 5]);
  });

  test("increases ornament density through the collectible hierarchy", () => {
    expect(modelCardArtDirection("openai", "standard", "low").illuminationDensity).toBe(1);
    expect(modelCardArtDirection("openai", "standard", "medium").illuminationDensity).toBe(2);
    expect(modelCardArtDirection("alibaba_cloud", "thinking", "default")).toMatchObject({
      accentFamily: "thinking",
      illuminationDensity: 3,
    });
    expect(modelCardArtDirection("anthropic", "max", "default")).toMatchObject({
      accentFamily: "elevated",
      illuminationDensity: 5,
    });
  });

  test("keeps fast and thinking topology recognizable without overriding elevated profiles", () => {
    expect(modelCardArtDirection("cursor", "fast", "default")).toMatchObject({
      accentFamily: "fast",
      illuminationDensity: 2,
    });
    expect(modelCardArtDirection("deepseek", "fast", "max")).toMatchObject({
      accentFamily: "elevated",
      illuminationDensity: 5,
    });
  });

  test("covers the provider catalog with an accessible, perceptually separated palette", () => {
    const snapshotProviderIds = [...new Set(
      MODEL_CARD_SNAPSHOT.records.map(record => record.providerId),
    )].sort();
    expect(Object.keys(modelCardProviderColors).sort()).toEqual(snapshotProviderIds);

    const providerColors = Object.values(modelCardProviderColors);
    expect(new Set(providerColors).size).toBe(providerColors.length);
    const darkFieldLuminance = relativeLuminance("#0d0e11");
    for (const color of providerColors) {
      expect((relativeLuminance(color) + .05) / (darkFieldLuminance + .05)).toBeGreaterThanOrEqual(4.5);
    }

    const providerDistances = providerColors.flatMap((color, index) => (
      providerColors.slice(index + 1).map(otherColor => cie76(color, otherColor))
    ));
    expect(Math.min(...providerDistances)).toBeGreaterThanOrEqual(22);
  });

  test("keeps both inks distinct for every provider and class pairing", () => {
    const inkDistances = Object.values(modelCardProviderColors).flatMap(providerInk => (
      Object.values(modelCardSecondaryColors).map(classInk => cie76(providerInk, classInk))
    ));
    expect(Math.min(...inkDistances)).toBeGreaterThanOrEqual(25);
    expect(new Set(Object.values(modelCardSecondaryColors)).size).toBe(4);
  });
});
