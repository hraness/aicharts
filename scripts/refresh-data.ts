// Builds data/releases.json from three openly licensed sources:
// - Terminal-Bench leaderboard submissions (Apache-2.0): one agent run per model,
//   with accuracy, cost and tokens per trial.
// - Epoch AI's benchmark data (CC BY 4.0): GPQA Diamond, MirrorCode and
//   FrontierMath Tiers 1–3 scores, and release dates.
// - LiteLLM's model price list (MIT): list API prices and input limits.
//
//   bun run scripts/refresh-data.ts            fetch, and write if anything changed
//   bun run scripts/refresh-data.ts --force    fetch and write
//   bun run scripts/refresh-data.ts --check    validate the committed file only
//   bun run scripts/refresh-data.ts --from-raw <dir>
//       read <dir>/tb/*.json, <dir>/epoch/benchmark_data.zip and
//       <dir>/litellm/prices.json instead of fetching
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import type {
  DataSource,
  EffortSlug,
  EpochBenchmarkId,
  EpochScore,
  ModelPricing,
  ModelRelease,
  ProviderId,
  ReleaseDataset,
  TerminalBenchRun,
} from "../lib/types";

const DATA_PATH = path.join(import.meta.dir, "..", "data", "releases.json");
const TARGET_PROVIDERS = new Set<ProviderId>(["anthropic", "openai", "google"]);
const MIN_RELEASE_DATE = "2026-06-01";
const USER_AGENT = "aicharts-refresh/3.0 (+https://aicharts.io)";

const TB_LISTING_URL =
  "https://api.github.com/repos/harbor-framework/terminal-bench/contents/leaderboard/submissions";
const TB_FILE_URL = "https://github.com/harbor-framework/terminal-bench/blob/main/leaderboard/submissions/";
const EPOCH_ZIP_URL = "https://epoch.ai/data/benchmark_data.zip";
const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export const SOURCES: readonly DataSource[] = [
  {
    id: "terminal-bench",
    name: "Terminal-Bench leaderboard",
    url: "https://github.com/harbor-framework/terminal-bench/tree/main/leaderboard",
    license: "Apache-2.0",
    licenseUrl: "https://github.com/harbor-framework/terminal-bench/blob/main/LICENSE",
    attribution: "Terminal-Bench leaderboard submissions, harbor-framework/terminal-bench, Apache License 2.0.",
    covers:
      "Each model's agent run: accuracy, confidence interval, trials, cost, tokens and minutes per trial, agent and effort.",
  },
  {
    id: "epoch-ai",
    name: "Epoch AI, Capabilities & benchmarking",
    url: "https://epoch.ai/benchmarks",
    license: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution:
      "Epoch AI, ‘Capabilities & benchmarking’. Published online at epoch.ai. Retrieved from ‘https://epoch.ai/benchmarks’ [online resource].",
    covers: "GPQA Diamond, MirrorCode and FrontierMath Tiers 1–3 scores, and release dates.",
  },
  {
    id: "litellm",
    name: "LiteLLM model prices",
    url: "https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json",
    license: "MIT",
    licenseUrl: "https://github.com/BerriAI/litellm/blob/main/LICENSE",
    attribution: "LiteLLM model_prices_and_context_window.json, Copyright (c) 2023 Berri AI, MIT License.",
    covers: "List API prices per million tokens and maximum input tokens.",
  },
];

/**
 * Hand-kept facts the sources lack: launch pages, a release date for a model
 * no source has scored yet, and supersessions the family rule cannot see.
 */
type Curation = Readonly<{
  announcementUrl?: string;
  releaseDate?: string;
  /** Overrides the family rule; null keeps a release current. */
  supersededOn?: string | null;
}>;

