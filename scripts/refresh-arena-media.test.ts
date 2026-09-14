import { describe, expect, test } from "bun:test";
import {
  ARENA_MEDIA_DATASET, ARENA_MEDIA_FEATURES, ARENA_MEDIA_LICENSE, ARENA_MEDIA_TRACKS,
  ARENA_MEDIA_VERSION, arenaMediaSnapshotSchema, type ArenaMediaRow, type ArenaMediaSnapshot,
} from "../lib/arena-media-data";
import { admitArenaPage, assertArenaLicense, collectArenaMedia, hasArenaMediaChanged, selectArenaOverall } from "./refresh-arena-media";

const revision = "a".repeat(40);
const retrievedAt = "2026-09-09T01:00:00.000Z";
const row = (index = 0): ArenaMediaRow => ({
  model_name: `Model ${index} (720p audio)`, organization: "publisher", license: "Proprietary",
  rating: 1200 - index, rating_lower: 1190 - index, rating_upper: 1210 - index,
  variance: 25, vote_count: 1000 + index, rank: index + 1,
  category: "overall", leaderboard_publish_date: "2026-09-04",
});
const rows = Array.from({ length: 5 }, (_, index) => row(index));
// Source fixtures represent untrusted strings, including deliberately unsupported columns.
type SourceFeatureFixture = { feature_idx: number; name: string; type: { dtype: string; _type: string } };
function page(total = 5, offset = 0) {
  return {
    features: ARENA_MEDIA_FEATURES.map<SourceFeatureFixture>(([name, dtype], feature_idx) => ({ feature_idx, name, type: { dtype, _type: "Value" } })),
    rows: Array.from({ length: Math.min(100, total - offset) }, (_, index) => ({ row_idx: offset + index, row: row(offset + index), truncated_cells: [] })),
    num_rows_total: total, num_rows_per_page: 100, partial: false,
  };
}
function snapshot(): ArenaMediaSnapshot {
  return arenaMediaSnapshotSchema.parse({
    schemaVersion: 1,
    source: { dataset: ARENA_MEDIA_DATASET, revision, retrievedAt, license: ARENA_MEDIA_LICENSE },
    cohorts: Object.fromEntries(ARENA_MEDIA_TRACKS.map(track => [track, { version: ARENA_MEDIA_VERSION, publishedAt: "2026-09-04", rows }])),
  });
}

