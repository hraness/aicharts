import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SESSION_MODELS } from "../lib/usage/session-contract";

const root = fileURLToPath(new URL("../", import.meta.url));
const identity = /^[a-z0-9][a-z0-9._:/@+()=-]{0,159}$/u;
const canonical = (name: string) => name.toLowerCase().replace(/\((minimal|low|medium|high|xhigh|auto|none)\)$/u, "")
  .replace(/-\d{8}$/u, "").replace(/(claude[^/]*)/gu, name => name.replace(/(?<=\d)\.(?=\d)/gu, "-"));
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
type Tariff = { input: string | null; cacheRead: string | null; cacheWrite: string | null; output: string | null };
const rate = (value: unknown): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) return null;
  const pico = Math.round(value * 1_000_000);
  return Number.isSafeInteger(pico) ? String(pico) : null;
};

/** Refresh is explicit from a bounded downloaded public catalog, never a hidden
 * build-time fetch. This preserves a dated source hash and reproducible aliases. */
async function refresh(path: string, retrievedAt: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(retrievedAt) || new Date(`${retrievedAt}T00:00:00Z`).toISOString().slice(0, 10) !== retrievedAt) throw new Error("Invalid catalog date");
  const cap = 16 * 1024 * 1024;
  const file = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes: Buffer;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > cap) throw new Error("Catalog must be a regular file at most 16 MiB");
    const bounded = Buffer.alloc(cap + 1);
    let length = 0;
    while (length <= cap) {
      const read = await file.read(bounded, length, bounded.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > cap) throw new Error("Catalog exceeds 16 MiB");
    bytes = bounded.subarray(0, length);
  } finally { await file.close(); }
  const catalog = object(JSON.parse(bytes.toString("utf8")) as unknown);
  if (!catalog || Object.keys(catalog).length > 1024) throw new Error("Invalid provider catalog");
  const source = await readFile(resolve(root, "vendor/tokscale-core/src/clients.rs"), "utf8");
  const clients = [...source.matchAll(/^    \w+ = \d+ => \{\s*id: "([^"]+)",\s*display: "([^"]+)"/gmu)].map(match => ({ id: match[1], name: match[2] }));
  if (clients.length !== 53) throw new Error("Review changed upstream client registry");
  clients.push({ id: "9router", name: "9Router" }, { id: "synthetic", name: "Synthetic / Octofriend" });
  const models = new Set<string>(), providers = new Set<string>();
  const candidates = new Map<string, Tariff | null>();
  for (const [provider, raw] of Object.entries(catalog)) {
    if (!identity.test(provider)) continue;
    providers.add(provider);
    const entries = object(object(raw)?.models);
    if (!entries || Object.keys(entries).length > 10_000) continue;
    for (const [name, record] of Object.entries(entries)) {
      const aliases = [...new Set([name.toLowerCase(), canonical(name)])].filter(value => identity.test(value));
      for (const alias of aliases) models.add(alias);
      const cost = object(object(record)?.cost);
      // Context-tier, image/audio and subscription costs cannot be inferred
      // from aggregate text token counts. Keep those unpriced.
      if (!cost || Object.keys(cost).some(key => !["input", "output", "cache_read", "cache_write"].includes(key))) continue;
      const tariff: Tariff = { input: rate(cost.input), cacheRead: rate(cost.cache_read), cacheWrite: rate(cost.cache_write), output: rate(cost.output) };
      if (tariff.input === null || tariff.output === null || !Object.values(tariff).some(value => value !== null && value !== "0")) continue;
      for (const alias of aliases) {
        const key = `${provider}\0${alias}`, before = candidates.get(key);
        candidates.set(key, before !== undefined && JSON.stringify(before) !== JSON.stringify(tariff) ? null : tariff);
      }
    }
  }
  for (const name of SESSION_MODELS) { models.add(name); models.add(canonical(name)); }
  for (const provider of ["openai", "anthropic", "google", "cognition", "github", "cursor", "factory", "sakana"]) providers.add(provider);
  const provenance = { url: "https://models.dev/api.json", retrievedAt, sha256: createHash("sha256").update(bytes).digest("hex") };
  const registry = { schemaVersion: 1, revision: 1, source: { clients: { url: "https://github.com/junhoyeo/tokscale", commit: "d8fd670a46857e5290e71b10245dc522a344fc17", license: "MIT" }, models: provenance },
    clients: clients.sort((a, b) => a.id < b.id ? -1 : 1), providers: [...providers].sort(), models: [...models].sort() };
  const prices = { schemaVersion: 1, registryRevision: 1, source: provenance, unit: "picousd-per-token", basis: "dated-retail-estimate", rates: Object.fromEntries([...candidates].filter(([, rate]) => rate !== null).sort(([a], [b]) => a < b ? -1 : 1)) };
  await writeFile(resolve(root, "data/usage-registry.json"), JSON.stringify(registry, null, 2) + "\n");
  await writeFile(resolve(root, "data/usage-prices.json"), JSON.stringify(prices, null, 2) + "\n");
  console.log(JSON.stringify({ clients: clients.length, providers: providers.size, models: models.size, tariffs: Object.keys(prices.rates).length }));
}
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--source" || args[2] !== "--retrieved-at") throw new Error("Usage: bun scripts/usage-catalog.ts --source PUBLIC_CATALOG_JSON --retrieved-at YYYY-MM-DD");
await refresh(args[1], args[3]);
