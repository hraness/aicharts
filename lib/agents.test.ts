import { describe, expect, test } from "bun:test";
import {
  agentBudgetText,
  agentChooseReasons,
  agentDescription,
  agentLead,
  agentPairs,
  agentQuestions,
  bestRun,
  bestUnder,
  cheapestRun,
  compareVersions,
  findAgentPair,
  harness,
  harnessGroups,
  harnessRuns,
  olderVersionRuns,
  pickRun,
  runSegments,
  type HarnessGroup,
  type HarnessId,
} from "./agents";
import { buildCatalog, catalog } from "./catalog";
import { release, run } from "./test-fixtures";
import { PROVIDERS, type ModelRelease, type TerminalBenchRun } from "./types";

/** A current release whose Terminal-Bench run is in its lab's own agent. */
function agentRelease(
  slug: string,
  name: string,
  provider: ModelRelease["provider"],
  score: number,
  cost: number | null,
  overrides: Partial<TerminalBenchRun> = {},
  supersededOn: string | null = null,
): ModelRelease {
  return release(
    slug,
    name,
    provider,
    supersededOn ? "2026-12-01" : "2027-01-01",
    supersededOn,
    run(score, cost, { agent: PROVIDERS[provider].harness, ...overrides }),
  );
}

function fixture(releases: ModelRelease[]) {
  return buildCatalog({
    schemaVersion: 2,
    updatedAt: "2027-03-05T00:00:00.000Z",
    snapshotDate: "2027-03-05",
    sources: [],
    releases,
  });
}

// Codex is cheaper at the low end; Claude Code tops out higher.
const LUNA = agentRelease("gpt-9-luna", "GPT-9 Luna", "openai", 40, 0.3, { version: "4.0" });
const SOL = agentRelease("gpt-9-sol", "GPT-9 Sol", "openai", 50, 1.2);
const ASTRA = agentRelease("gpt-9-astra", "GPT-9 Astra", "openai", 53, 4);
const OLD_ASTRA = agentRelease("gpt-8-astra", "GPT-8 Astra", "openai", 70, 0.1, {}, "2027-01-01");
const SONNET = agentRelease("claude-sonnet-9", "Claude Sonnet 9", "anthropic", 52, 3);
const OPUS = agentRelease("claude-opus-9", "Claude Opus 9", "anthropic", 58, 12, { minutesPerTask: 60 });
// A Gemini run in someone else's agent never counts as Antigravity CLI's.
const FLASH = release(
  "gemini-9-flash",
  "Gemini 9 Flash",
  "google",
  "2027-01-01",
  null,
  run(45, 0.5, { agent: "mini-SWE-agent" }),
);
const CAT = fixture([LUNA, SOL, ASTRA, OLD_ASTRA, SONNET, OPUS, FLASH]);
const groups = (ids: HarnessId[], cat = CAT) => harnessGroups(ids, cat);
const pairOf = (cat: ReturnType<typeof fixture>) =>
  groups(["codex", "claude-code"], cat) as [HarnessGroup, HarnessGroup];

describe("agent runs", () => {
  test("keep current models' runs in their own agent, best model first", () => {
    expect(harnessRuns(harness("codex"), CAT).map((r) => r.key)).toEqual([
      "codex:gpt-9-astra",
      "codex:gpt-9-sol",
      "codex:gpt-9-luna",
    ]);
    expect(harnessRuns(harness("antigravity-cli"), CAT)).toEqual([]);
  });

  test("leave out agents with no current runs", () => {
    expect(groups(["codex", "antigravity-cli", "claude-code"]).map((g) => g.harness.id)).toEqual([
      "codex",
      "claude-code",
    ]);
    expect(agentPairs(CAT).map((p) => p.slug)).toEqual(["codex-vs-claude-code"]);
  });

  test("pick the best, the cheapest, the cheapest near the best and the best under a budget", () => {
    const runs = harnessRuns(harness("codex"), CAT);
    expect(bestRun(runs).key).toBe("codex:gpt-9-astra");
    expect(cheapestRun(runs)?.key).toBe("codex:gpt-9-luna");
    // GPT-9 Sol is 3.0 points under GPT-9 Astra: inside two tasks' worth (3.03).
    expect(pickRun(runs)?.key).toBe("codex:gpt-9-sol");
    expect(bestUnder(runs, 1)?.key).toBe("codex:gpt-9-luna");
    expect(bestUnder(runs, 0.2)).toBeNull();
    // A run without a reported cost is never the cheapest.
    const unpriced = fixture([agentRelease("gpt-9-nova", "GPT-9 Nova", "openai", 60, null), SOL]);
    expect(cheapestRun(harnessRuns(harness("codex"), unpriced))?.key).toBe("codex:gpt-9-sol");
    expect(pickRun([])).toBeNull();
  });

  test("group the shared cost frontier by agent", () => {
    const all = groups(["codex", "claude-code"]).flatMap((g) => g.runs);
    expect(runSegments(all).map((s) => [s.harness.id, s.runs.map((r) => r.key)])).toEqual([
      ["codex", ["codex:gpt-9-luna", "codex:gpt-9-sol"]],
      ["claude-code", ["claude-code:claude-sonnet-9"]],
      ["codex", ["codex:gpt-9-astra"]],
      ["claude-code", ["claude-code:claude-opus-9"]],
    ]);
  });

  test("compare dataset versions part by part", () => {
    expect(compareVersions("4.10", "4.9")).toBeGreaterThan(0);
    expect(compareVersions("4.1", "4.1")).toBe(0);
    expect(compareVersions("4.0", "4.1")).toBeLessThan(0);
    const all = groups(["codex", "claude-code"]).flatMap((g) => g.runs);
    expect(olderVersionRuns(all).map((r) => r.key)).toEqual(["codex:gpt-9-luna"]);
    expect(olderVersionRuns([])).toEqual([]);
  });
});

