import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import rawDataset from "../data/releases.json";
import {
  buildDataset,
  epochEffort,
  familyKey,
  hasDatasetChanges,
  parseCsv,
  pickTerminalBenchRuns,
  readGameBench,
  readPricing,
  readZipEntries,
  slugify,
  supersessionDates,
  validateDataset,
} from "../scripts/refresh-data";
import type { ReleaseDataset } from "./types";

const dataset = rawDataset as unknown as ReleaseDataset;

test("GameBench 2 reads complete ranked settings and cites the release", () => {
  const complete = {
    model_slug: "google-gemini-4-carbon",
    provider_key: "google",
    reasoning_level: "High",
    ranking_status: "ranked",
    score: 94.8,
    headline_games: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [index, {}])),
    codegen_cost_usd: { mean: 0.8, cost_is_complete: true, evidence_basis: "Standard list-price estimate" },
  };
  const { source, byModel } = readGameBench({
    public_release_id: "gb2-20261119-235af8c04037",
    track_id: "full_freedom/mixed",
    rows: [
      complete,
      { ...complete, reasoning_level: "Medium", codegen_cost_usd: { ...complete.codegen_cost_usd, cost_is_complete: false } },
      { ...complete, reasoning_level: "Low", ranking_status: "provisional" },
      { ...complete, reasoning_level: "Minimal", headline_games: { 0: {} } },
    ],
  });
  expect(source.url).toBe("https://benchmarks.duellab.org/releases/gb2-20261119-235af8c04037/");
  expect([...byModel.get("google:gemini-4-carbon")!.values()]).toEqual([
    { effort: "high", score: 94.8, costPerProgramUsd: 0.8, costBasis: "Standard list-price estimate" },
  ]);
});

type TbSpec = Readonly<{
  leaderboard?: string;
  model: string;
  label: string;
  org?: string;
  agent: string;
  agentVersion?: string;
  effort?: string;
  accuracy: number;
  cost?: number;
  output?: number;
  duration?: number;
  date?: string;
}>;

/** A leaderboard submission file, shaped like harbor-framework/terminal-bench's. */
function tbFile(name: string, spec: TbSpec) {
  const trials = 330;
  return {
    name,
    text: JSON.stringify({
      ...(spec.leaderboard ? { leaderboard: spec.leaderboard } : {}),
      source_filter: {
        agent: spec.agent.toLowerCase(),
        agent_version: spec.agentVersion ?? "1.0.0",
        model_name: spec.model,
        reasoning_effort: spec.effort ?? "high",
      },
      metadata: {
        agent_display: { label: spec.agent, url: "https://example.com/agent" },
        model_display: { label: spec.label, url: "https://example.com/model" },
        model_org: { label: spec.org ?? "OpenAI" },
        date: spec.date ?? "2027-03-01",
        reasoning_effort: spec.effort ?? "high",
      },
      metrics: {
        accuracy: spec.accuracy,
        accuracy_ci95_half_width: 2.75,
        n_trials: trials,
        successes: Math.round((spec.accuracy / 100) * trials),
        output_tokens: spec.output ?? 16_025_130,
        total_tokens: 500_000_000,
        total_cost_usd: spec.cost ?? 349.17,
        avg_trial_duration_sec: spec.duration ?? 1212,
      },
    }),
  };
}

/** A minimal ZIP archive with deflated entries. */
function zipOf(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = deflateRawSync(enc.encode(text));
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    parts.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const size = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...centrals, end];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of all) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

