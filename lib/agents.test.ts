import { describe, expect, test } from "bun:test";
import {
  agentBudgetText,
  agentChooseReasons,
  agentDescription,
  agentLead,
  agentPairs,
  agentQuestions,
  bestUnder,
  chartRelease,
  cheapestRun,
  findAgentPair,
  flagship,
  frontierCodeGap,
  harborPick,
  harborRows,
  harness,
  harnessGroups,
  harnessRuns,
  runSegments,
  summarizeGaps,
  type HarnessId,
} from "./agents";
import { buildCatalog, catalog } from "./catalog";
import { release } from "./test-fixtures";
import { AGENT_BENCHMARKS, PROVIDERS, type EffortSlug, type HarborBenchEval, type ModelRelease } from "./types";

type Run = [EffortSlug, number, number, Partial<{ tb: number; fc: number; swe: number }>?];

/** A release whose efforts carry runs in its lab's own agent. */
function agentRelease(
  slug: string,
  name: string,
  provider: ModelRelease["provider"],
  runs: Run[],
  options: Partial<{ supersededOn: string; harbor: Partial<HarborBenchEval> }> = {},
): ModelRelease {
  const base = release(
    slug,
    name,
    provider,
    "2027-01-01",
    options.supersededOn ?? null,
    runs.map(([level, index, cost]) => [level, index + 2, cost * 0.8]),
  );
  return {
    ...base,
    harborEval: options.harbor
      ? {
          agent: PROVIDERS[provider].harness,
          effort: "max",
          accuracy: 50,
          totalCostUsd: 100,
          costPerTrialUsd: 1,
          ...options.harbor,
        }
      : null,
    efforts: base.efforts.map((effort, i) => {
      const [, index, cost, parts = {}] = runs[i]!;
      return {
        ...effort,
        cliEval: {
          harness: PROVIDERS[provider].harness,
          codingAgentScore: index,
          costUsdPerTask: cost,
          frontierCode2: parts.fc ?? index - 1,
          sweAtlas: parts.swe ?? index,
          terminalBench4: parts.tb ?? index + 1,
        },
      };
    }),
  };
}

function fixture(releases: ModelRelease[]) {
  return buildCatalog({
    schemaVersion: 1,
    updatedAt: "2027-03-05T00:00:00.000Z",
    snapshotDate: "2027-03-05",
    sources: [],
    releases,
  });
}

// Codex is cheaper at the low end; Claude Code tops out higher.
const SOL = agentRelease("gpt-9-sol", "GPT-9 Sol", "openai", [
  ["low", 40, 0.3],
  ["medium", 46, 0.6],
  ["high", 50, 1.2],
]);
const ASTRA = agentRelease(
  "gpt-9-astra",
  "GPT-9 Astra",
  "openai",
  [
    ["medium", 51, 2],
    ["high", 53, 4],
  ],
  { harbor: { accuracy: 60, costPerTrialUsd: 4 } },
);
const OLD_ASTRA = agentRelease("gpt-8-astra", "GPT-8 Astra", "openai", [["high", 70, 0.1]], {
  supersededOn: "2027-01-01",
});
const OPUS = agentRelease(
  "claude-opus-9",
  "Claude Opus 9",
  "anthropic",
  [
    ["medium", 49, 2.5],
    ["high", 57, 6],
    ["max", 58, 12],
  ],
  { harbor: { accuracy: 65, costPerTrialUsd: 40 } },
);
const SONNET = agentRelease("claude-sonnet-9", "Claude Sonnet 9", "anthropic", [["high", 52, 3]], {
  harbor: { accuracy: 63, costPerTrialUsd: 10 },
});
const CAT = fixture([SOL, ASTRA, OLD_ASTRA, OPUS, SONNET]);
const groups = (ids: HarnessId[]) => harnessGroups(ids, CAT);

