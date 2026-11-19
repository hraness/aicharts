import { describe, expect, test } from "bun:test";
import rawDataset from "../data/releases.json";
import { hasDatasetChanges, resolveSupersededOn, validateDataset } from "../scripts/refresh-data";
import type { ReleaseDataset } from "./types";

const dataset = rawDataset as unknown as ReleaseDataset;

describe("Automated dataset refresh & benchmark update invariants", () => {
  test("hasDatasetChanges ignores timestamp-only differences when releases and benchmarks match", () => {
    const sameContent: ReleaseDataset = {
      ...dataset,
      updatedAt: "2026-12-31T23:59:59Z",
      snapshotDate: "2026-12-31",
    };
    expect(hasDatasetChanges(dataset, sameContent)).toBe(false);
  });

  test("hasDatasetChanges detects updated benchmark scores on existing releases", () => {
    const firstRel = dataset.releases[0]!;
    const firstEff = firstRel.efforts[0]!;
    const regraded: ReleaseDataset = {
      ...dataset,
      releases: [
        {
          ...firstRel,
          efforts: [
            {
              ...firstEff,
              scores: {
                ...firstEff.scores,
                terminalBench4: Number((firstEff.scores.terminalBench4 + 0.5).toFixed(2)),
              },
            },
            ...firstRel.efforts.slice(1),
          ],
        },
        ...dataset.releases.slice(1),
      ],
    };
    validateDataset(regraded);
    expect(hasDatasetChanges(dataset, regraded)).toBe(true);
  });

  test("resolveSupersededOn preserves historical dates and stamps newly deprecated models", () => {
    expect(
      resolveSupersededOn({
        deprecated: true,
        curatedSupersededOn: "2026-09-22",
        existingSupersededOn: "2026-10-01",
        snapshotDate: "2026-11-19",
      }),
    ).toBe("2026-09-22");

    expect(
      resolveSupersededOn({
        deprecated: true,
        curatedSupersededOn: null,
        existingSupersededOn: "2026-11-12",
        snapshotDate: "2026-11-19",
      }),
    ).toBe("2026-11-12");

    expect(
      resolveSupersededOn({
        deprecated: true,
        curatedSupersededOn: null,
        existingSupersededOn: null,
        snapshotDate: "2026-11-19",
      }),
    ).toBe("2026-11-19");

    expect(
      resolveSupersededOn({
        deprecated: false,
        curatedSupersededOn: null,
        existingSupersededOn: null,
        snapshotDate: "2026-11-19",
      }),
    ).toBeNull();
  });
});