describe("reading the sources", () => {
  test("parseCsv handles quotes, doubled quotes, line breaks, CRLF and a BOM", () => {
    const text = '﻿name,note\r\n"Opus, 5.5","said ""hi""\nthere"\r\n\r\nSol,plain\n';
    expect(parseCsv(text)).toEqual([
      { name: "Opus, 5.5", note: 'said "hi"\nthere' },
      { name: "Sol", note: "plain" },
    ]);
    expect(parseCsv("")).toEqual([]);
  });

  test("readZipEntries returns the wanted files by base name", () => {
    const zip = zipOf({ "README.md": "license", "data/gpqa_diamond.csv": "a,b\n1,2" });
    const entries = readZipEntries(zip, new Set(["gpqa_diamond.csv"]));
    expect([...entries]).toEqual([["gpqa_diamond.csv", "a,b\n1,2"]]);
    expect(() => readZipEntries(new TextEncoder().encode("not a zip at all, honestly"), new Set())).toThrow(
      "Not a ZIP archive",
    );
  });

  test("epochEffort reads the setting from a model version", () => {
    expect(epochEffort("claude-opus-5-5_max")).toEqual({ effort: "max" });
    expect(epochEffort("gemini-4-hydrogen_xhigh")).toEqual({ effort: "xhigh" });
    expect(epochEffort("claude-opus-5")).toEqual({ effort: null });
    expect(epochEffort("gpt-6-2-astra_unknown")).toEqual({ effort: null });
    expect(epochEffort("gpt-6-2-astra-fallback_high")).toBeNull();
    expect(epochEffort("gpt-6-2-astra_pro")).toBeNull();
  });

  test("readPricing finds each lab's LiteLLM key and converts to dollars per million", () => {
    const prices = {
      "claude-opus-9-5": { input_cost_per_token: 4e-6, output_cost_per_token: 2e-5, cache_read_input_token_cost: 2e-7, max_input_tokens: 1_000_000 },
      "gpt-9.1-sol": { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5 },
      "gemini/gemini-9-carbon": { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5, max_input_tokens: 1_048_576 },
    };
    expect(readPricing(prices, "anthropic", "Claude Opus 9.5")).toEqual({
      inputPer1M: 4,
      outputPer1M: 20,
      cachedInputPer1M: 0.2,
      maxInputTokens: 1_000_000,
    });
    expect(readPricing(prices, "openai", "GPT-9.1 Sol")?.cachedInputPer1M).toBeNull();
    expect(readPricing(prices, "google", "Gemini 9 Carbon")?.maxInputTokens).toBe(1_048_576);
    expect(readPricing(prices, "google", "Gemini 9 Neon")).toBeNull();
  });
});

