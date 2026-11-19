import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type {
  CliHarnessEval,
  EffortPoint,
  EffortSlug,
  HarborBenchEval,
  ModelRelease,
  ProviderId,
  ReleaseDataset,
} from "../lib/types";

const DATA_PATH = path.join(import.meta.dir, "..", "data", "releases.json");
const TARGET_PROVIDERS = new Set<ProviderId>(["anthropic", "openai", "google"]);
const MIN_RELEASE_DATE = "2026-07-01";
const USER_AGENT = "aicharts-refresh/2.1 (+https://aicharts.io)";
const HARBOR_PROVIDER_RE =
  /(anthropic|claude|openai|gpt|codex|google|gemini|antigravity)/i;

const RELEASE_CURATION: Readonly<
  Record<
    string,
    Readonly<{
      announcementUrl: string;
      summary: string;
      supersededOn: string | null;
    }>
  >
> = {
  "gemini-4-neon": {
    announcementUrl: "https://deepmind.google/models/gemini/",
    summary:
      "Adapted from Carbon for lean token usage and rapid software engineering; leads AA Coding Agents in Antigravity CLI.",
    supersededOn: null,
  },
  "gpt-6-2-astra": {
    announcementUrl: "https://developers.openai.com/api/docs/models/gpt-6.2-astra",
    summary:
      "OpenAI's frontier reasoning and coding model; commands the $1.60–$4.00/task Pareto frontier with tight token discipline.",
    supersededOn: null,
  },
  "gpt-6-2-sol": {
    announcementUrl: "https://developers.openai.com/api/docs/models/gpt-6.2-sol",
    summary:
      "High-efficiency coding tier capturing near-frontier SWE and CLI pass rates at $0.18–$1.01/task.",
    supersededOn: null,
  },
  "gemini-4-hydrogen": {
    announcementUrl:
      "https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-hydrogen/",
    summary:
      "Fast, flat-priced 1M-context coding and execution workhorse scaling from $0.29 to $3.16/task.",
    supersededOn: null,
  },
  "claude-fable-5-2": {
    announcementUrl: "https://www.anthropic.com/claude-fable-and-mythos-5-2",
    summary:
      "Anthropic's highest-capability model; sets the overall ceiling on FrontierCode 2.0, Harbor Terminal-Bench, and Intelligence v5.",
    supersededOn: null,
  },
  "gemini-4-carbon": {
    announcementUrl:
      "https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-carbon/",
    summary:
      "Deep sustained-reasoning Gemini 4 flagship; hits 65.2% on Terminal-Bench 4.0 at High effort.",
    supersededOn: null,
  },
  "gpt-6-1-terra": {
    announcementUrl: "https://developers.openai.com/api/docs/models/gpt-6.1-terra",
    summary:
      "Compact coding and UI-capable reasoning tier spanning six effort settings under $1/task.",
    supersededOn: null,
  },
  "claude-haiku-5-5": {
    announcementUrl: "https://www.anthropic.com/claude-haiku-5-5",
    summary:
      "High-throughput sub-$0.45/task tier rounding out the Claude 5.5 lineup across five thinking depths.",
    supersededOn: null,
  },
  "gemini-4-argon": {
    announcementUrl:
      "https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/",
    summary:
      "Initial Gemini 4 frontier release introducing Google's element-series developer lineup.",
    supersededOn: null,
  },
  "gpt-6-1-sol": {
    announcementUrl: "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
    summary:
      "Late-September efficiency leader that established the sub-$0.60/task coding frontier before GPT-6.2 Sol.",
    supersededOn: "2026-11-17",
  },
  "claude-sonnet-5-5": {
    announcementUrl: "https://www.anthropic.com/claude-sonnet-5-5",
    summary:
      "Everyday Claude Code workhorse reaching 63.6% on Terminal-Bench 4.0 at Max effort.",
    supersededOn: null,
  },
  "claude-opus-5-5": {
    announcementUrl: "https://www.anthropic.com/claude-opus-5-5",
    summary:
      "September coding frontier leader (53.0% Coding composite, 64.9% Harbor Terminal-Bench in Claude Code).",
    supersededOn: null,
  },
  "gpt-6-sol": {
    announcementUrl: "https://developers.openai.com/api/docs/models/gpt-6-sol",
    summary:
      "Initial GPT-6 mid-tier coding model released alongside Luna, quickly succeeded by GPT-6.1 Sol.",
    supersededOn: "2026-09-29",
  },
  "gpt-6-luna": {
    announcementUrl: "https://developers.openai.com/api/docs/models/gpt-6-luna",
    summary:
      "Micro-budget reasoning model ($0.005–$0.15/task) anchoring the ultra-low-cost end of the frontier.",
    supersededOn: null,
  },
  "gpt-6-astra": {
    announcementUrl: "https://openai.com/index/gpt-6-astra/",
    summary:
      "First-generation GPT-6 flagship; led coding efficiency at $6.24/task prior to Opus 5.5 and GPT-6.2 Astra.",
    supersededOn: "2026-11-17",
  },
  "gemini-3-8-flash": {
    announcementUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash",
    summary:
      "Late Gemini 3.x fast reasoning release preceding the Gemini 4 element family.",
    supersededOn: "2026-11-12",
  },
  "claude-fable-5-1": {
    announcementUrl: "https://www.anthropic.com/claude-fable-and-mythos-5-1",
    summary:
      "Early-September adaptive-thinking flagship succeeded by Opus 5.5 and Fable 5.2.",
    supersededOn: "2026-11-09",
  },
  "claude-opus-5": {
    announcementUrl: "https://www.anthropic.com/news/claude-opus-5",
    summary:
      "Mid-summer Anthropic flagship (49.0% Terminal-Bench 4.0 at Max) preceding the 5.5 generation.",
    supersededOn: "2026-09-22",
  },
  "gemini-3-5-flash-lite": {
    announcementUrl:
      "https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/",
    summary:
      "Lightweight high-throughput summer baseline retained for historical cost comparison.",
    supersededOn: null,
  },
  "gpt-5-6-terra": {
    announcementUrl: "https://developers.openai.com/api/docs/models/gpt-5.6-terra",
    summary:
      "Final GPT-5.x coding and multimodal tier before the transition to the GPT-6 architecture.",
    supersededOn: "2026-10-26",
  },
  "gpt-5-6-luna": {
    announcementUrl: "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
    summary:
      "Compact GPT-5.6 efficiency tier succeeded by GPT-6 Luna.",
    supersededOn: "2026-09-22",
  },
};