describe("agent copy", () => {
  const [codex, claude] = pairOf(CAT);

  test("names the leader, and calls tops within two tasks level", () => {
    expect(agentLead([codex, claude])).toBe(
      "Claude Code scores higher on Terminal-Bench: 58.0% with Claude Opus 9, for $12.00 per task. Codex peaks at 53.0%, with GPT-9 Astra for $4.00.",
    );
    const close = fixture([SOL, agentRelease("claude-opus-9", "Claude Opus 9", "anthropic", 50.5, 3)]);
    expect(agentLead(pairOf(close))).toBe(
      "Claude Code and Codex are level at the top of Terminal-Bench, within two tasks of each other: 50.5% for Claude Code with Claude Opus 9 ($3.00 per task) and 50.0% for Codex with GPT-9 Sol ($1.20 per task). Claude Code's top run costs 2.5× as much per task as Codex's.",
    );
  });

  test("says which agent leads at which budget, and where paying more stops helping", () => {
    expect(agentBudgetText([codex, claude])).toBe(
      "Codex gives the higher score below $3.00 per task, and Claude Code from $12.00, up to 58.0%. In between, Claude Code and Codex trade the lead, all between 52.0% and 53.0%.",
    );
    expect(agentBudgetText(pairOf(fixture([SOL, OPUS])))).toBe(
      "Below $12.00 per task, Codex gives the higher score; from $12.00, Claude Code does, up to 58.0%.",
    );
    const flat = fixture([SOL, agentRelease("claude-opus-9", "Claude Opus 9", "anthropic", 52, 12)]);
    expect(agentBudgetText(pairOf(flat))).toBe(
      "Below $12.00 per task, Codex gives the higher score; from $12.00, Claude Code does, up to 52.0%. From $1.20 per task, Codex with GPT-9 Sol comes within two tasks of the top score; paying more buys at most 2.0 points.",
    );
  });

  test("gives reasons only for gaps of two tasks or more", () => {
    expect(agentChooseReasons(claude, codex)).toEqual([
      "You want the highest score: with Claude Opus 9 it passes 58.0% of Terminal-Bench, 5.0 points above Codex's best.",
      "Your budget is between $3.00 and $4.00 per task: Claude Code scores higher in that range, up to 52.0% with Claude Sonnet 9 ($3.00).",
    ]);
    expect(agentChooseReasons(codex, claude)).toEqual([
      "Your budget is under $3.00 per task: Codex scores higher at every budget below that, up to 50.0% with GPT-9 Sol ($1.20).",
      "You want shorter output: GPT-9 Sol wrote 24.0k output tokens per task against 240k for Claude Opus 9.",
      "You want quicker runs: GPT-9 Sol took 30 minutes per task against 60 for Claude Opus 9.",
    ]);

    const tokens = { total: 1_000_000, output: 50_000 };
    const level = fixture([
      agentRelease("gpt-9-sol", "GPT-9 Sol", "openai", 50, 1.5, { tokensPerTask: tokens }),
      agentRelease("claude-opus-9", "Claude Opus 9", "anthropic", 51, 1, { tokensPerTask: tokens }),
    ]);
    const [x, y] = pairOf(level);
    expect(agentChooseReasons(y, x)).toEqual([
      "You want a top score for less: with Claude Opus 9 it passes 51.0% for $1.00 per task, within two tasks of Codex's best at $1.50.",
      "At every budget measured, Claude Code scores at least as high for no more per task.",
    ]);
    expect(agentChooseReasons(x, y)).toEqual([
      "Few reasons in this data: its best run, 50.0% with GPT-9 Sol for $1.50 per task, is within two tasks of Claude Code's best, 51.0% with Claude Opus 9 for $1.00.",
    ]);
  });

  test("asks about Gemini CLI only where Antigravity CLI is compared", () => {
    const questions = agentQuestions([codex, claude]);
    expect(questions.map((qa) => qa.q)).toEqual([
      "Is Codex better than Claude Code?",
      "Which is cheaper, Codex or Claude Code?",
      "Which model works best in each agent?",
      "What about Cursor, OpenCode or other coding agents?",
      "How were these agents tested?",
    ]);
    expect(questions[1]!.a).toBe(
      "Each agent's cheapest run within two tasks of its best: GPT-9 Sol in Codex, 50.0% for $1.20 per task; Claude Opus 9 in Claude Code, 58.0% for $12.00 per task. The cheapest run of all is GPT-9 Luna in Codex, $0.30 per task for 40.0%. A run's cost is what it reported spending across its trials, divided by the trials; on a subscription plan you pay the plan instead.",
    );
    expect(questions[2]!.a).toBe(
      "In Codex, GPT-9 Astra scores highest, 53.0% for $4.00 per task; GPT-9 Sol comes within two tasks of it for $1.20. In Claude Code, Claude Opus 9 scores highest, 58.0% for $12.00 per task.",
    );
    expect(questions[4]!.a).toContain(
      "5 runs with current models are compared here; GPT-9 Luna was graded on version 4.0, before 4.1 changed the checks on every task.",
    );
    const all = agentQuestions(harnessGroups(undefined, catalog)).map((qa) => qa.q);
    expect(all).toContain("What happened to Gemini CLI?");
    expect(agentDescription([codex, claude])).toBe(
      "Codex and Claude Code on Terminal-Bench: best runs 53.0% and 58.0%, at $4.00 and $12.00 per task. Cost, tokens and time per model.",
    );
  });
});

