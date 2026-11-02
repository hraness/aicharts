import { existsSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { launchFacts } from "../app/launch/facts";
import film from "./film.json";
import { productBoard } from "./mockups";
import buildStory from "./story/story.config";

describe("benchmark film sources", () => {
  test("every template and proof value names a retained benchmark fact", () => {
    for (const [, key] of JSON.stringify(film.copy).matchAll(/\{\{([a-zA-Z]+)\}\}/gu)) {
      expect(Object.hasOwn(launchFacts, key!)).toBeTrue();
    }
    for (const item of film.copy.proof.items) {
      expect(Object.hasOwn(launchFacts, item.fact)).toBeTrue();
      const fact = launchFacts[item.fact as keyof typeof launchFacts];
      expect(Number.isFinite(Number(fact.value))).toBeTrue();
    }
  });

  test("every camera and cursor target exists in the rendered benchmark board", () => {
    const board = productBoard();
    for (const step of film.copy.steps) {
      for (const hook of [step.focus, step.target, step.highlight]) {
        expect(board).toContain(`data-film="${hook}"`);
      }
    }
    expect(board).not.toMatch(/data-film="(?:usage|collector)(?:-|"|$)/u);
  });

  test("the story resolves its facts and retains the model and coding chart shots", () => {
    const story = buildStory();
    const gallery = story.acts.find(act => act.kind === "gallery");
    expect(gallery?.kind).toBe("gallery");
    if (gallery?.kind !== "gallery") throw new Error("Expected benchmark chart shots.");
    expect(gallery.items).toHaveLength(2);
    for (const item of gallery.items) expect(existsSync(item.image)).toBeTrue();
    expect(JSON.stringify(story)).not.toMatch(/collector|dashboard|\/usage/iu);
  });
});
