import { describe, expect, test } from "bun:test";
import {
  bestEpoch,
  buildCatalog,
  catalog,
  effortName,
  epochBenchmarksOf,
  epochScores,
  findSuccessor,
  isComparable,
  noiseFloor,
  orderPair,
  sharedMeasures,
  TB_TIE,
} from "./catalog";
import { epochTie, listNames, modelCopy, pairCopy } from "./copy";
import { formatDelta, formatPrice, formatRatio } from "./format";
import { epoch, release, run } from "./test-fixtures";
import type { ReleaseDataset } from "./types";

// Two OpenAI lines (the old one replaced on the new one's launch day), an
// Anthropic model that overlapped both, and a Google model with no results yet.
const OLD_SOL = release("gpt-9-sol", "GPT-9 Sol", "openai", "2027-01-10", "2027-03-01", run(52, 1.5, { agent: "Codex" }), {
  epoch: [epoch("gpqaDiamond", 80)],
});
const NEW_SOL = release("gpt-9-1-sol", "GPT-9.1 Sol", "openai", "2027-03-01", null, run(61, 1.4, { agent: "Codex" }), {
  epoch: [epoch("gpqaDiamond", 85)],
});
const OPUS = release(
  "claude-opus-9",
  "Claude Opus 9",
  "anthropic",
  "2027-02-01",
  null,
  run(64, 2.5, { agent: "Claude Code" }),
  { epoch: [epoch("gpqaDiamond", 90, "max"), epoch("gpqaDiamond", 88, "high"), epoch("mirrorCode", 70, "max")] },
);
const NEON = release("gemini-9-neon", "Gemini 9 Neon", "google", "2027-03-02", null);
const FIXTURE: ReleaseDataset = {
  schemaVersion: 2,
  updatedAt: "2027-03-05T00:00:00.000Z",
  snapshotDate: "2027-03-05",
  sources: [],
  releases: [NEON, NEW_SOL, OPUS, OLD_SOL],
};
const MISSING = /undefined|NaN|Infinity|null|\[object/;

describe("catalog fixture", () => {
  const cat = buildCatalog(FIXTURE);

  test("finds the release that replaced a superseded one", () => {
    expect(findSuccessor(OLD_SOL, FIXTURE.releases)?.slug).toBe("gpt-9-1-sol");
    expect(findSuccessor(NEW_SOL, FIXTURE.releases)).toBeNull();
    expect(cat.predecessorOf(NEW_SOL)?.slug).toBe("gpt-9-sol");
  });

  test("pairs releases that were current together, plus upgrades", () => {
    expect(cat.pairs.map((p) => [p.slug, p.relation, p.current])).toEqual([
      ["gemini-9-neon-vs-gpt-9-1-sol", "cross-lab", true],
      ["gemini-9-neon-vs-claude-opus-9", "cross-lab", true],
      ["gpt-9-1-sol-vs-claude-opus-9", "cross-lab", true],
      ["gpt-9-1-sol-vs-gpt-9-sol", "upgrade", false],
      ["claude-opus-9-vs-gpt-9-sol", "cross-lab", false],
    ]);
    expect(cat.findPair("gpt-9-1-sol-vs-gpt-9-sol")?.reverseSlug).toBe("gpt-9-sol-vs-gpt-9-1-sol");
    expect(cat.pairsFor(NEW_SOL).map((p) => p.relation)).toEqual(["upgrade", "cross-lab", "cross-lab"]);
  });

  test("indexes a pair only when the two share a measure", () => {
    expect(sharedMeasures(NEW_SOL, OPUS)).toEqual(["terminal-bench", "gpqaDiamond"]);
    expect(isComparable(cat.findPair("gpt-9-1-sol-vs-claude-opus-9")!)).toBe(true);
    expect(isComparable(cat.findPair("gemini-9-neon-vs-gpt-9-1-sol")!)).toBe(false);
  });

  test("reads Epoch scores by benchmark, best first and lowest setting first", () => {
    expect(bestEpoch(OPUS, "gpqaDiamond")?.effort).toBe("max");
    expect(epochScores(OPUS, "gpqaDiamond").map((s) => s.effort)).toEqual(["high", "max"]);
    expect(epochBenchmarksOf(OPUS)).toEqual(["mirrorCode", "gpqaDiamond"]);
    expect(bestEpoch(NEON, "gpqaDiamond")).toBeNull();
    // A tie goes to the lower setting; an unlabelled run is the API default.
    const tied = release("x", "X", "openai", "2027-01-01", null, null, {
      epoch: [epoch("frontierMath", 50, "max"), epoch("frontierMath", 50, null)],
    });
    expect(bestEpoch(tied, "frontierMath")?.effort).toBeNull();
    expect(effortName(null)).toBe("Default");
  });

  test("stars current runs on the cost frontier, and release-day leaders", () => {
    expect([...cat.liveFrontier].sort()).toEqual(["claude-opus-9", "gpt-9-1-sol"]);
    expect(cat.releaseDayFrontier.has("gpt-9-sol")).toBe(true);
    expect(cat.releaseDayFrontier.has("gemini-9-neon")).toBe(false);
  });

  test("treats gaps under two tasks as ties", () => {
    expect(noiseFloor(66)).toBeCloseTo(3.0303, 4);
    // 10 of 330 trials, stored as 64.55 and 61.52, is exactly two tasks: not a tie.
    expect(64.55 - 61.52).toBeGreaterThanOrEqual(TB_TIE);
    expect(64.55 - 61.82).toBeLessThan(TB_TIE);
    expect(epochTie(epoch("gpqaDiamond", 90), epoch("gpqaDiamond", 85))).toBeCloseTo(5.54, 2);
  });

  test("writes a model page from a run, from Epoch scores alone, or from a price alone", () => {
    const sol = modelCopy(NEW_SOL, cat);
    expect(sol.lead).toBe(
      "GPT-9.1 Sol is OpenAI's model released Mar 1, 2027. On Terminal-Bench it passed 61.0% of 330 trials in Codex 1.0.0 at High effort, for $1.40 per task. Epoch AI measures it at 85.0% on GPQA Diamond.",
    );
    expect(sol.standing).toBe(
      "It earns a frontier star: no current model scores higher on Terminal-Bench for $1.40 per task or less.",
    );
    expect(sol.questions.map((q) => q.q)).toEqual([
      "How does GPT-9.1 Sol score on Terminal-Bench?",
      "How much does GPT-9.1 Sol cost per task?",
      "How does GPT-9.1 Sol do on Epoch AI's benchmarks?",
      "Is GPT-9.1 Sol better than GPT-9 Sol?",
      "When was GPT-9.1 Sol released?",
    ]);
    expect(sol.questions[0]!.a).toBe(
      "It passed 201 of 330 trials, 61.0% (±3.0 points at 95% confidence), running in Codex 1.0.0 at High effort. Terminal-Bench has 66 tasks; this run tried each 5 times and was graded on version 4.1 of the tasks.",
    );
    expect(sol.questions[3]!.a).toBe(
      "On Terminal-Bench GPT-9.1 Sol passes 61.0% against 52.0% for GPT-9 Sol (+9.0 points). It costs $1.40 per task against $1.50. On Epoch AI's benchmarks: GPQA Diamond 85.0% against 80.0%.",
    );
    expect(modelCopy(OPUS, cat).lead).toContain(
      "Epoch AI measures it at 70.0% on MirrorCode and 90.0% on GPQA Diamond, its best settings.",
    );
    expect(modelCopy(OLD_SOL, cat).standing).toBe(
      "OpenAI superseded it on Mar 1, 2027 with GPT-9.1 Sol. GPT-9.1 Sol passes 61.0% of Terminal-Bench for $1.40 per task.",
    );
    const neon = modelCopy(NEON, cat);
    expect(neon.lead).toBe(
      "Gemini 9 Neon is Google's model released Mar 2, 2027. Neither Terminal-Bench nor Epoch AI has published results for it yet; its API price is $2/$10 per million input/output tokens. This page fills in when they do.",
    );
    // The lead already says it has no run; the standing adds nothing.
    expect(neon.standing).toBe("");
  });

  test("writes a pair page that calls close scores level", () => {
    const copy = pairCopy(cat.findPair("gpt-9-1-sol-vs-claude-opus-9")!, cat);
    expect(copy.lead).toBe(
      "GPT-9.1 Sol and Claude Opus 9 are level on Terminal-Bench: 61.0% in Codex against 64.0% in Claude Code, within two tasks' worth of each other.",
    );
    expect(copy.budget).toBe(
      "Claude Opus 9 costs $2.50 per task against $1.40 for GPT-9.1 Sol. For scores this close, the cheaper run gives about the same for less.",
    );
    expect(copy.choose.map((c) => [c.release.slug, c.reasons])).toEqual([
      [
        "gpt-9-1-sol",
        [
          "You want to spend less per task: $1.40 against $2.50 on Terminal-Bench.",
          "You want fewer output tokens: 28.0k per task against 50.0k.",
          "You work in Codex, OpenAI's own coding agent, where its Terminal-Bench run was made.",
        ],
      ],
      // 90% against 85% on GPQA Diamond is inside the scores' margin of error.
      ["claude-opus-9", ["You work in Claude Code, Anthropic's own coding agent, where its Terminal-Bench run was made."]],
    ]);
    expect(pairCopy(cat.findPair("gemini-9-neon-vs-gpt-9-1-sol")!, cat).lead).toBe(
      "GPT-9.1 Sol passes 61.0% of Terminal-Bench in Codex; Gemini 9 Neon has no run on the leaderboard yet.",
    );
  });
});

describe("catalog on the published data", () => {
  test("every superseded release with a successor points forward in time at the same lab", () => {
    for (const r of catalog.superseded) {
      const next = catalog.successorOf(r);
      if (!next) continue;
      expect(next.provider).toBe(r.provider);
      expect(next.releaseDate > r.releaseDate).toBe(true);
    }
    for (const r of catalog.current) expect(catalog.successorOf(r)).toBeNull();
  });

  test("pair slugs are unique, newer release first, and never collide with a reverse slug", () => {
    const slugs = new Set(catalog.pairs.map((p) => p.slug));
    expect(slugs.size).toBe(catalog.pairs.length);
    for (const p of catalog.pairs) {
      expect(orderPair(p.second, p.first)).toEqual([p.first, p.second]);
      expect(p.slug).toBe(`${p.first.slug}-vs-${p.second.slug}`);
      expect(slugs.has(p.reverseSlug)).toBe(false);
      expect(p.current).toBe(!p.first.deprecated && !p.second.deprecated);
    }
    // Every two current releases get a page.
    const n = catalog.current.length;
    expect(catalog.pairs.filter((p) => p.current)).toHaveLength((n * (n - 1)) / 2);
  });

  test("pairs of two Terminal-Bench runs are always comparable", () => {
    for (const p of catalog.pairs) {
      if (p.first.terminalBench && p.second.terminalBench) expect(isComparable(p)).toBe(true);
    }
    expect(catalog.pairs.some(isComparable)).toBe(true);
  });

  test("frontier stars only go to current releases", () => {
    expect(catalog.liveFrontier.size).toBeGreaterThan(0);
    for (const slug of catalog.liveFrontier) expect(catalog.find(slug)?.deprecated).toBe(false);
    for (const slug of catalog.releaseDayFrontier) expect(catalog.find(slug)?.terminalBench).not.toBeNull();
  });

  test("generated copy never prints a missing value", () => {
    const texts: string[] = [];
    for (const r of catalog.releases) {
      const copy = modelCopy(r);
      texts.push(copy.description, copy.lead);
      // A current model without a run has no standing: its lead already says so.
      if (r.deprecated || r.terminalBench) texts.push(copy.standing);
      else expect(copy.standing).toBe("");
      texts.push(...copy.questions.flatMap((q) => [q.q, q.a]));
      expect(copy.description.length).toBeLessThanOrEqual(170);
    }
    for (const p of catalog.pairs) {
      const copy = pairCopy(p);
      texts.push(copy.description, copy.lead);
      texts.push(...copy.choose.flatMap((c) => c.reasons));
      texts.push(...copy.questions.flatMap((q) => [q.q, q.a]));
      if (p.first.terminalBench && p.second.terminalBench) texts.push(copy.budget);
    }
    for (const text of texts) {
      expect(text).not.toMatch(MISSING);
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("formatting", () => {
  test("formatPrice keeps whole dollars bare and cents to two or three places", () => {
    expect(formatPrice(3)).toBe("$3");
    expect(formatPrice(0.1)).toBe("$0.10");
    expect(formatPrice(1.25)).toBe("$1.25");
    expect(formatPrice(0.075)).toBe("$0.075");
  });

  test("formatDelta signs changes with a true minus", () => {
    expect(formatDelta(3.14)).toBe("+3.1");
    expect(formatDelta(-0.44)).toBe("−0.4");
    expect(formatDelta(0)).toBe("0.0");
  });

  test("formatRatio rounds by size", () => {
    expect(formatRatio(12.4)).toBe("12×");
    expect(formatRatio(2.44)).toBe("2.4×");
    expect(formatRatio(1.321)).toBe("1.32×");
  });

  test("listNames joins with commas and a final and", () => {
    expect(listNames(["A"])).toBe("A");
    expect(listNames(["A", "B"])).toBe("A and B");
    expect(listNames(["A", "B", "C"])).toBe("A, B and C");
  });
});
