import { z } from "./schema";

export const ARENA_MEDIA_DATASET = "lmarena-ai/leaderboard-dataset";
export const ARENA_MEDIA_SOURCE = `https://huggingface.co/datasets/${ARENA_MEDIA_DATASET}`;
export const ARENA_MEDIA_VERSION = "Overall · Bradley–Terry";
export const ARENA_MEDIA_TRACKS = ["text_to_image", "image_edit", "text_to_video", "image_to_video"] as const;
export type ArenaMediaTrack = typeof ARENA_MEDIA_TRACKS[number];
export const ARENA_MEDIA_IDS = {
  text_to_image: "image-arena", image_edit: "image-edit-arena",
  text_to_video: "video-arena", image_to_video: "image-to-video-arena",
} as const;
export const ARENA_MEDIA_LICENSE = {
  id: "CC-BY-4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Arena (lmarena-ai), Arena leaderboard dataset",
  changes: "Selected overall media cohorts and projected fields for AI Charts; published ratings, intervals, and vote counts unchanged.",
  notice: "Data provided without warranties. No Arena endorsement is implied. Model licenses are separate from this dataset license.",
} as const;

const text = z.string().min(1).max(300).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value), "Expected bounded plain text.");
const rating = z.number().finite().min(-10_000).max(10_000);
const revision = z.string().regex(/^[a-f0-9]{40}$/u);

/** The owner's media export uses ratings; Agent Arena's IPS score fields are a different contract. */
export const arenaMediaRowSchema = z.object({
  model_name: text,
  organization: z.union([text, z.literal("")]),
  license: text,
  rating,
  rating_lower: rating,
  rating_upper: rating,
  variance: z.number().finite().nonnegative(),
  vote_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  rank: z.number().int().positive().max(2_000),
  category: text,
  leaderboard_publish_date: z.iso.date(),
}).strict().superRefine((row, ctx) => {
  if (row.rating_lower > row.rating || row.rating_upper < row.rating) {
    ctx.addIssue({ code: "custom", message: "Published confidence interval must contain the rating." });
  }
});
export type ArenaMediaRow = z.infer<typeof arenaMediaRowSchema>;

export const ARENA_MEDIA_FEATURES = [
  ["model_name", "string"], ["organization", "string"], ["license", "string"],
  ["rating", "float64"], ["rating_lower", "float64"], ["rating_upper", "float64"],
  ["variance", "float64"], ["vote_count", "int64"], ["rank", "int64"],
  ["category", "string"], ["leaderboard_publish_date", "string"],
] as const;

export const arenaMediaPageSchema = z.object({
  features: z.array(z.object({
    feature_idx: z.number().int().nonnegative(), name: text,
    type: z.object({ dtype: text, _type: z.literal("Value") }).strict(),
  }).strict()).length(ARENA_MEDIA_FEATURES.length),
  rows: z.array(z.object({
    row_idx: z.number().int().nonnegative(), row: arenaMediaRowSchema,
    truncated_cells: z.array(z.unknown()).length(0),
  }).strict()).max(100),
  num_rows_total: z.number().int().min(1).max(2_000),
  num_rows_per_page: z.literal(100),
  partial: z.literal(false),
}).strict().superRefine((page, ctx) => {
  page.features.forEach((feature, index) => {
    const expected = ARENA_MEDIA_FEATURES[index];
    if (feature.feature_idx !== index || feature.name !== expected[0] || feature.type.dtype !== expected[1]) {
      ctx.addIssue({ code: "custom", path: ["features", index], message: "Arena media feature order or rating schema changed." });
    }
  });
});

const cohort = z.object({
  version: z.literal(ARENA_MEDIA_VERSION),
  publishedAt: z.iso.date(),
  rows: z.array(arenaMediaRowSchema).min(5).max(300),
}).strict().superRefine((value, ctx) => {
  if (value.rows.some(row => row.category !== "overall" || row.leaderboard_publish_date !== value.publishedAt)) {
    ctx.addIssue({ code: "custom", message: "One cohort must contain only overall rows from one publication date." });
  }
  if (new Set(value.rows.map(row => row.model_name)).size !== value.rows.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate model configuration in Arena cohort." });
  }
  if (new Set(value.rows.map(row => arenaMediaPointId(row.model_name))).size !== value.rows.length) {
    ctx.addIssue({ code: "custom", message: "Arena point identifier collision requires reviewed identity mapping." });
  }
  if (value.rows.some(row => arenaMediaPointId(row.model_name) === "")) {
    ctx.addIssue({ code: "custom", message: "Model name requires a reviewed nonempty point identifier." });
  }
});

export const arenaMediaSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    dataset: z.literal(ARENA_MEDIA_DATASET),
    revision,
    retrievedAt: z.iso.datetime(),
    license: z.object({
      id: z.literal(ARENA_MEDIA_LICENSE.id), url: z.literal(ARENA_MEDIA_LICENSE.url),
      attribution: z.literal(ARENA_MEDIA_LICENSE.attribution), changes: z.literal(ARENA_MEDIA_LICENSE.changes),
      notice: z.literal(ARENA_MEDIA_LICENSE.notice),
    }).strict(),
  }).strict(),
  cohorts: z.object({ text_to_image: cohort, image_edit: cohort, text_to_video: cohort, image_to_video: cohort }).strict(),
}).strict().superRefine((snapshot, ctx) => {
  for (const track of ARENA_MEDIA_TRACKS) {
    if (snapshot.cohorts[track].publishedAt > snapshot.source.retrievedAt.slice(0, 10)) {
      ctx.addIssue({ code: "custom", path: ["cohorts", track, "publishedAt"], message: "Publication date cannot be later than retrieval." });
    }
  }
});
export type ArenaMediaSnapshot = z.infer<typeof arenaMediaSnapshotSchema>;

export function arenaMediaPointId(modelName: string): string {
  return modelName.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

export function arenaMediaFileUrl(sourceRevision: string, track: ArenaMediaTrack): string {
  return `${ARENA_MEDIA_SOURCE}/blob/${sourceRevision}/${track}/latest-00000-of-00001.parquet`;
}
