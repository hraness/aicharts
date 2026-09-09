import { describe, expect, test } from "bun:test";
import checked from "../data/arena-media.json";
import { ARENA_MEDIA_ATLAS_DATASETS, ARENA_MEDIA_ATLAS_ENTRIES } from "./benchmark-atlas-arena-media";
import { ARENA_MEDIA_IDS, ARENA_MEDIA_TRACKS, arenaMediaFileUrl, arenaMediaSnapshotSchema } from "./arena-media-data";
import { validateAtlasCatalog } from "./benchmark-atlas";

describe("Arena media chart publication", () => {
  const source = arenaMediaSnapshotSchema.parse(checked);

  test("four separate native preference cohorts have matched entries, dates, and reusable provenance", () => {
    expect(validateAtlasCatalog(ARENA_MEDIA_ATLAS_ENTRIES, ARENA_MEDIA_ATLAS_DATASETS).ok).toBeTrue();
    expect(ARENA_MEDIA_ATLAS_DATASETS).toHaveLength(4);
    for (const track of ARENA_MEDIA_TRACKS) {
      const dataset = ARENA_MEDIA_ATLAS_DATASETS.find(item => item.benchmarkId === ARENA_MEDIA_IDS[track])!;
      expect(dataset.observedAt).toBe(source.cohorts[track].publishedAt);
      expect(dataset.source.revision).toBe(source.source.revision);
      expect(dataset.source.url).toBe(arenaMediaFileUrl(source.source.revision, track));
      expect(dataset.source.name).toContain("CC BY 4.0");
      expect(dataset.comparabilityNote).toContain("https://creativecommons.org/licenses/by/4.0/");
      expect(dataset.score).toEqual({ label: "Arena preference rating", unit: "Arena points", direction: "higher" });
      expect(dataset.evidenceLabel).toContain("flags unavailable");
      expect(dataset.points).toHaveLength(source.cohorts[track].rows.length);
    }
  });

  test("every native rating, interval, setting, variance, and vote count survives projection without invented cost", () => {
    for (const track of ARENA_MEDIA_TRACKS) {
      const dataset = ARENA_MEDIA_ATLAS_DATASETS.find(item => item.benchmarkId === ARENA_MEDIA_IDS[track])!;
      for (const original of source.cohorts[track].rows) {
        const point = dataset.points.find(item => item.label === original.model_name)!;
        expect(point.model).toBe(original.model_name);
        expect(point.score).toBe(original.rating);
        expect(point.uncertainty).toEqual({ lower: original.rating_lower, upper: original.rating_upper, label: "Source-reported confidence interval" });
        expect([point.costUsd, point.harness, point.effort]).toEqual([null, null, null]);
        expect(point.provider).toBe(original.organization || "Not reported");
        expect(point.details).toContainEqual({ label: "Votes (publisher count)", value: original.vote_count.toLocaleString("en-US") });
        expect(point.details).toContainEqual({ label: "Rating variance", value: String(original.variance) });
        expect(point.details).toContainEqual({ label: "Preliminary / AutoEval status", value: "Not provided in licensed export" });
      }
    }
  });

  test("checked September anchors preserve different track leaders without treating retrieval as evaluation", () => {
    // Anchor assertions describe this owner release, not hard-coded admission limits for later cohorts.
    if (source.source.revision !== "bc50ae8cd12e8e0fd019ada807f35e7c04e7d317") return;
    expect(ARENA_MEDIA_TRACKS.map(track => source.cohorts[track].rows.length)).toEqual([76, 53, 48, 47]);
    expect(source.cohorts.text_to_image.rows[0]).toMatchObject({ model_name: "gpt-image-2 (medium)", rating: 1381.809102624958, leaderboard_publish_date: "2026-09-04" });
    expect(source.cohorts.image_edit.rows[0]).toMatchObject({ model_name: "gpt-image-2 (medium)", rating: 1461.0229110853088, leaderboard_publish_date: "2026-09-04" });
    expect(source.cohorts.text_to_video.rows[0]).toMatchObject({ model_name: "gemini-omni-1.1-flash", rating: 1514.597143292216, vote_count: 1777 });
    expect(source.cohorts.image_to_video.rows[0]).toMatchObject({ model_name: "minimax-h3", rating: 1497.0432099470936, leaderboard_publish_date: "2026-09-02" });
  });

  test("preference cannot silently become human-only evidence, diagnostic accuracy, or a world-model result", () => {
    for (const entry of ARENA_MEDIA_ATLAS_ENTRIES) {
      expect(entry.limitations.join(" ")).toContain("preliminary and AutoEval");
      expect(entry.measure).toContain("Bradley–Terry");
      expect(entry.category).not.toBe("world");
      expect(entry.id.startsWith("aa-")).toBeFalse();
    }
  });
});
