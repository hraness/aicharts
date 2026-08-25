import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkGptSubsidyData } from "./check-gpt-subsidy-data";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
    force: true,
    recursive: true,
  })));
});

describe("checked GPT subsidy snapshot provenance", () => {
  test("matches the checked pricing manifest bytes", async () => {
    const result = await checkGptSubsidyData();
    expect(result.observationCount).toBeGreaterThanOrEqual(31);
    expect(result.measurementSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.pricingSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("rejects a byte-level manifest drift", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aicharts-subsidy-check-"));
    temporaryRoots.push(root);
    const dataPath = path.join(root, "gpt-subsidy.json");
    const pricingPath = path.join(root, "gpt-subsidy-pricing.json");
    const [dataSource, pricingSource] = await Promise.all([
      readFile(path.join(repositoryRoot, "data", "gpt-subsidy.json"), "utf8"),
      readFile(path.join(repositoryRoot, "data", "gpt-subsidy-pricing.json"), "utf8"),
    ]);
    await Promise.all([
      writeFile(dataPath, dataSource, "utf8"),
      writeFile(pricingPath, `${pricingSource}\n`, "utf8"),
    ]);

    await expect(checkGptSubsidyData({ dataPath, pricingPath }))
      .rejects.toThrow("differs from the checked manifest bytes");
  });

  test("rejects semantically invalid proxy pricing even when the public hash matches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aicharts-subsidy-check-"));
    temporaryRoots.push(root);
    const dataPath = path.join(root, "gpt-subsidy.json");
    const pricingPath = path.join(root, "gpt-subsidy-pricing.json");
    const [data, pricing] = await Promise.all([
      readFile(path.join(repositoryRoot, "data", "gpt-subsidy.json"), "utf8")
        .then(source => JSON.parse(source) as {
          pricing: { manifest: { sha256: string } };
          [key: string]: unknown;
        }),
      readFile(path.join(repositoryRoot, "data", "gpt-subsidy-pricing.json"), "utf8")
        .then(source => JSON.parse(source) as {
          models: Array<{ rates: { input: number }; [key: string]: unknown }>;
          [key: string]: unknown;
        }),
    ]);
    const proxy = pricing.models[0];
    if (proxy === undefined) throw new Error("pricing fixture has no proxy row");
    proxy.rates.input += 0.01;
    const pricingSource = `${JSON.stringify(pricing, null, 2)}\n`;
    data.pricing.manifest.sha256 = createHash("sha256")
      .update(pricingSource)
      .digest("hex");
    await Promise.all([
      writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8"),
      writeFile(pricingPath, pricingSource, "utf8"),
    ]);

    await expect(checkGptSubsidyData({ dataPath, pricingPath }))
      .rejects.toThrow("Proxy source, rates, and long-context rules must exactly match");
  });

  test("rejects drift in a measurement implementation source", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aicharts-subsidy-check-"));
    temporaryRoots.push(root);
    const scripts = path.join(root, "scripts");
    await mkdir(scripts, { recursive: true });
    const [adapter, updater] = await Promise.all([
      readFile(path.join(repositoryRoot, "scripts", "aicharts_gpt_subsidy_ledger.rs"), "utf8"),
      readFile(path.join(repositoryRoot, "scripts", "update-gpt-subsidy.ts"), "utf8"),
    ]);
    await Promise.all([
      writeFile(path.join(scripts, "aicharts_gpt_subsidy_ledger.rs"), `${adapter}\n`, "utf8"),
      writeFile(path.join(scripts, "update-gpt-subsidy.ts"), updater, "utf8"),
    ]);

    await expect(checkGptSubsidyData({ repositoryRoot: root }))
      .rejects.toThrow("Measurement implementation hash drifted");
  });
});
