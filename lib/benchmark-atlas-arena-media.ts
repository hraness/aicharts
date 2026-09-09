import checkedSnapshot from "../data/arena-media.json";
import type { BenchmarkAtlasDataset, BenchmarkAtlasEntry } from "./benchmark-atlas";
import {
  ARENA_MEDIA_IDS, ARENA_MEDIA_LICENSE, ARENA_MEDIA_TRACKS, ARENA_MEDIA_VERSION,
  arenaMediaFileUrl, arenaMediaPointId, arenaMediaSnapshotSchema, type ArenaMediaTrack,
} from "./arena-media-data";

const snapshot = arenaMediaSnapshotSchema.parse(checkedSnapshot);
const tracks = {
  text_to_image: { name: "Image generation · Arena", category: "image", route: "text-to-image", label: "Text-to-image", question: "Which image generators lead Arena’s preference ratings?", summary: "Compare published preference ratings for images generated from text, with uncertainty and vote counts.", tags: ["text to image", "image generation", "preference", "GPT Image", "MAI", "Muse", "Grok", "Reve", "Nano Banana", "Seedream"] },
  image_edit: { name: "Image editing · Arena", category: "image", route: "image-edit", label: "Image editing", question: "Which image editors lead Arena’s preference ratings?", summary: "A separate preference comparison for editing an existing image, preserving each published model setting.", tags: ["image editing", "preference", "GPT Image", "MAI", "Muse", "Grok", "Seedream", "Nano Banana"] },
  text_to_video: { name: "Video generation · Arena", category: "video", route: "text-to-video", label: "Text-to-video", question: "Which text-to-video systems lead Arena’s preference ratings?", summary: "Compare video generators in the same text-prompt preference pool, keeping audio, resolution, and agent labels intact.", tags: ["text to video", "video generation", "preference", "Gemini Omni", "Wan", "FLUX", "Grok", "Seedance", "MiniMax", "Muse", "Sora", "Veo"] },
  image_to_video: { name: "Image-to-video · Arena", category: "video", route: "image-to-video", label: "Image-to-video", question: "Which systems turn an image into a preferred video?", summary: "An image-conditioned video preference comparison, separate from generation that starts with a text prompt alone.", tags: ["image to video", "video generation", "preference", "MiniMax", "Gemini Omni", "Wan", "Seedance", "FLUX", "Grok", "Veo"] },
} as const;

const limitations = [
  "Ratings depend on the opponent pool and prompt mix. Compare only within this track and publication date; ratings are not percentages.",
  "Overlapping confidence intervals do not establish a clear winner. Vote count is per model, not a count of unique people or prompts.",
  "The licensed export omits preliminary and AutoEval status flags. A row’s evidence status cannot be inferred from its vote count.",
  "This extract has no matched price or latency data. Keep audio, resolution, effort, web-search, and agent settings in the model labels.",
] as const;

export const ARENA_MEDIA_ATLAS_ENTRIES: readonly BenchmarkAtlasEntry[] = ARENA_MEDIA_TRACKS.map(track => ({
  id: ARENA_MEDIA_IDS[track], name: tracks[track].name, version: ARENA_MEDIA_VERSION, category: tracks[track].category,
  question: tracks[track].question, summary: tracks[track].summary,
  source: { name: "Arena", url: `https://arena.ai/leaderboard/${tracks[track].route}`, methodologyUrl: "https://arena.ai/blog/arena-rank" },
  measure: "Published Bradley–Terry preference rating; higher is better. Source confidence intervals and vote counts included.",
  comparisonRule: `${tracks[track].label}, overall category only. One complete, dated publisher cohort; no blending with other Arena tracks or diagnostic benchmarks.`,
  limitations: [
    ...limitations,
    ...(tracks[track].category === "image" ? ["Arena supports AutoEval proxy votes for image generation; the export does not identify affected rows. Preference does not guarantee correct composition or faithful editing."] : ["Video preference does not measure physical plausibility, interactive world simulation, or camera-control accuracy."]),
  ],
  coverage: "charted", tags: [...tracks[track].tags],
}));

function dataset(track: ArenaMediaTrack): BenchmarkAtlasDataset {
  const cohort = snapshot.cohorts[track];
  const sourceUrl = arenaMediaFileUrl(snapshot.source.revision, track);
  return {
    benchmarkId: ARENA_MEDIA_IDS[track], version: cohort.version,
    score: { label: "Arena preference rating", unit: "Arena points", direction: "higher" },
    source: { name: "Arena · CC BY 4.0", url: sourceUrl, revision: snapshot.source.revision, retrievedAt: snapshot.source.retrievedAt },
    observedAt: cohort.publishedAt,
    evidenceLabel: "Published preference ratings · evidence flags unavailable",
    configurationLabel: "Published model configuration",
    comparabilityNote: `${tracks[track].label} overall ratings, published ${cohort.publishedAt}. Compare within this dated pool; retain settings and confidence intervals. Preliminary and AutoEval flags are not provided. ${ARENA_MEDIA_LICENSE.attribution}, ${ARENA_MEDIA_LICENSE.id} (${ARENA_MEDIA_LICENSE.url}). ${ARENA_MEDIA_LICENSE.changes}`,
    points: cohort.rows.map(row => ({
      id: arenaMediaPointId(row.model_name), label: row.model_name, model: row.model_name,
      provider: row.organization || "Not reported", harness: null, effort: null,
      score: row.rating, costUsd: null,
      uncertainty: { lower: row.rating_lower, upper: row.rating_upper, label: "Source-reported confidence interval" },
      sourceUrl,
      details: [
        { label: "Votes (publisher count)", value: row.vote_count.toLocaleString("en-US") },
        { label: "Leaderboard publication date", value: row.leaderboard_publish_date },
        { label: "Published rank", value: String(row.rank) },
        { label: "Rating variance", value: String(row.variance) },
        { label: "Preliminary / AutoEval status", value: "Not provided in licensed export" },
        { label: "Organization (publisher label)", value: row.organization || "Not reported" },
        { label: "Model license (publisher label)", value: row.license },
      ],
    })),
  };
}

export const ARENA_MEDIA_ATLAS_DATASETS: readonly BenchmarkAtlasDataset[] = ARENA_MEDIA_TRACKS.map(dataset);
