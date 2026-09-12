import { describe, expect, test } from "bun:test";

import {
  filterPickerOptions,
  isPickerNavigationKey,
  pickerColumnCount,
  pickerNavigationIndex,
  splitPickerLabel,
  type PickerOption,
} from "./option-picker";

const options: readonly PickerOption[] = [
  { description: "OpenAI", id: "astra-max", label: "GPT-6 Astra (max)" },
  { description: "OpenAI", id: "sol-high", label: "GPT-5.6 Sol (high)" },
  { description: "Anthropic", id: "fable", label: "Claude Fable 5.1" },
  { description: "SpaceXAI", id: "grok", label: "Grok 4.6 (xhigh)" },
  {
    description: "NVIDIA",
    id: "nemotron",
    keywords: ["reasoning"],
    label: "Nemotron 3 Super 120B A12B",
  },
];

describe("picker fuzzy filtering", () => {
  test("returns every option unchanged for an empty or blank query", () => {
    expect(filterPickerOptions(options, "")).toEqual(options);
    expect(filterPickerOptions(options, "   ")).toEqual(options);
  });

  test("matches labels and descriptions case-insensitively", () => {
    expect(filterPickerOptions(options, "ASTRA").map(option => option.id)).toEqual(["astra-max"]);
    expect(filterPickerOptions(options, "openai").map(option => option.id))
      .toEqual(["astra-max", "sol-high"]);
  });

  test("requires every whitespace-separated token to match", () => {
    expect(filterPickerOptions(options, "openai sol").map(option => option.id)).toEqual(["sol-high"]);
    expect(filterPickerOptions(options, "openai fable")).toEqual([]);
  });

  test("keeps in-order character subsequences as loose fuzzy matches", () => {
    expect(filterPickerOptions(options, "gpt6a").map(option => option.id)).toContain("astra-max");
    expect(filterPickerOptions(options, "nmtrn").map(option => option.id)).toEqual(["nemotron"]);
  });

  test("ranks word-start and substring matches before loose subsequences", () => {
    const grokFirst = filterPickerOptions(options, "gro").map(option => option.id);
    expect(grokFirst[0]).toBe("grok");
  });

  test("searches provided keywords", () => {
    expect(filterPickerOptions(options, "reasoning").map(option => option.id)).toEqual(["nemotron"]);
  });

  test("returns nothing when no option matches", () => {
    expect(filterPickerOptions(options, "zzqx")).toEqual([]);
  });

  test("keeps the caller's order for equally strong matches", () => {
    const matched = filterPickerOptions(options, "gpt").map(option => option.id);
    expect(matched).toEqual(["astra-max", "sol-high"]);
  });
});

describe("picker label wrapping", () => {
  test("moves a trailing parenthetical onto a quieter qualifier line", () => {
    expect(splitPickerLabel("Claude Sonnet 5 (Adaptive Reasoning, Low Effort)")).toEqual({
      label: "Claude Sonnet 5",
      qualifier: "Adaptive Reasoning, Low Effort",
    });
    expect(splitPickerLabel("GPT-6 Astra (max)")).toEqual({
      label: "GPT-6 Astra",
      qualifier: "max",
    });
  });

  test("leaves names without a trailing group, and nested parentheses, intact", () => {
    expect(splitPickerLabel("Nemotron 3 Super 120B A12B")).toEqual({
      label: "Nemotron 3 Super 120B A12B",
    });
    expect(splitPickerLabel("Model (inner) still open (outer)")).toEqual({
      label: "Model (inner) still open",
      qualifier: "outer",
    });
    expect(splitPickerLabel("Nested (Adaptive (Max))")).toEqual({
      label: "Nested (Adaptive (Max))",
    });
  });
});

describe("picker grid geometry", () => {
  test("fits columns to the panel width within bounds", () => {
    expect(pickerColumnCount(920, 180, 4, 4)).toBe(4);
    expect(pickerColumnCount(560, 180, 4, 4)).toBe(3);
    expect(pickerColumnCount(340, 180, 4, 4)).toBe(1);
    expect(pickerColumnCount(0, 180, 4, 4)).toBe(1);
    expect(pickerColumnCount(10_000, 180, 4, 4)).toBe(4);
    expect(pickerColumnCount(Number.NaN, 180, 4, 4)).toBe(1);
  });

  test("recognizes exactly the grid navigation keys", () => {
    for (const key of ["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home"]) {
      expect(isPickerNavigationKey(key)).toBeTrue();
    }
    expect(isPickerNavigationKey("Enter")).toBeFalse();
    expect(isPickerNavigationKey("a")).toBeFalse();
  });

  test("steps horizontally with clamping and vertically by rows", () => {
    expect(pickerNavigationIndex("ArrowRight", 0, 7, 3)).toBe(1);
    expect(pickerNavigationIndex("ArrowLeft", 0, 7, 3)).toBe(0);
    expect(pickerNavigationIndex("ArrowRight", 6, 7, 3)).toBe(6);
    expect(pickerNavigationIndex("ArrowDown", 1, 7, 3)).toBe(4);
    expect(pickerNavigationIndex("ArrowUp", 4, 7, 3)).toBe(1);
    expect(pickerNavigationIndex("ArrowDown", 5, 7, 3)).toBe(5);
    expect(pickerNavigationIndex("ArrowUp", 1, 7, 3)).toBe(1);
    expect(pickerNavigationIndex("Home", 5, 7, 3)).toBe(0);
    expect(pickerNavigationIndex("End", 0, 7, 3)).toBe(6);
  });

  test("enters the grid from no active option and survives empty results", () => {
    expect(pickerNavigationIndex("ArrowDown", -1, 7, 3)).toBe(0);
    expect(pickerNavigationIndex("ArrowUp", -1, 7, 3)).toBe(6);
    expect(pickerNavigationIndex("ArrowDown", 12, 7, 3)).toBe(0);
    expect(pickerNavigationIndex("ArrowDown", 0, 0, 3)).toBe(-1);
  });
});