describe("agent runs", () => {
  test("keep current models' runs in their own agent, best model first", () => {
    const runs = harnessRuns(harness("codex"), CAT);
    expect(runs.map((r) => `${r.release.slug}:${r.effort.effortSlug}`)).toEqual([
      "gpt-9-astra:medium",
      "gpt-9-astra:high",
      "gpt-9-sol:low",
      "gpt-9-sol:medium",
      "gpt-9-sol:high",
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

  test("pick the cheapest run, the best under a budget and the most-measured model", () => {
    const runs = harnessRuns(harness("codex"), CAT);
    expect(cheapestRun(runs)?.key).toBe("codex:gpt-9-sol:low");
    expect(bestUnder(runs, 1)?.key).toBe("codex:gpt-9-sol:medium");
    expect(bestUnder(runs, 0.2)).toBeNull();
    expect(flagship(runs).slug).toBe("gpt-9-sol");
  });

  test("group the shared cost frontier by agent", () => {
    const all = groups(["codex", "claude-code"]).flatMap((g) => g.runs);
    // Opus at Medium (49 for $2.50) is under Astra at Medium (51 for $2), so it's off the frontier.
    expect(runSegments(all).map((s) => [s.harness.id, s.runs.map((r) => r.key)])).toEqual([
      ["codex", ["codex:gpt-9-sol:low", "codex:gpt-9-sol:medium", "codex:gpt-9-sol:high", "codex:gpt-9-astra:medium"]],
      ["claude-code", ["claude-code:claude-sonnet-9:high"]],
      ["codex", ["codex:gpt-9-astra:high"]],
      ["claude-code", ["claude-code:claude-opus-9:high", "claude-code:claude-opus-9:max"]],
    ]);
  });

  test("chart a release's runs in the benchmark slots the chart reads", () => {
    const charted = chartRelease(OPUS, harness("claude-code"))!;
    expect(charted.efforts.map((e) => [e.scores.coding, e.costUsdPerTask.total])).toEqual([
      [49, 2.5],
      [57, 6],
      [58, 12],
    ]);
    expect(charted.efforts[1]!.scores.terminalBench4).toBe(58);
    expect(charted.efforts[1]!.scores.intelligence).toBe(57);
    expect(chartRelease(OPUS, harness("codex"))).toBeNull();
    expect(AGENT_BENCHMARKS.map((b) => b.id)).toEqual([
      "coding",
      "terminalBench4",
      "frontierCode2",
      "intelligence",
    ]);
  });

  test("measure FrontierCode against the model alone", () => {
    const gap = frontierCodeGap(harnessRuns(harness("claude-code"), CAT)[0]!);
    // The fixture's model alone scores index + 2; FrontierCode in the agent is index - 1.
    expect(gap.change).toBe(-3);
    expect(summarizeGaps(harnessRuns(harness("codex"), CAT))).toEqual({ count: 5, lower: 5, median: -3 });
  });
});

describe("agent copy", () => {
  const [codex, claude] = groups(["codex", "claude-code"]) as [
    ReturnType<typeof groups>[number],
    ReturnType<typeof groups>[number],
  ];

  test("names the leader and where it passes the other's best", () => {
    expect(agentLead([codex, claude])).toBe(
      "Claude Code scores higher on the Coding Agent Index: 58.0 with Claude Opus 9 at Max, for $12.00 per task. Codex peaks at 53.0, with GPT-9 Astra at High for $4.00. Claude Code passes that for $6.00 per task, with Claude Opus 9 at High (57.0).",
    );
  });

  test("calls scores within a point level and compares their cost", () => {
    const close = fixture([
      SOL,
      agentRelease("claude-opus-9", "Claude Opus 9", "anthropic", [["high", 50.5, 3]]),
    ]);
    expect(agentLead(harnessGroups(["codex", "claude-code"], close))).toBe(
      "Claude Code and Codex top the Coding Agent Index within a point of each other: 50.5 for Claude Code with Claude Opus 9 at High ($3.00 per task) and 50.0 for Codex with GPT-9 Sol at High ($1.20 per task). Claude Code's top run costs 2.5× as much per task.",
    );
  });

  test("says which agent leads at which budget", () => {
    expect(agentBudgetText([codex, claude])).toBe(
      "Codex gives the higher score below $3.00 per task, and Claude Code from $6.00, up to 58.0. In between, Claude Code and Codex trade the lead, all between 52.0 and 53.0.",
    );
    const two = fixture([SOL, OPUS]);
    expect(agentBudgetText(harnessGroups(["codex", "claude-code"], two))).toBe(
      // Opus at Medium (49 for $2.50) is under Sol at High (50 for $1.20).
      "Below $6.00 per task, Codex gives the higher score; from $6.00, Claude Code does, up to 58.0.",
    );
  });

  test("gives reasons only for gaps of two tasks or more", () => {
    expect(agentChooseReasons(claude, codex, CAT)).toEqual([
      "You want the highest score: Claude Opus 9 at Max reaches 58.0 on the Coding Agent Index, 5.0 points above Codex's best.",
      // Terminal-Bench 59.0% against 54.0% is more than two of its 66 tasks.
      "Your work leans on terminal tasks, repository coding and questions about a codebase: its best runs beat Codex's on Terminal-Bench 4.1 (59.0% against 54.0%), FrontierCode 2.0 (57.0% against 52.0%) and SWE-Atlas QnA (58.0% against 53.0%).",
      "You want the most official Terminal-Bench passes: with Claude Opus 9 it passes 65.0% at $40.00 per trial, against 60.0% at $4.00 per trial for Codex with GPT-9 Astra.",
    ]);
    const near = fixture([
      agentRelease("gpt-9-sol", "GPT-9 Sol", "openai", [["high", 50, 1, { tb: 60, fc: 40, swe: 50 }]], {
        harbor: { accuracy: 63, costPerTrialUsd: 2 },
      }),
      agentRelease("claude-opus-9", "Claude Opus 9", "anthropic", [["high", 50, 3, { tb: 62, fc: 41.6, swe: 50 }]], {
        harbor: { accuracy: 65, costPerTrialUsd: 30 },
      }),
    ]);
    const [x, y] = harnessGroups(["codex", "claude-code"], near) as [typeof codex, typeof claude];
    // 2 points of Terminal-Bench is under two tasks; 1.6 of FrontierCode is over.
    expect(agentChooseReasons(y, x, near)).toEqual([
      "Your work leans on repository coding: its best run beats Codex's on FrontierCode 2.0 (41.6% against 40.0%).",
    ]);
    expect(agentChooseReasons(x, y, near)).toEqual([
      "You want a top score for less: GPT-9 Sol at High reaches 50.0 for $1.00 per task, level with Claude Code's best at $3.00.",
      // Opus is off the frontier, so Codex leads at every budget; its runs alone come in under $3.
      "You want runs under $3.00 per task: of the runs measured, only Codex's come in under that, up to 50.0 with GPT-9 Sol at High ($1.00).",
      "You want official Terminal-Bench results for less: with GPT-9 Sol it passes 63.0% at $2.00 per trial, against 65.0% at $30.00 per trial for Claude Code with Claude Opus 9.",
    ]);
  });

  test("compares the leaderboard against each agent's cheapest entry near its best", () => {
    const rows = harborRows(harness("claude-code"), CAT);
    expect(rows.map((r) => r.release.slug)).toEqual(["claude-opus-9", "claude-sonnet-9"]);
    // Sonnet is within two tasks (3.03 points) of Opus and costs a quarter as much.
    expect(harborPick(rows)?.release.slug).toBe("claude-sonnet-9");
    expect(harborPick([])).toBeNull();
  });

  test("asks about Gemini CLI only where Antigravity CLI is compared", () => {
    expect(agentQuestions([codex, claude]).map((qa) => qa.q)).toEqual([
      "Is Codex better than Claude Code?",
      "Which is cheaper, Codex or Claude Code?",
      "Which model works best in each agent?",
      "Does the agent change a model's score?",
      "What about Cursor, OpenCode or other coding agents?",
      "How were these agents tested?",
    ]);
    expect(agentDescription([codex, claude])).toBe(
      "Codex and Claude Code on the Coding Agent Index: best runs 53.0 and 58.0, at $4.00 and $12.00 per task. Every model and effort measured inside Codex CLI and Claude Code, with official Terminal-Bench results.",
    );
  });
});

describe("agent pages on the dataset", () => {
  test("every agent run is the lab's own agent", () => {
    for (const r of catalog.releases) {
      for (const e of r.efforts) {
        if (e.cliEval) expect(`${r.slug}: ${e.cliEval.harness}`).toBe(`${r.slug}: ${PROVIDERS[r.provider].harness}`);
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
    for (const set of sets) {
      expect(set.length).toBeGreaterThan(1);
      expect(agentLead(set)).not.toContain("undefined");
      expect(agentBudgetText(set)).not.toContain("NaN");
      for (const qa of agentQuestions(set)) expect(qa.a).not.toMatch(/undefined|NaN/);
    }
    for (const pair of agentPairs()) {
      const [a, b] = harnessGroups([pair.first.id, pair.second.id]) as [
        ReturnType<typeof harnessGroups>[number],
        ReturnType<typeof harnessGroups>[number],
      ];
      expect(agentChooseReasons(a, b).length).toBeGreaterThan(0);
      expect(agentChooseReasons(b, a).length).toBeGreaterThan(0);
    }
  });
});