const CURATION: Readonly<Record<string, Curation>> = {
  "gemini-4-neon": { announcementUrl: "https://deepmind.google/models/gemini/", releaseDate: "2026-11-18" },
  "gpt-6-2-astra": { announcementUrl: "https://developers.openai.com/api/docs/models/gpt-6.2-astra" },
  "gpt-6-2-sol": { announcementUrl: "https://developers.openai.com/api/docs/models/gpt-6.2-sol" },
  "gemini-4-hydrogen": {
    announcementUrl:
      "https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-hydrogen/",
  },
  "claude-fable-5-2": { announcementUrl: "https://www.anthropic.com/claude-fable-and-mythos-5-2" },
  "gemini-4-carbon": {
    announcementUrl:
      "https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-carbon/",
  },
  "gpt-6-1-terra": { announcementUrl: "https://developers.openai.com/api/docs/models/gpt-6.1-terra" },
  "claude-haiku-5-5": { announcementUrl: "https://www.anthropic.com/claude-haiku-5-5" },
  "gemini-4-argon": {
    announcementUrl: "https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/",
  },
  "gpt-6-1-sol": { announcementUrl: "https://developers.openai.com/api/docs/models/gpt-6.1-sol" },
  "claude-sonnet-5-5": { announcementUrl: "https://www.anthropic.com/claude-sonnet-5-5" },
  "claude-opus-5-5": { announcementUrl: "https://www.anthropic.com/claude-opus-5-5" },
  "gpt-6-sol": { announcementUrl: "https://developers.openai.com/api/docs/models/gpt-6-sol" },
  "gpt-6-luna": { announcementUrl: "https://developers.openai.com/api/docs/models/gpt-6-luna" },
  "gpt-6-astra": { announcementUrl: "https://openai.com/index/gpt-6-astra/" },
  // Gemini 4 Hydrogen took over the Flash line's place in Google's lineup.
  "gemini-3-8-flash": {
    announcementUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash",
    supersededOn: "2026-11-12",
  },
  "claude-fable-5-1": { announcementUrl: "https://www.anthropic.com/claude-fable-and-mythos-5-1" },
  "claude-opus-5": { announcementUrl: "https://www.anthropic.com/news/claude-opus-5" },
  "gemini-3-5-flash-lite": {
    announcementUrl:
      "https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/",
  },
  "gemini-3-6-flash": {
    announcementUrl:
      "https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/",
  },
  "gpt-5-6-terra": { announcementUrl: "https://developers.openai.com/api/docs/models/gpt-5.6-terra" },
  "gpt-5-6-luna": { announcementUrl: "https://developers.openai.com/api/docs/models/gpt-5.6-luna" },
};

/** Epoch model groups that are not separate API releases. */
const EXCLUDED_EPOCH_GROUPS = new Set(["GPT-6 Luna Decisions"]);

const EPOCH_FILES: Readonly<Record<string, EpochBenchmarkId>> = {
  "mirrorcode.csv": "mirrorCode",
  "gpqa_diamond.csv": "gpqaDiamond",
  "frontiermath_tiers_1_3_v2.csv": "frontierMath",
};
const EPOCH_ORDER: readonly EpochBenchmarkId[] = ["mirrorCode", "gpqaDiamond", "frontierMath"];

const EFFORTS: readonly EffortSlug[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const PROVIDER_ORDER: Readonly<Record<ProviderId, number>> = { google: 0, openai: 1, anthropic: 2 };

const round = (n: number, places: number) => Number(n.toFixed(places));
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const httpsOrNull = (s: unknown) => (typeof s === "string" && s.startsWith("https://") ? s : null);

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.\s/]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function effortSlug(raw: unknown): EffortSlug | null {
  const s = typeof raw === "string" ? raw.toLowerCase() : "";
  return (EFFORTS as readonly string[]).includes(s) ? (s as EffortSlug) : null;
}

// ---------------------------------------------------------------- ZIP and CSV

/**
 * Reads the named files out of a ZIP archive (stored or deflated entries,
 * matched by base name). Enough for Epoch's download; no ZIP64.
 */
export function readZipEntries(zip: Uint8Array, wanted: ReadonlySet<string>): Map<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("Not a ZIP archive");
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const out = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("Bad ZIP central directory");
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extraLength + commentLength;
    const base = name.split("/").pop() ?? name;
    if (!wanted.has(base) || out.has(base)) continue;
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error(`Bad ZIP entry ${name}`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(start, start + compressedSize);
    if (method === 0) out.set(base, decoder.decode(data));
    else if (method === 8) out.set(base, decoder.decode(inflateRawSync(data, { maxOutputLength: 64 << 20 })));
    else throw new Error(`Unsupported ZIP compression ${method} on ${name}`);
  }
  return out;
}

/** RFC 4180 CSV: quoted fields may hold commas, doubled quotes and line breaks. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (source[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  return body
    .filter((r) => r.some((f) => f !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// ---------------------------------------------------------- Terminal-Bench

type TbFile = Readonly<{ name: string; text: string }>;

type TbCandidate = Readonly<{
  file: string;
  slug: string;
  name: string;
  provider: ProviderId;
  modelUrl: string | null;
  releaseDate: string | null;
  regrade: boolean;
  /** Same trials, same bill: a regrade shares these with the run it regraded. */
  fingerprint: string;
  durationSec: number | null;
  run: TerminalBenchRun;
}>;