describe("Arena licensed source admission", () => {
  test("dataset license comes from pinned owner frontmatter, not model licenses or prose", () => {
    expect(() => assertArenaLicense("---\nlicense: cc-by-4.0\n---\n# Arena")).not.toThrow();
    for (const invalid of ["license: cc-by-4.0", "---\nlicense: cc-by-nc-4.0\n---\nlicense: cc-by-4.0", "---\nlicense: cc-by-4.0\nlicense: mit\n---"]) {
      expect(() => assertArenaLicense(invalid)).toThrow("license");
    }
  });

  test("native ratings and intervals stay unrounded, complete, and bound to an owner revision", () => {
    const source = page(); source.rows[0].row.rating = 1200.123456;
    expect(admitArenaPage(source, revision, revision, 0).rows[0].row.rating).toBe(1200.123456);
    expect(() => admitArenaPage(source, null, revision, 0)).toThrow("revision");
    expect(() => admitArenaPage(source, "b".repeat(40), revision, 0)).toThrow("revision");
    expect(() => admitArenaPage({ ...source, partial: true }, revision, revision, 0)).toThrow();
    expect(() => admitArenaPage({ ...source, rows: source.rows.slice(0, -1) }, revision, revision, 0)).toThrow("incomplete");
    expect(() => admitArenaPage(source, revision, revision, 0, 6)).toThrow("row count");
    source.rows[0].row_idx = 1;
    expect(() => admitArenaPage(source, revision, revision, 0)).toThrow("out of order");
  });

  test("new score contracts, unknown flags, malformed statistics, and truncation fail closed", () => {
    const invalidRows = [
      { ...row(), rating: NaN }, { ...row(), rating: "1200" }, { ...row(), score: 1200 },
      { ...row(), autoeval: true }, { ...row(), rating_lower: 1201 }, { ...row(), vote_count: -1 },
      { ...row(), vote_count: 1.5 }, { ...row(), variance: Infinity }, { ...row(), model_name: "Model\nInjection" },
    ];
    for (const invalid of invalidRows) {
      const source = page();
      expect(() => admitArenaPage({ ...source, rows: [{ ...source.rows[0], row: invalid }, ...source.rows.slice(1)] }, revision, revision, 0)).toThrow();
    }
    const truncated = page();
    expect(() => admitArenaPage({ ...truncated, rows: [{ ...truncated.rows[0], truncated_cells: ["model_name"] }, ...truncated.rows.slice(1)] }, revision, revision, 0)).toThrow();
    const ips = page(); ips.features[3].name = "score";
    expect(() => admitArenaPage(ips, revision, revision, 0)).toThrow("rating schema");
    const reordered = page(); [reordered.features[3], reordered.features[4]] = [reordered.features[4], reordered.features[3]];
    expect(() => admitArenaPage(reordered, revision, revision, 0)).toThrow("feature order");
  });

  test("overall selection precedes date validation; categories and dates are never pooled", () => {
    const otherCategory = { ...row(9), category: "multi_image_edit", leaderboard_publish_date: "2026-07-28" };
    expect(selectArenaOverall([...rows, otherCategory]).rows).toEqual(rows);
    expect(() => selectArenaOverall([{ ...rows[0], leaderboard_publish_date: "2026-09-03" }, ...rows.slice(1)])).toThrow("one publication date");
    expect(() => selectArenaOverall([rows[0], ...rows.slice(0, -1)])).toThrow("Duplicate");
    expect(() => selectArenaOverall(rows.map(item => ({ ...item, category: "3d_modeling" })))).toThrow();
    expect(selectArenaOverall(rows.map(item => ({ ...item, organization: "" }))).rows[0].organization).toBe("");
  });

  test("checked cohorts reject future dates, mixed versions, missing license, and identity collisions", () => {
    const source = snapshot();
    expect(arenaMediaSnapshotSchema.safeParse(source).success).toBeTrue();
    const future = structuredClone(source); future.source.retrievedAt = "2026-09-01T00:00:00.000Z";
    expect(arenaMediaSnapshotSchema.safeParse(future).success).toBeFalse();
    expect(arenaMediaSnapshotSchema.safeParse({ ...source, source: { ...source.source, license: undefined } }).success).toBeFalse();
    const changed = structuredClone(source); changed.cohorts.text_to_image.rows[1].model_name = "Model-0-(720p-audio)";
    expect(arenaMediaSnapshotSchema.safeParse(changed).success).toBeFalse();
    expect(arenaMediaSnapshotSchema.safeParse({ ...source, cohorts: { ...source.cohorts, text_to_image: { ...source.cohorts.text_to_image, version: "IPS" } } }).success).toBeFalse();
  });

  test("refresh preserves cohort retention and meaningful dates without refreshing unchanged observations", () => {
    const before = snapshot(); const next = snapshot();
    const sameInstant = snapshot(); sameInstant.source.retrievedAt = "2026-09-09T01:00:00Z";
    expect(hasArenaMediaChanged(sameInstant, before)).toBeFalse();
    const past = snapshot(); past.source.retrievedAt = "2026-09-09T00:59:59.999Z";
    expect(() => hasArenaMediaChanged(before, past)).toThrow("retrieval time regressed");
    next.source.retrievedAt = "2026-09-10T00:00:00.000Z"; next.source.revision = "b".repeat(40);
    expect(hasArenaMediaChanged(before, next)).toBeFalse();
    next.cohorts.text_to_image.rows = next.cohorts.text_to_image.rows.map((item, index) => index === 0 ? { ...item, rating: item.rating + 1 } : item);
    expect(hasArenaMediaChanged(before, next)).toBeTrue();
    next.cohorts.text_to_image.rows = next.cohorts.text_to_image.rows.slice(1);
    expect(() => hasArenaMediaChanged(before, next)).toThrow("retention");
    const older = snapshot(); older.cohorts.image_edit.publishedAt = "2026-09-03";
    expect(() => hasArenaMediaChanged(before, older)).toThrow("publication date regressed");
  });

  test("documented public API paginates completely, checks pinned license, and sends no credentials", async () => {
    const calls: URL[] = [];
    const result = await collectArenaMedia(async (input, init) => {
      const url = new URL(input); calls.push(url);
      expect(init.credentials).toBe("omit"); expect(init.redirect).toBe("error");
      if (url.pathname.startsWith("/api/datasets/")) return Response.json({ id: ARENA_MEDIA_DATASET, sha: revision, private: false, gated: false, cardData: { license: "cc-by-4.0" }, downloads: 1 });
      if (url.pathname.endsWith("README.md")) {
        expect(url.pathname).toContain(`/raw/${revision}/`);
        return new Response("---\nlicense: cc-by-4.0\n---\n# Arena");
      }
      expect(url.hostname).toBe("datasets-server.huggingface.co");
      expect(url.pathname).toBe("/rows"); expect(url.searchParams.get("split")).toBe("latest");
      const offset = Number(url.searchParams.get("offset"));
      return Response.json(page(105, offset), { headers: { "x-revision": revision } });
    }, retrievedAt);
    expect(calls).toHaveLength(10);
    expect(result.source.revision).toBe(revision);
    for (const track of ARENA_MEDIA_TRACKS) expect(result.cohorts[track].rows).toHaveLength(105);
  });

  test("changed license or failed public access aborts before any cohort is admitted", async () => {
    let calls = 0;
    await expect(collectArenaMedia(async () => {
      calls++;
      return Response.json({ id: ARENA_MEDIA_DATASET, sha: revision, private: false, gated: false, cardData: { license: "cc-by-nc-4.0" } });
    }, retrievedAt)).rejects.toThrow();
    expect(calls).toBe(1);
    await expect(collectArenaMedia(async () => new Response("", { status: 403 }), retrievedAt)).rejects.toThrow("HTTP 403");
    await expect(collectArenaMedia(async () => new Response(new Uint8Array([0xc3, 0x28])), retrievedAt)).rejects.toThrow();
    await expect(collectArenaMedia(async () => new Response("{}", { headers: { "content-length": "2000001" } }), retrievedAt)).rejects.toThrow("byte limit");
    await expect(collectArenaMedia(async () => new Response("x".repeat(2_000_001)), retrievedAt)).rejects.toThrow("byte limit");
  });
});