describe("choosing one Terminal-Bench run per model", () => {
  test("prefers the newest dataset version, then the lab's own agent", () => {
    const runs = pickTerminalBenchRuns([
      tbFile("2027-03-05-gpt-9-1-sol-high-codex.json", { model: "openai/gpt-9.1-sol", label: "GPT-9.1 Sol", agent: "Codex", accuracy: 70 }),
      tbFile("2027-03-01-4-1-0-gpt-9-1-sol-high-codex.json", {
        leaderboard: "4-1-0",
        model: "openai/gpt-9.1-sol",
        label: "GPT-9.1 Sol",
        agent: "Codex",
        accuracy: 61.52,
      }),
      tbFile("2027-03-02-4-1-0-claude-opus-9-max-claude-code.json", {
        leaderboard: "4-1-0",
        model: "anthropic/claude-opus-9",
        label: "Opus 9",
        org: "Anthropic",
        agent: "Claude Code",
        accuracy: 60,
      }),
      tbFile("2027-03-09-4-1-0-claude-opus-9-max-mini-swe-agent.json", {
        leaderboard: "4-1-0",
        model: "anthropic/claude-opus-9",
        label: "Opus 9",
        org: "Anthropic",
        agent: "mini-SWE-agent",
        accuracy: 65,
      }),
      tbFile("2027-03-03-4-1-0-grok-9-xai.json", { leaderboard: "4-1-0", model: "xai/grok-9", label: "Grok 9", org: "xAI", agent: "Grok Build", accuracy: 50 }),
      { name: "broken.json", text: "{" },
    ]);
    expect([...runs.keys()].sort()).toEqual(["claude-opus-9", "gpt-9-1-sol"]);
    const sol = runs.get("gpt-9-1-sol")!;
    expect(sol.run).toMatchObject({
      version: "4.1",
      agent: "Codex",
      accuracy: 61.52,
      trials: 330,
      successes: 203,
      costPerTaskUsd: 1.0581,
      tokensPerTask: { total: 1_515_152, output: 48_561 },
      minutesPerTask: 20.2,
      sourceUrl:
        "https://github.com/harbor-framework/terminal-bench/blob/main/leaderboard/submissions/2027-03-01-4-1-0-gpt-9-1-sol-high-codex.json",
    });
    const opus = runs.get("claude-opus-9")!;
    expect(opus.name).toBe("Claude Opus 9");
    expect(opus.run.agent).toBe("Claude Code");
  });

  test("a regrade keeps the minutes of the run it regraded", () => {
    const spec = { model: "openai/gpt-9-terra", label: "GPT-9 Terra", agent: "Codex", accuracy: 50, cost: 800, output: 30_000_000 };
    const runs = pickTerminalBenchRuns([
      tbFile("2027-02-01-gpt-9-terra-high-codex.json", { ...spec, duration: 1800 }),
      tbFile("2027-02-10-4-1-0-gpt-9-terra-high-codex-regrade.json", {
        ...spec,
        leaderboard: "4-1-0",
        accuracy: 51.5,
        duration: 30,
      }),
    ]);
    const terra = runs.get("gpt-9-terra")!;
    expect(terra.run.version).toBe("4.1");
    expect(terra.run.accuracy).toBe(51.5);
    expect(terra.run.minutesPerTask).toBe(30);
  });
});