const EFFORT_META: Readonly<
  Record<EffortSlug, Readonly<{ label: string; shortTag: string; order: number }>>
> = {
  none: { label: "None", shortTag: "0", order: 0 },
  low: { label: "Low", shortTag: "L", order: 20 },
  medium: { label: "Med", shortTag: "M", order: 30 },
  high: { label: "High", shortTag: "H", order: 40 },
  xhigh: { label: "XHigh", shortTag: "XH", order: 50 },
  max: { label: "Max", shortTag: "MAX", order: 60 },
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function normalizeEffortSlug(rawSlug: string | undefined | null): EffortSlug {
  const s = (rawSlug ?? "").toLowerCase();
  if (s === "low" || s === "minimal") return "low";
  if (s === "medium") return "medium";
  if (s === "high") return "high";
  if (s === "xhigh") return "xhigh";
  if (s === "max") return "max";
  return "none";
}

export function resolveSupersededOn(opts: {
  deprecated: boolean;
  curatedSupersededOn: string | null | undefined;
  existingSupersededOn: string | null | undefined;
  snapshotDate: string;
}): string | null {
  if (opts.curatedSupersededOn) return opts.curatedSupersededOn;
  if (opts.existingSupersededOn) return opts.existingSupersededOn;
  if (opts.deprecated) return opts.snapshotDate;
  return null;
}

export function hasDatasetChanges(
  existing: ReleaseDataset | null,
  next: ReleaseDataset,
): boolean {
  if (!existing) return true;
  if (existing.schemaVersion !== next.schemaVersion) return true;
  return (
    JSON.stringify(existing.releases) !== JSON.stringify(next.releases) ||
    JSON.stringify(existing.sources) !== JSON.stringify(next.sources)
  );
}

function loadExistingDataset(dataPath: string): ReleaseDataset | null {
  if (!existsSync(dataPath)) return null;
  try {
    return JSON.parse(readFileSync(dataPath, "utf8")) as ReleaseDataset;
  } catch {
    return null;
  }
}

function parseFlightChunks(html: string): string {
  const chunks: string[] = [];
  new HTMLRewriter()
    .on("script", {
      element(el) {
        let body = "";
        el.onEndTag(() => {
          const s = body
            .trim()
            .replaceAll("&quot;", '"')
            .replaceAll("&#x27;", "'")
            .replaceAll("&lt;", "<")
            .replaceAll("&gt;", ">")
            .replaceAll("&amp;", "&");
          if (s.startsWith("self.__next_f.push(") && s.endsWith(")")) {
            try {
              const arr = JSON.parse(s.slice("self.__next_f.push(".length, -1));
              if (Array.isArray(arr) && typeof arr[1] === "string") {
                chunks.push(arr[1]);
              }
            } catch {
              // ignore non-JSON flight pushes
            }
          }
        });
        (this as { _onText?: (t: string) => void })._onText = (t: string) => {
          body += t;
        };
      },
      text(c) {
        const fn = (this as { _onText?: (t: string) => void })._onText;
        if (fn) fn(c.text);
      },
    })
    .transform(html);
  return chunks.join("\n");
}

async function decodeManifest(encrypted: Uint8Array, keyHex: string): Promise<unknown> {
  const pairs = keyHex.match(/.{2}/gu) ?? [];
  const keyBytes = new Uint8Array(new ArrayBuffer(pairs.length));
  pairs.forEach((p, i) => {
    keyBytes[i] = Number.parseInt(p, 16);
  });
  const digest = await crypto.subtle.digest("SHA-256", keyBytes.buffer);
  const iv = new Uint8Array(digest).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", keyBytes.buffer, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const copy = new Uint8Array(new ArrayBuffer(encrypted.byteLength));
  copy.set(encrypted);
  const decrypted = await crypto.subtle.decrypt(
    { iv, name: "AES-GCM", tagLength: 128 },
    key,
    copy.buffer,
  );
  const json = gunzipSync(new Uint8Array(decrypted)).toString("utf8");
  return JSON.parse(json);
}

interface RawCodingAgentRow {
  displayLabel?: string;
  agentName?: string;
  model?: {
    release?: { shortName?: string };
    effort?: { slug?: string };
  };
  modelCreators?: Array<{ slug?: string }>;
  indexScore?: number | null;
  mean?: { costUsd?: number | null };
  evals?: Array<{ datasetIndexName?: string; mean?: { reward?: number | null } }>;
}

function extractCodingAgentMap(caHtml: string): Map<string, CliHarnessEval> {
  const map = new Map<string, CliHarnessEval>();
  const joined = parseFlightChunks(caHtml);

  function visit(v: unknown): void {
    if (Array.isArray(v)) {
      if (
        v.length > 0 &&
        v[0] &&
        typeof v[0] === "object" &&
        "agentName" in v[0] &&
        "indexScore" in v[0]
      ) {
        for (const item of v as RawCodingAgentRow[]) {
          const creators = (item.modelCreators ?? []).map((c) => c.slug).filter(Boolean);
          // Single-provider native CLI runs only (exclude composite routers like Devin Fusion)
          if (creators.length !== 1) continue;
          const harness = item.agentName ?? "";
          if (!["Claude Code", "Codex", "Antigravity CLI"].includes(harness)) continue;
          const relName = item.model?.release?.shortName;
          const effortSlug = normalizeEffortSlug(item.model?.effort?.slug);
          if (!relName || typeof item.indexScore !== "number" || !item.mean?.costUsd) continue;
          const fc =
            item.evals?.find((e) => e.datasetIndexName?.startsWith("frontiercode"))?.mean?.reward ??
            0;
          const sa =
            item.evals?.find((e) => e.datasetIndexName?.startsWith("swe-atlas"))?.mean?.reward ?? 0;
          const tb =
            item.evals?.find((e) => e.datasetIndexName?.startsWith("terminal-bench"))?.mean
              ?.reward ?? 0;
          const key = `${relName.toLowerCase()}:${effortSlug}`;
          map.set(key, {
            harness,
            codingAgentScore: round2(item.indexScore * 100),
            costUsdPerTask: round2(item.mean.costUsd),
            frontierCode2: round2(fc * 100),
            sweAtlas: round2(sa * 100),
            terminalBench4: round2(tb * 100),
          });
        }
      }
      for (const child of v) visit(child);
    } else if (v && typeof v === "object") {
      for (const val of Object.values(v)) visit(val);
    }
  }

  for (const line of joined.split("\n")) {
    const sep = line.indexOf(":");
    if (sep <= 0) continue;
    const body = line.slice(sep + 1);
    if (!body.includes("agentName") || !body.includes("indexScore")) continue;
    try {
      visit(JSON.parse(body));
    } catch {
      // ignore unparseable flight lines
    }
  }
  return map;
}

interface ParsedHarborEntry {
  eval: HarborBenchEval;
  modelUrl: string | null;
}

function extractHarborMap(tbRecent: Record<string, string>): Map<string, ParsedHarborEntry> {
  const map = new Map<string, ParsedHarborEntry>();
  // Sort keys ascending so newer 4-1-0 regrades overwrite older 4-0-0 entries
  for (const file of Object.keys(tbRecent).sort()) {
    try {
      const sub = JSON.parse(tbRecent[file]!);
      const agent = sub.metadata?.agent_display?.label as string | undefined;
      const modelLabel = (sub.metadata?.model_display?.label as string | undefined) ?? "";
      const modelUrl =
        typeof sub.metadata?.model_display?.url === "string" &&
        sub.metadata.model_display.url.startsWith("https://")
          ? (sub.metadata.model_display.url as string)
          : null;
      const effort = (sub.metadata?.reasoning_effort as string | undefined) ?? "max";
      const acc = sub.metrics?.accuracy as number | undefined;
      const totalCost = sub.metrics?.total_cost_usd as number | undefined;
      const nTrials = (sub.metrics?.n_trials as number | undefined) ?? 330;
      if (!agent || typeof acc !== "number" || typeof totalCost !== "number") continue;
      if (!["Claude Code", "Codex", "Antigravity CLI"].includes(agent)) continue;

      const normModel = modelLabel
        .toLowerCase()
        .replace(/^claude\s+/, "")
        .trim();
      map.set(normModel, {
        eval: {
          agent,
          effort,
          accuracy: round2(acc),
          totalCostUsd: round2(totalCost),
          costPerTrialUsd: round2(totalCost / nTrials),
        },
        modelUrl,
      });
    } catch {
      // ignore malformed
    }
  }
  return map;
}

async function loadUpstreamRaw(fromRawDir: string | null): Promise<{
  models: Array<Record<string, any>>;
  caHtml: string;
  tbRecent: Record<string, string>;
}> {
  if (fromRawDir) {
    const parsed = JSON.parse(
      readFileSync(path.join(fromRawDir, "aa-intelligence-models.json"), "utf8"),
    );
    const caHtml = readFileSync(path.join(fromRawDir, "aa-coding-agents.html"), "utf8");
    const tbRecent = JSON.parse(
      readFileSync(path.join(fromRawDir, "terminal-bench-recent.json"), "utf8"),
    );
    return { models: parsed.models, caHtml, tbRecent };
  }

  // Live fetch from public endpoints
  const modelsRes = await fetch("https://artificialanalysis.ai/models", {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!modelsRes.ok) throw new Error(`AA models HTTP ${modelsRes.status}`);
  const modelsHtml = await modelsRes.text();
  const joined = parseFlightChunks(modelsHtml);
  const manifests = [
    ...joined.matchAll(
      /"key":"([a-f0-9]{64})","path":"(\/data\/[a-f0-9]+\.txt)"|"path":"(\/data\/[a-f0-9]+\.txt)","key":"([a-f0-9]{64})"/gu,
    ),
  ].map((m) => ({ key: (m[1] || m[4])!, path: (m[2] || m[3])! }));

  let languageModels: Array<Record<string, any>> | null = null;
  for (const mf of manifests) {
    const r = await fetch(`https://artificialanalysis.ai${mf.path}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!r.ok) continue;
    const decoded = (await decodeManifest(new Uint8Array(await r.arrayBuffer()), mf.key)) as Record<
      string,
      any
    >;
    if (decoded && !Array.isArray(decoded) && Array.isArray(decoded.models)) {
      languageModels = decoded.models;
      break;
    }
  }
  if (!languageModels) {
    throw new Error("Could not locate Artificial Analysis language-model manifest.");
  }

  const caRes = await fetch("https://artificialanalysis.ai/agents/coding-agents/", {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!caRes.ok) throw new Error(`AA coding agents HTTP ${caRes.status}`);
  const caHtml = await caRes.text();

  const ghHeaders: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
  };
  const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (ghToken) {
    ghHeaders.Authorization = `Bearer ${ghToken}`;
  }

  const tbDirRes = await fetch(
    "https://api.github.com/repos/harbor-framework/terminal-bench/contents/leaderboard/submissions",
    { headers: ghHeaders },
  );
  const tbRecent: Record<string, string> = {};
  if (tbDirRes.ok) {
    const items = (await tbDirRes.json()) as Array<{ name: string; download_url: string | null }>;
    const candidates = items.filter(
      (i) => i.download_url && i.name.endsWith(".json") && HARBOR_PROVIDER_RE.test(i.name),
    );
    await Promise.all(
      candidates.map(async (item) => {
        const subRes = await fetch(item.download_url!, { headers: { "User-Agent": USER_AGENT } });
        if (subRes.ok) {
          tbRecent[item.name] = await subRes.text();
        }
      }),
    );
  }

  return { models: languageModels, caHtml, tbRecent };
}

export function buildDataset(
  models: Array<Record<string, any>>,
  caHtml: string,
  tbRecent: Record<string, string>,
  snapshotDate: string,
  existingDataset: ReleaseDataset | null = null,
): ReleaseDataset {
  const cliMap = extractCodingAgentMap(caHtml);
  const harborMap = extractHarborMap(tbRecent);
  const existingBySlug = new Map(
    (existingDataset?.releases ?? []).map((r) => [r.slug, r]),
  );

  const byRelease = new Map<string, Array<Record<string, any>>>();
  for (const m of models) {
    const creatorSlug = m.creator?.slug as string | undefined;
    if (!creatorSlug || !TARGET_PROVIDERS.has(creatorSlug as ProviderId)) continue;
    if (typeof m.releaseDate !== "string" || m.releaseDate < MIN_RELEASE_DATE) continue;
    if (m.intelligenceIndexIsEstimated === true) continue;
    if (
      typeof m.intelligenceIndex !== "number" ||
      typeof m.terminalBench40 !== "number" ||
      typeof m.frontierCode20 !== "number"
    ) {
      continue;
    }
    const totalCost = m.intelligenceIndexCostPerTask?.cost?.total;
    const outTokens = m.intelligenceIndexOutputTokensPerTask?.output;
    if (typeof totalCost !== "number" || totalCost <= 0) continue;
    if (typeof outTokens !== "number" || outTokens <= 0) continue;

    const relSlug = (m.release?.slug as string | undefined) ?? (m.slug as string);
    // Skip niche vertical fine-tunes like astra-for-law
    if (relSlug.includes("for-law")) continue;

    const bucket = byRelease.get(relSlug) ?? [];
    bucket.push(m);
    byRelease.set(relSlug, bucket);
  }

  const releases: ModelRelease[] = [];

  for (const [relSlug, rawConfigs] of byRelease.entries()) {
    const sample = rawConfigs[0]!;
    const provider = sample.creator.slug as ProviderId;
    const relName = (sample.release?.name as string | undefined) ?? (sample.name as string);
    const defaultEffortSlug = normalizeEffortSlug(sample.release?.defaultEffort?.slug ?? "high");

    const seenEfforts = new Map<EffortSlug, EffortPoint>();
    for (const cfg of rawConfigs) {
      const effortSlug = normalizeEffortSlug(cfg.effort?.slug);
      const meta = EFFORT_META[effortSlug];
      const tb4 = cfg.terminalBench40 * 100;
      const fc2 = cfg.frontierCode20 * 100;
      const coding = (tb4 + fc2) / 2;
      const costObj = cfg.intelligenceIndexCostPerTask.cost;
      const tokObj = cfg.intelligenceIndexOutputTokensPerTask;
      const cliKey = `${relName.toLowerCase()}:${effortSlug}`;
      const cliEval = cliMap.get(cliKey) ?? null;

      const point: EffortPoint = {
        id: cfg.id as string,
        slug: cfg.slug as string,
        effortSlug,
        effortLabel: meta.label,
        shortTag: meta.shortTag,
        effortLevel: meta.order,
        isDefaultEffort: effortSlug === defaultEffortSlug,
        scores: {
          coding: round2(coding),
          terminalBench4: round2(tb4),
          frontierCode2: round2(fc2),
          intelligence: round2(cfg.intelligenceIndex as number),
        },
        costUsdPerTask: {
          total: round3(costObj.total as number),
          input: round3(costObj.input as number),
          output: round3(costObj.output as number),
          reasoning: round3(costObj.reasoning as number),
          cacheRead: round3(costObj.cacheRead as number),
        },
        tokensPerTask: {
          total: Math.round(tokObj.output as number),
          reasoning: Math.round(tokObj.reasoning as number),
          answer: Math.round(tokObj.answer as number),
        },
        speedTokPerSec:
          typeof cfg.headline?.outputSpeed === "number"
            ? round2(cfg.headline.outputSpeed)
            : null,
        cliEval,
      };

      // Deduplicate if multiple configs share effortSlug (prefer higher score)
      const prev = seenEfforts.get(effortSlug);
      if (!prev || point.scores.coding > prev.scores.coding) {
        seenEfforts.set(effortSlug, point);
      }
    }

    const efforts = [...seenEfforts.values()].sort((a, b) => a.effortLevel - b.effortLevel);
    if (!efforts.some((e) => e.isDefaultEffort) && efforts.length > 0) {
      const last = efforts[efforts.length - 1]!;
      efforts[efforts.length - 1] = { ...last, isDefaultEffort: true };
    }

    const curation = RELEASE_CURATION[relSlug];
    const existingRel = existingBySlug.get(relSlug);
    const normHarborKey = relName.toLowerCase().replace(/^claude\s+/, "").trim();
    const harborEntry =
      harborMap.get(normHarborKey) ?? harborMap.get(relName.toLowerCase()) ?? null;
    const deprecated = Boolean(sample.deprecated);

    releases.push({
      slug: relSlug,
      name: relName,
      provider,
      releaseDate: sample.releaseDate as string,
      deprecated,
      supersededOn: resolveSupersededOn({
        deprecated,
        curatedSupersededOn: curation?.supersededOn,
        existingSupersededOn: existingRel?.supersededOn,
        snapshotDate,
      }),
      pricing: {
        inputPer1M: sample.price1mInputTokens as number,
        outputPer1M: sample.price1mOutputTokens as number,
        cachedInputPer1M:
          typeof sample.cacheHitPrice === "number" ? sample.cacheHitPrice : null,
        contextWindowTokens: (sample.contextWindowTokens as number) ?? 200000,
      },
      summary:
        curation?.summary ??
        existingRel?.summary ??
        `${relName} evaluated across ${efforts.length} effort configuration${efforts.length === 1 ? "" : "s"}.`,
      announcementUrl:
        curation?.announcementUrl ??
        existingRel?.announcementUrl ??
        harborEntry?.modelUrl ??
        `https://artificialanalysis.ai/models/${sample.slug}`,
      benchmarkUrl: `https://artificialanalysis.ai/models/${sample.slug}`,
      harborEval: harborEntry?.eval ?? null,
      efforts,
    });
  }

  const providerOrder: Record<ProviderId, number> = { google: 0, openai: 1, anthropic: 2 };
  releases.sort((a, b) => {
    const d = b.releaseDate.localeCompare(a.releaseDate);
    if (d !== 0) return d;
    const maxA = Math.max(...a.efforts.map((e) => e.scores.coding));
    const maxB = Math.max(...b.efforts.map((e) => e.scores.coding));
    if (Math.abs(maxB - maxA) > 0.01) return maxB - maxA;
    return providerOrder[a.provider] - providerOrder[b.provider];
  });

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    snapshotDate,
    sources: [
      {
        id: "artificial-analysis-v5",
        name: "Artificial Analysis v5.0.1",
        url: "https://artificialanalysis.ai/models",
        note: "Standardized multi-effort evaluations for FrontierCode 2.0, Terminal-Bench 4.0, Intelligence Index v5.0.1, per-task USD cost, and output tokens.",
      },
      {
        id: "aa-coding-agents",
        name: "Artificial Analysis Coding Agents",
        url: "https://artificialanalysis.ai/agents/coding-agents/",
        note: "Native CLI harness evaluations across Claude Code, OpenAI Codex, and Google Antigravity CLI.",
      },
      {
        id: "harbor-terminal-bench",
        name: "Harbor Terminal-Bench",
        url: "https://tbench.ai",
        note: "Official 330-trial autonomous terminal engineering submissions.",
      },
    ],
    releases,
  };
}