const TB_ORGS: Readonly<Record<string, ProviderId>> = {
  Anthropic: "anthropic",
  OpenAI: "openai",
  Google: "google",
};

function tbVersion(leaderboard: unknown): string {
  const match = typeof leaderboard === "string" ? /^(\d+)-(\d+)-\d+$/.exec(leaderboard) : null;
  return match ? `${match[1]}.${match[2]}` : "4.0";
}

function parseTbFile(file: TbFile): TbCandidate | null {
  // biome-ignore lint/suspicious/noExplicitAny: upstream JSON, checked field by field below
  let j: any;
  try {
    j = JSON.parse(file.text);
  } catch {
    console.warn(`! Skipped ${file.name}: not JSON`);
    return null;
  }
  const meta = j?.metadata ?? {};
  const filter = j?.source_filter ?? {};
  const m = j?.metrics ?? {};
  const provider = TB_ORGS[meta?.model_org?.label];
  const modelKey = typeof filter.model_name === "string" ? filter.model_name : "";
  if (!provider || !modelKey) return null;
  const trials = Number(m.n_trials);
  const accuracy = Number(m.accuracy);
  if (!(trials > 0) || !Number.isFinite(accuracy)) {
    console.warn(`! Skipped ${file.name}: no trials or accuracy`);
    return null;
  }
  const label = String(meta?.model_display?.label ?? "").trim();
  const name = provider === "anthropic" && label && !/^claude\b/i.test(label) ? `Claude ${label}` : label;
  const cost = Number(m.total_cost_usd);
  const output = Number(m.output_tokens);
  const total = Number(m.total_tokens);
  const duration = Number(m.avg_trial_duration_sec);
  const agentVersion = typeof filter.agent_version === "string" ? filter.agent_version : null;
  const effort = effortSlug(meta.reasoning_effort ?? filter.reasoning_effort);
  return {
    file: file.name,
    slug: slugify(modelKey.replace(/^[a-z]+\//, "")),
    name,
    provider,
    modelUrl: httpsOrNull(meta?.model_display?.url),
    releaseDate: isDate(meta.date) ? meta.date : null,
    regrade: /regrade/i.test(file.name),
    fingerprint: [modelKey, agentVersion, effort, trials, m.output_tokens, m.total_cost_usd].join("|"),
    durationSec: duration > 0 ? duration : null,
    run: {
      version: tbVersion(j.leaderboard),
      agent: String(meta?.agent_display?.label ?? filter.agent ?? "Unknown agent"),
      agentVersion,
      agentUrl: httpsOrNull(meta?.agent_display?.url),
      effort,
      accuracy: round(accuracy, 2),
      ci95: Number.isFinite(Number(m.accuracy_ci95_half_width)) ? round(Number(m.accuracy_ci95_half_width), 2) : null,
      trials,
      successes: Number.isFinite(Number(m.successes)) ? Number(m.successes) : Math.round((accuracy / 100) * trials),
      costPerTaskUsd: cost > 0 ? round(cost / trials, 4) : null,
      tokensPerTask: {
        total: total > 0 ? Math.round(total / trials) : 0,
        output: output > 0 ? Math.round(output / trials) : 0,
      },
      minutesPerTask: null,
      sourceUrl: `${TB_FILE_URL}${encodeURIComponent(file.name)}`,
    },
  };
}

/**
 * One run per model: the newest dataset version, then the lab's own agent,
 * then the newest submission. A regrade reports the regrade job's duration,
 * so it borrows the minutes of the run it regraded.
 */
export function pickTerminalBenchRuns(files: readonly TbFile[]): Map<string, TbCandidate> {
  const candidates = files.map(parseTbFile).filter((c): c is TbCandidate => c !== null);
  const ownAgent: Readonly<Record<ProviderId, string>> = {
    anthropic: "Claude Code",
    openai: "Codex",
    google: "Antigravity CLI",
  };
  const versionNumber = (v: string) => {
    const [major = 0, minor = 0] = v.split(".").map(Number);
    return major * 1000 + minor;
  };
  const bySlug = new Map<string, TbCandidate[]>();
  for (const c of candidates) bySlug.set(c.slug, [...(bySlug.get(c.slug) ?? []), c]);
  const picked = new Map<string, TbCandidate>();
  for (const [slug, list] of bySlug) {
    const sorted = [...list].sort(
      (a, b) =>
        versionNumber(b.run.version) - versionNumber(a.run.version) ||
        Number(b.run.agent === ownAgent[b.provider]) - Number(a.run.agent === ownAgent[a.provider]) ||
        b.file.localeCompare(a.file),
    );
    const best = sorted[0]!;
    const original = best.regrade
      ? list.find((c) => !c.regrade && c.fingerprint === best.fingerprint)
      : best;
    const seconds = original?.durationSec ?? null;
    picked.set(slug, {
      ...best,
      run: { ...best.run, minutesPerTask: seconds === null ? null : round(seconds / 60, 1) },
    });
  }
  return picked;
}

// ------------------------------------------------------------------- Epoch AI

type EpochGroup = {
  name: string;
  provider: ProviderId;
  releaseDate: string | null;
  scores: Map<string, EpochScore>;
};

const EPOCH_ORGS: Readonly<Record<string, ProviderId>> = {
  Anthropic: "anthropic",
  OpenAI: "openai",
  Google: "google",
  "Google DeepMind": "google",
};

/**
 * Splits an Epoch model version such as "claude-opus-5-5_max" into its
 * setting. Fallback reruns, Pro modes and short-context variants are not
 * the release's own runs and are left out.
 */
export function epochEffort(version: string): { effort: EffortSlug | null } | null {
  const cut = version.lastIndexOf("_");
  const base = cut === -1 ? version : version.slice(0, cut);
  const suffix = cut === -1 ? "" : version.slice(cut + 1).toLowerCase();
  if (base.includes("-fallback")) return null;
  if (suffix === "" || suffix === "unknown") return { effort: null };
  const effort = effortSlug(suffix);
  return effort ? { effort } : null;
}

export function readEpoch(files: ReadonlyMap<string, string>): Map<string, EpochGroup> {
  const metadata = files.get("model_metadata.csv");
  if (!metadata) throw new Error("Epoch download has no model_metadata.csv");
  const versions = new Map<string, Readonly<{ group: string; provider: ProviderId; date: string | null }>>();
  for (const row of parseCsv(metadata)) {
    const provider = EPOCH_ORGS[row.organization ?? ""];
    const group = (row.model_group ?? "").trim();
    if (!row.model_version || !provider || !group || EXCLUDED_EPOCH_GROUPS.has(group)) continue;
    versions.set(row.model_version, { group, provider, date: isDate(row.date) ? row.date : null });
  }

  const groups = new Map<string, EpochGroup>();
  const groupFor = (name: string, provider: ProviderId, date: string | null) => {
    const slug = slugify(name);
    const group = groups.get(slug) ?? { name, provider, releaseDate: null, scores: new Map() };
    if (date && (!group.releaseDate || date < group.releaseDate)) group.releaseDate = date;
    groups.set(slug, group);
    return group;
  };
  for (const v of versions.values()) groupFor(v.group, v.provider, v.date);

  for (const [file, benchmark] of Object.entries(EPOCH_FILES)) {
    const text = files.get(file);
    if (!text) throw new Error(`Epoch download has no ${file}`);
    for (const row of parseCsv(text)) {
      const version = row["Model version"] ?? "";
      const known = versions.get(version);
      const setting = epochEffort(version);
      if (!known || !setting) continue;
      const best = Number.parseFloat(row["Best score (across scorers)"] ?? "");
      const mean = Number.parseFloat(row.mean_score ?? "");
      const value = Number.isFinite(best) ? best : mean;
      if (!Number.isFinite(value) || value < 0 || value > 1) continue;
      const stderr = Number.parseFloat(row.stderr ?? "");
      const runOn = isDate((row["Started at"] ?? "").slice(0, 10)) ? row["Started at"]!.slice(0, 10) : null;
      const score: EpochScore = {
        benchmark,
        effort: setting.effort,
        score: round(value * 100, 1),
        stderr: Number.isFinite(stderr) ? round(stderr * 100, 1) : null,
        runOn,
      };
      const group = groupFor(known.group, known.provider, known.date);
      const key = `${benchmark}:${setting.effort ?? "default"}`;
      const held = group.scores.get(key);
      // A rerun of the same setting replaces the older run.
      if (!held || (score.runOn ?? "") > (held.runOn ?? "")) group.scores.set(key, score);
    }
  }
  return groups;
}

function sortedScores(scores: Iterable<EpochScore>): EpochScore[] {
  const level = (e: EffortSlug | null) => (e === null ? -1 : EFFORTS.indexOf(e));
  return [...scores].sort(
    (a, b) => EPOCH_ORDER.indexOf(a.benchmark) - EPOCH_ORDER.indexOf(b.benchmark) || level(a.effort) - level(b.effort),
  );
}

// -------------------------------------------------------------------- LiteLLM

/** LiteLLM's keys: claude-opus-5-5, gpt-6.2-sol, gemini/gemini-4-carbon. */
function litellmKeys(provider: ProviderId, name: string): string[] {
  const dashed = name.toLowerCase().trim().replace(/\s+/g, "-");
  if (provider === "anthropic") return [dashed.replace(/\./g, "-"), dashed];
  if (provider === "openai") return [dashed, `openai/${dashed}`];
  return [`gemini/${dashed}`, dashed];
}

export function readPricing(prices: Record<string, unknown>, provider: ProviderId, name: string): ModelPricing | null {
  for (const key of litellmKeys(provider, name)) {
    // biome-ignore lint/suspicious/noExplicitAny: upstream JSON, checked below
    const entry = prices[key] as any;
    const input = Number(entry?.input_cost_per_token);
    const output = Number(entry?.output_cost_per_token);
    if (!(input > 0) || !(output > 0)) continue;
    const cached = Number(entry.cache_read_input_token_cost);
    const maxInput = Number(entry.max_input_tokens);
    return {
      inputPer1M: round(input * 1e6, 4),
      outputPer1M: round(output * 1e6, 4),
      cachedInputPer1M: cached > 0 ? round(cached * 1e6, 4) : null,
      maxInputTokens: maxInput > 0 ? maxInput : null,
    };
  }
  return null;
}

// ------------------------------------------------------------------- Releases

/** A lab's model line: "claude-opus", "gpt-sol", "gemini-flash-lite". */
export function familyKey(slug: string): string {
  return slug
    .split("-")
    .filter((part) => !/^\d+$/.test(part))
    .join("-");
}

/**
 * Each release is superseded on the day the next release of its line came
 * out, unless curation says otherwise.
 */
export function supersessionDates(
  releases: readonly Readonly<{ slug: string; provider: ProviderId; releaseDate: string }>[],
  curation: Readonly<Record<string, Curation>> = CURATION,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const r of releases) {
    const curated = curation[r.slug];
    if (curated && "supersededOn" in curated) {
      out.set(r.slug, curated.supersededOn ?? null);
      continue;
    }
    const next = releases
      .filter(
        (o) => o.provider === r.provider && familyKey(o.slug) === familyKey(r.slug) && o.releaseDate > r.releaseDate,
      )
      .map((o) => o.releaseDate)
      .sort()[0];
    out.set(r.slug, next ?? null);
  }
  return out;
}

export type RawInputs = Readonly<{
  tb: readonly TbFile[];
  epoch: ReadonlyMap<string, string>;
  prices: Record<string, unknown>;
}>;

export function buildDataset(raw: RawInputs, snapshotDate: string): ReleaseDataset {
  const tb = pickTerminalBenchRuns(raw.tb);
  const epoch = readEpoch(raw.epoch);

  const slugs = new Set<string>([
    ...tb.keys(),
    ...[...epoch].filter(([, g]) => g.scores.size > 0).map(([slug]) => slug),
    ...Object.keys(CURATION).filter((slug) => epoch.has(slug) || CURATION[slug]?.releaseDate),
  ]);

  type Draft = Omit<ModelRelease, "deprecated" | "supersededOn">;
  const drafts: Draft[] = [];
  for (const slug of slugs) {
    const run = tb.get(slug);
    const group = epoch.get(slug);
    const curated = CURATION[slug] ?? {};
    const provider = run?.provider ?? group?.provider;
    const name = group?.name ?? run?.name;
    const dates = [run?.releaseDate, group?.releaseDate].filter(isDate).sort();
    const releaseDate = curated.releaseDate ?? dates[0];
    if (!provider || !name || !releaseDate) {
      console.warn(`! Skipped ${slug}: no ${!provider ? "lab" : !name ? "name" : "release date"}`);
      continue;
    }
    if (releaseDate < MIN_RELEASE_DATE) continue;
    if (run && group && run.name && slugify(run.name) !== slug) {
      console.warn(`! ${slug}: Terminal-Bench calls it "${run.name}", Epoch "${group.name}"`);
    }
    drafts.push({
      slug,
      name,
      provider,
      releaseDate,
      announcementUrl: curated.announcementUrl ?? run?.modelUrl ?? null,
      pricing: readPricing(raw.prices, provider, name),
      terminalBench: run?.run ?? null,
      epoch: sortedScores(group?.scores.values() ?? []),
    });
  }

  const superseded = supersessionDates(drafts);
  const releases: ModelRelease[] = drafts.map((d) => {
    const supersededOn = superseded.get(d.slug) ?? null;
    return {
      slug: d.slug,
      name: d.name,
      provider: d.provider,
      releaseDate: d.releaseDate,
      deprecated: supersededOn !== null,
      supersededOn,
      announcementUrl: d.announcementUrl,
      pricing: d.pricing,
      terminalBench: d.terminalBench,
      epoch: d.epoch,
    };
  });
  releases.sort(
    (a, b) =>
      b.releaseDate.localeCompare(a.releaseDate) ||
      (b.terminalBench?.accuracy ?? -1) - (a.terminalBench?.accuracy ?? -1) ||
      PROVIDER_ORDER[a.provider] - PROVIDER_ORDER[b.provider] ||
      a.slug.localeCompare(b.slug),
  );

  return {
    schemaVersion: 2,
    updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    snapshotDate,
    sources: SOURCES,
    releases,
  };
}

export function hasDatasetChanges(existing: ReleaseDataset | null, next: ReleaseDataset): boolean {
  if (!existing) return true;
  if (existing.schemaVersion !== next.schemaVersion) return true;
  return (
    JSON.stringify(existing.releases) !== JSON.stringify(next.releases) ||
    JSON.stringify(existing.sources) !== JSON.stringify(next.sources)
  );
}

export function validateDataset(ds: ReleaseDataset): void {
  if (ds.schemaVersion !== 2) throw new Error("Unexpected schemaVersion");
  if (!Array.isArray(ds.releases) || ds.releases.length < 10) {
    throw new Error(`Expected at least 10 releases, got ${ds.releases?.length}`);
  }
  const ids = new Set(ds.sources.map((s) => s.id));
  for (const id of ["terminal-bench", "epoch-ai", "litellm"] as const) {
    if (!ids.has(id)) throw new Error(`Missing source ${id}`);
  }
  const withRuns = ds.releases.filter((r) => r.terminalBench).length;
  if (withRuns < 10) throw new Error(`Expected at least 10 Terminal-Bench runs, got ${withRuns}`);
  const seen = new Set<string>();
  ds.releases.forEach((r, i) => {
    const at = `on ${r.slug}`;
    if (seen.has(r.slug)) throw new Error(`Duplicate release slug: ${r.slug}`);
    seen.add(r.slug);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug)) throw new Error(`Bad slug ${at}`);
    if (i > 0 && ds.releases[i - 1]!.releaseDate < r.releaseDate) {
      throw new Error(`Releases out of chronological order at ${r.slug}`);
    }
    if (!TARGET_PROVIDERS.has(r.provider)) throw new Error(`Unexpected provider ${r.provider} ${at}`);
    if (!isDate(r.releaseDate)) throw new Error(`Bad release date ${at}`);
    if (r.deprecated !== (r.supersededOn !== null)) throw new Error(`deprecated and supersededOn disagree ${at}`);
    if (r.supersededOn !== null && !(isDate(r.supersededOn) && r.supersededOn > r.releaseDate)) {
      throw new Error(`Bad supersededOn ${at}`);
    }
    if (r.announcementUrl !== null && !r.announcementUrl.startsWith("https://")) {
      throw new Error(`Bad announcement URL ${at}`);
    }
    if (r.pricing && !(r.pricing.inputPer1M > 0 && r.pricing.outputPer1M > 0)) {
      throw new Error(`Bad pricing ${at}`);
    }
    const run = r.terminalBench;
    if (run) {
      if (!(run.accuracy >= 0 && run.accuracy <= 100)) throw new Error(`Bad accuracy ${at}`);
      if (!(run.trials > 0 && run.successes >= 0 && run.successes <= run.trials)) {
        throw new Error(`Bad trial counts ${at}`);
      }
      if (run.costPerTaskUsd !== null && !(run.costPerTaskUsd > 0)) throw new Error(`Bad cost ${at}`);
      if (!(run.tokensPerTask.output >= 0 && run.tokensPerTask.total >= run.tokensPerTask.output)) {
        throw new Error(`Bad token counts ${at}`);
      }
      if (!run.sourceUrl.startsWith("https://github.com/")) throw new Error(`Bad run source ${at}`);
    }
    for (const s of r.epoch) {
      if (!EPOCH_ORDER.includes(s.benchmark)) throw new Error(`Unknown Epoch benchmark ${at}`);
      if (!(s.score >= 0 && s.score <= 100)) throw new Error(`Bad ${s.benchmark} score ${at}`);
    }
  });
}