describe("building releases", () => {
  test("familyKey and supersessionDates follow each lab's model lines", () => {
    expect(familyKey("gpt-6-2-sol")).toBe("gpt-sol");
    expect(familyKey("gemini-3-5-flash-lite")).toBe("gemini-flash-lite");
    expect(slugify("GPT-6.2 Sol")).toBe("gpt-6-2-sol");
    const releases = [
      { slug: "gpt-9-sol", provider: "openai" as const, releaseDate: "2027-01-10" },
      { slug: "gpt-9-1-sol", provider: "openai" as const, releaseDate: "2027-03-01" },
      { slug: "gemini-9-flash", provider: "google" as const, releaseDate: "2027-01-05" },
      { slug: "gemini-9-1-flash", provider: "google" as const, releaseDate: "2027-02-20" },
      { slug: "gemini-9-flash-lite", provider: "google" as const, releaseDate: "2027-01-05" },
    ];
    const dates = supersessionDates(releases, { "gemini-9-flash-lite": { supersededOn: "2027-02-02" } });
    expect(Object.fromEntries(dates)).toEqual({
      "gpt-9-sol": "2027-03-01",
      "gpt-9-1-sol": null,
      "gemini-9-flash": "2027-02-20",
      "gemini-9-1-flash": null,
      "gemini-9-flash-lite": "2027-02-02",
    });
  });

  test("buildDataset joins Terminal-Bench, Epoch AI and LiteLLM by model", () => {
    const header = "Model version,Best score (across scorers),mean_score,stderr,Started at";
    const epoch = new Map([
      [
        "model_metadata.csv",
        "model_version,organization,model_group,date\ngpt-9.1-sol_high,OpenAI,GPT-9.1 Sol,2027-03-01\ngpt-9-sol_high,OpenAI,GPT-9 Sol,2027-01-10\ngpt-9-sol-fallback_high,OpenAI,GPT-9 Sol,2027-01-10",
      ],
      [
        "gpqa_diamond.csv",
        `${header}\ngpt-9.1-sol_high,0.85,0.84,0.02,2027-03-02T10:00:00Z\ngpt-9-sol_high,,0.8,0.02,2027-01-12T10:00:00Z\ngpt-9-sol-fallback_high,0.99,0.99,0.01,2027-01-13T10:00:00Z`,
      ],
      ["mirrorcode.csv", header],
      ["frontiermath_tiers_1_3_v2.csv", header],
    ]);
    const ds = buildDataset(
      {
        tb: [
          tbFile("2027-03-01-4-1-0-gpt-9-1-sol-high-codex.json", {
            leaderboard: "4-1-0",
            model: "openai/gpt-9.1-sol",
            label: "GPT-9.1 Sol",
            agent: "Codex",
            accuracy: 61.52,
          }),
          tbFile("2027-01-10-gpt-9-sol-high-codex.json", {
            model: "openai/gpt-9-sol",
            label: "GPT-9 Sol",
            agent: "Codex",
            accuracy: 52,
            date: "2027-01-10",
          }),
        ],
        epoch,
        prices: { "gpt-9.1-sol": { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5, max_input_tokens: 922_000 } },
      },
      "2027-03-05",
    );
    const mine = ds.releases.filter((r) => r.slug.startsWith("gpt-9"));
    expect(mine.map((r) => [r.slug, r.name, r.releaseDate, r.supersededOn, r.deprecated])).toEqual([
      ["gpt-9-1-sol", "GPT-9.1 Sol", "2027-03-01", null, false],
      ["gpt-9-sol", "GPT-9 Sol", "2027-01-10", "2027-03-01", true],
    ]);
    const [sol91, sol] = mine as [ReleaseDataset["releases"][number], ReleaseDataset["releases"][number]];
    expect(sol91.pricing).toEqual({ inputPer1M: 2, outputPer1M: 10, cachedInputPer1M: null, maxInputTokens: 922_000 });
    expect(sol91.terminalBench?.accuracy).toBe(61.52);
    expect(sol91.epoch).toEqual([
      { benchmark: "gpqaDiamond", effort: "high", score: 85, stderr: 2, runOn: "2027-03-02" },
    ]);
    // The mean stands in for a missing best score; the fallback rerun is left out.
    expect(sol.epoch.map((s) => s.score)).toEqual([80]);
    expect(sol.pricing).toBeNull();
    expect(ds.sources.map((s) => s.id)).toEqual(["terminal-bench", "epoch-ai", "litellm"]);
  });
});

describe("refresh invariants", () => {
  test("the published dataset validates", () => {
    expect(() => validateDataset(dataset)).not.toThrow();
    const broken = {
      ...dataset,
      releases: [{ ...dataset.releases[0]!, deprecated: true }, ...dataset.releases.slice(1)],
    };
    expect(() => validateDataset(broken)).toThrow("deprecated and supersededOn disagree");
  });

  test("hasDatasetChanges ignores timestamp-only differences", () => {
    const sameContent: ReleaseDataset = {
      ...dataset,
      updatedAt: "2026-12-31T23:59:59Z",
      snapshotDate: "2026-12-31",
    };
    expect(hasDatasetChanges(dataset, sameContent)).toBe(false);
    expect(hasDatasetChanges(null, dataset)).toBe(true);
  });

  test("hasDatasetChanges detects a regraded score and a changed source", () => {
    const index = dataset.releases.findIndex((r) => r.terminalBench);
    const target = dataset.releases[index]!;
    const regraded: ReleaseDataset = {
      ...dataset,
      releases: dataset.releases.map((r, i) =>
        i === index ? { ...target, terminalBench: { ...target.terminalBench!, accuracy: target.terminalBench!.accuracy + 0.5 } } : r,
      ),
    };
    validateDataset(regraded);
    expect(hasDatasetChanges(dataset, regraded)).toBe(true);
    const relicensed: ReleaseDataset = {
      ...dataset,
      sources: dataset.sources.map((s, i) => (i === 0 ? { ...s, license: "Other" } : s)),
    };
    expect(hasDatasetChanges(dataset, relicensed)).toBe(true);
  });
});