describe("agent pages on the dataset", () => {
  test("each agent's runs are its own lab's models in that agent", () => {
    for (const group of harnessGroups()) {
      for (const r of group.runs) {
        expect(r.release.provider).toBe(group.harness.provider);
        expect(r.run.agent).toBe(group.harness.name);
        expect(r.release.deprecated).toBe(false);
      }
    }
  });

  test("pair pages cover every two agents, with reverse and Gemini CLI paths", () => {
    const pairs = agentPairs();
    expect(pairs.map((p) => p.slug)).toEqual([
      "codex-vs-claude-code",
      "antigravity-cli-vs-claude-code",
      "codex-vs-antigravity-cli",
    ]);
    expect(findAgentPair("antigravity-cli-vs-claude-code")?.aliases).toEqual([
      "claude-code-vs-antigravity-cli",
      "gemini-cli-vs-claude-code",
      "claude-code-vs-gemini-cli",
    ]);
    const paths = pairs.flatMap((p) => [p.slug, ...p.aliases]);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("every page's copy builds", () => {
    const sets = [harnessGroups(), ...agentPairs().map((p) => harnessGroups([p.first.id, p.second.id]))];
    const missing = /undefined|NaN|Infinity|null|\[object/;
    for (const set of sets) {
      expect(set.length).toBeGreaterThan(1);
      expect(agentLead(set)).not.toMatch(missing);
      expect(agentBudgetText(set)).not.toMatch(missing);
      expect(agentDescription(set)).not.toMatch(missing);
      expect(agentDescription(set).length).toBeLessThanOrEqual(170);
      for (const qa of agentQuestions(set)) expect(qa.a).not.toMatch(missing);
    }
    for (const pair of agentPairs()) {
      const [a, b] = harnessGroups([pair.first.id, pair.second.id]) as [HarnessGroup, HarnessGroup];
      for (const reasons of [agentChooseReasons(a, b), agentChooseReasons(b, a)]) {
        expect(reasons.length).toBeGreaterThan(0);
        for (const reason of reasons) expect(reason).not.toMatch(missing);
      }
    }
  });
});