// ---------------------------------------------------------------------- Input

function loadExistingDataset(dataPath: string): ReleaseDataset | null {
  if (!existsSync(dataPath)) return null;
  try {
    return JSON.parse(readFileSync(dataPath, "utf8")) as ReleaseDataset;
  } catch {
    return null;
  }
}

async function fetchOk(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

async function fetchInputs(): Promise<RawInputs> {
  const github: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) github.Authorization = `Bearer ${token}`;
  const listing = (await (await fetchOk(TB_LISTING_URL, github)).json()) as Array<{
    name: string;
    download_url: string | null;
  }>;
  const wanted = listing.filter((i) => i.download_url && i.name.endsWith(".json"));
  const tb: TbFile[] = [];
  // A few at a time: the files are small and raw.githubusercontent.com is shared.
  for (let i = 0; i < wanted.length; i += 8) {
    const batch = await Promise.all(
      wanted.slice(i, i + 8).map(async (item) => ({
        name: item.name,
        text: await (await fetchOk(item.download_url!)).text(),
      })),
    );
    tb.push(...batch);
  }
  const zip = new Uint8Array(await (await fetchOk(EPOCH_ZIP_URL)).arrayBuffer());
  const prices = (await (await fetchOk(LITELLM_URL)).json()) as Record<string, unknown>;
  return { tb, epoch: readZipEntries(zip, epochFileNames()), prices };
}

