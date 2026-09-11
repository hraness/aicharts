import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { GET as catalogResponse } from "../app/data/benchmark-atlas.json/route";
import { GET as datasetResponse } from "../app/data/benchmark-atlas/[benchmarkId]/route";
import { ATLAS_DATASETS, ATLAS_ENTRIES } from "../lib/benchmark-atlas-catalog";

// Dynamic loading keeps the distributed helper dependency-free JavaScript.
type FetchResponse = (input: string, options: RequestInit) => Promise<Response>;
const helper: {
  run(args: string[], options: { fetchImpl: FetchResponse; now: () => string }): Promise<unknown>;
} = await import(new URL("../skills/aicharts/scripts/atlas.mjs", import.meta.url).href);
const root = new URL("../skills/aicharts/", import.meta.url);
const stamp = "2026-09-11T00:00:00Z";

test("the portable skill keeps a valid entry point, UI metadata and confined reference files", async () => {
  const source = await readFile(new URL("SKILL.md", root), "utf8");
  const frontmatter = /^---\n([\s\S]*?)\n---\n/u.exec(source);
  expect(frontmatter).not.toBeNull();
  const metadata: unknown = parse(frontmatter![1]);
  expect(metadata).toMatchObject({ name: "aicharts", description: expect.any(String) });
  const ui: unknown = parse(await readFile(new URL("agents/openai.yaml", root), "utf8"));
  expect(ui).toMatchObject({ interface: {
    display_name: expect.any(String), short_description: expect.any(String), default_prompt: expect.any(String),
  } });
  const links = [...source.matchAll(/\]\((references\/[^)]+)\)/gu)].map(match => match[1]);
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    const target = new URL(link, root);
    expect(target.href.startsWith(new URL("references/", root).href)).toBe(true);
    expect((await readFile(target, "utf8")).trim().length).toBeGreaterThan(0);
  }
});

test("the standalone helper accepts every actual charted route with exact fetched-byte provenance", async () => {
  for (const dataset of ATLAS_DATASETS) {
    const calls: string[] = [];
    const evidence: { url: string; sha256: string }[] = [];
    const fetchImpl: FetchResponse = async (input, options) => {
      const url = String(input);
      calls.push(url);
      expect(options).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
      let response: Response;
      if (url === "https://aicharts.io/data/benchmark-atlas.json") {
        response = catalogResponse();
      } else {
        expect(url).toBe(`https://aicharts.io/data/benchmark-atlas/${dataset.benchmarkId}`);
        response = await datasetResponse(new Request(url), {
          params: Promise.resolve({ benchmarkId: dataset.benchmarkId }),
        });
      }
      evidence.push({ url, sha256: createHash("sha256").update(await response.clone().bytes()).digest("hex") });
      return response;
    };
    const result = await helper.run(["dataset", dataset.benchmarkId, "--limit", "1"], {
      fetchImpl, now: () => stamp,
    });
    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({
      fetchedAt: stamp, evidence, schemaVersion: 1,
      benchmark: ATLAS_ENTRIES.find(entry => entry.id === dataset.benchmarkId),
      dataset: { ...dataset, points: dataset.points.slice(0, 1) },
      page: { offset: 0, returned: 1, total: dataset.points.length, order: "source" },
    });
  }
});