export function validateDataset(ds: ReleaseDataset): void {
  if (ds.schemaVersion !== 1) throw new Error("Unexpected schemaVersion");
  if (!Array.isArray(ds.releases) || ds.releases.length < 10) {
    throw new Error(`Expected at least 10 releases, got ${ds.releases?.length}`);
  }
  const seenSlugs = new Set<string>();
  for (let i = 0; i < ds.releases.length; i++) {
    const r = ds.releases[i]!;
    if (seenSlugs.has(r.slug)) throw new Error(`Duplicate release slug: ${r.slug}`);
    seenSlugs.add(r.slug);
    if (i > 0 && ds.releases[i - 1]!.releaseDate < r.releaseDate) {
      throw new Error(`Releases out of chronological order at ${r.slug}`);
    }
    if (!TARGET_PROVIDERS.has(r.provider)) {
      throw new Error(`Unexpected provider ${r.provider} on ${r.slug}`);
    }
    if (r.efforts.length === 0) {
      throw new Error(`Release ${r.slug} has 0 effort configurations`);
    }
    for (let j = 0; j < r.efforts.length; j++) {
      const e = r.efforts[j]!;
      if (j > 0 && r.efforts[j - 1]!.effortLevel >= e.effortLevel) {
        throw new Error(`Efforts not strictly ordered on ${r.slug}`);
      }
      for (const [k, v] of Object.entries(e.scores)) {
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) {
          throw new Error(`Invalid score ${k}=${v} on ${r.slug}:${e.effortSlug}`);
        }
      }
      if (e.costUsdPerTask.total <= 0 || e.tokensPerTask.total <= 0) {
        throw new Error(`Non-positive cost or tokens on ${r.slug}:${e.effortSlug}`);
      }
    }
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const existing = JSON.parse(readFileSync(DATA_PATH, "utf8")) as ReleaseDataset;
    validateDataset(existing);
    const totalPoints = existing.releases.reduce((s, r) => s + r.efforts.length, 0);
    console.log(
      `✓ Checked data/releases.json: ${existing.releases.length} releases, ${totalPoints} effort points, latest ${existing.releases[0]?.name} (${existing.releases[0]?.releaseDate}).`,
    );
    process.exit(0);
  }

  const fromRawIdx = args.indexOf("--from-raw");
  const fromRawDir = fromRawIdx >= 0 ? (args[fromRawIdx + 1] ?? null) : null;
  const forceWrite = args.includes("--force");
  const today = new Date().toISOString().slice(0, 10);

  const existing = loadExistingDataset(DATA_PATH);
  const raw = await loadUpstreamRaw(fromRawDir);
  const dataset = buildDataset(raw.models, raw.caHtml, raw.tbRecent, today, existing);
  validateDataset(dataset);

  const totalPoints = dataset.releases.reduce((s, r) => s + r.efforts.length, 0);
  if (!forceWrite && !hasDatasetChanges(existing, dataset)) {
    console.log(
      `✓ Checked upstream (${dataset.releases.length} releases, ${totalPoints} effort configurations): no release or benchmark updates.`,
    );
    process.exit(0);
  }

  mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  writeFileSync(DATA_PATH, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(
    `✓ Wrote data/releases.json: ${dataset.releases.length} releases, ${totalPoints} effort configurations (snapshot ${dataset.snapshotDate}).`,
  );
}