function epochFileNames(): Set<string> {
  return new Set(["model_metadata.csv", ...Object.keys(EPOCH_FILES)]);
}

function readInputs(dir: string): RawInputs {
  const tbDir = path.join(dir, "tb");
  const tb = readdirSync(tbDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(tbDir, name), "utf8") }));
  const zip = new Uint8Array(readFileSync(path.join(dir, "epoch", "benchmark_data.zip")));
  const prices = JSON.parse(readFileSync(path.join(dir, "litellm", "prices.json"), "utf8")) as Record<
    string,
    unknown
  >;
  return { tb, epoch: readZipEntries(zip, epochFileNames()), prices };
}

function describe(ds: ReleaseDataset): string {
  const runs = ds.releases.filter((r) => r.terminalBench).length;
  const scores = ds.releases.reduce((n, r) => n + r.epoch.length, 0);
  const priced = ds.releases.filter((r) => r.pricing).length;
  return `${ds.releases.length} releases, ${runs} Terminal-Bench runs, ${scores} Epoch scores, ${priced} priced`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const existing = JSON.parse(readFileSync(DATA_PATH, "utf8")) as ReleaseDataset;
    validateDataset(existing);
    console.log(
      `✓ Checked data/releases.json: ${describe(existing)}; latest ${existing.releases[0]?.name} (${existing.releases[0]?.releaseDate}).`,
    );
    process.exit(0);
  }

  const fromRawIdx = args.indexOf("--from-raw");
  const fromRawDir = fromRawIdx >= 0 ? (args[fromRawIdx + 1] ?? null) : null;
  const forceWrite = args.includes("--force");
  const today = new Date().toISOString().slice(0, 10);

  const existing = loadExistingDataset(DATA_PATH);
  const raw = fromRawDir ? readInputs(fromRawDir) : await fetchInputs();
  const dataset = buildDataset(raw, today);
  validateDataset(dataset);

  if (!forceWrite && !hasDatasetChanges(existing, dataset)) {
    console.log(`✓ Checked upstream (${describe(dataset)}): no release or benchmark updates.`);
    process.exit(0);
  }

  mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  writeFileSync(DATA_PATH, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(`✓ Wrote data/releases.json: ${describe(dataset)} (snapshot ${dataset.snapshotDate}).`);
}
