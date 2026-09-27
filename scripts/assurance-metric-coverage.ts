// Metric-to-view coverage check: every registry row's declared support state and surfaces are
// cross-checked against the real explorer, rich explorer, catalog and export modules.
// Claim: declared coverage is consistent with shipped code. Not a live qualification.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { generateMetricCatalog, projectMetricCatalog } from "./generate-metric-catalog";
import { metricSupportErrors, metricSupportStates, metricUnavailableReasons } from "./assurance-registry";
import { METRIC_CATALOG, MAX_METRIC_CATALOG_BYTES } from "../lib/usage/metric-explorer-catalog";
import { createMetricSnapshot, disposeMetricSnapshot, evaluateMetricQuery, MAX_METRIC_QUERY_IDS, metricResultJson, SUPPORTED_METRIC_IDS } from "../lib/usage/metric-explorer";
import { METRIC_REASON_TEXT, metricDefinition, unavailableMetricReason } from "../lib/usage/metric-explorer-values";
import { RICH_SUPPORTED_METRIC_IDS } from "../lib/usage/rich-metric-explorer";
import { evaluateRichExplorerQuery, openRichFactsDocument, parseRichExplorerQuery, richExplorerResultJson } from "../lib/usage/rich-metric-explorer-view";
import { metricExplorerViewGaps } from "../lib/usage/metric-explorer-views";
import { createUsageStatsExample } from "../lib/usage/stats-example";
import { metricCsv, richMetricCsv } from "../lib/usage/metric-export";
import { SESSION_EXAMPLE } from "../lib/usage/session-example";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const surface = z.union([z.literal(true), z.string().min(1)]);
const row = z.object({
  id: z.string(), status: z.enum(["planned", "implemented", "qualified"]), shipping: z.string(),
  supportState: z.enum(metricSupportStates), unavailableReason: z.enum(metricUnavailableReasons).optional(),
  surfaces: z.object({ view: surface, filters: surface, drilldown: surface, export: surface }).strict(),
}).passthrough();

export type CoverageResult = Readonly<{ ok: boolean; errors: readonly string[]; counts: Readonly<Record<string, number>>; claim: string }>;

async function explorerExports(ids: readonly string[]): Promise<Set<string>> {
  const exported = new Set<string>();
  const snapshot = createMetricSnapshot(createUsageStatsExample(20_700));
  if (!snapshot) throw new Error("example snapshot unavailable");
  try {
    for (let index = 0; index < ids.length; index += MAX_METRIC_QUERY_IDS) {
      const metricIds = ids.slice(index, index + MAX_METRIC_QUERY_IDS);
      const result = evaluateMetricQuery(snapshot, { schemaVersion: 1, firstUtcDay: 20_670, dayCount: 31, filters: { client: "*", provider: "*", model: "*" },
        basis: "reported", costKind: "reported", groupBy: ["client"], metricIds, topK: 10, sortBy: metricIds[0], sortDirection: "desc" });
      if (!result.ok) throw new Error(`explorer query failed: ${result.code}`);
      const json = JSON.parse(await metricResultJson(result.value)) as { measures?: readonly { id: string }[] };
      for (const id of metricIds) {
        const csv = await metricCsv(result.value, id);
        if (json.measures?.some(measure => measure.id === id) && csv.startsWith("metric_id,") && csv.includes(`\r\n${id},1,`)) exported.add(id);
      }
    }
  } finally { disposeMetricSnapshot(snapshot); }
  return exported;
}

async function richExports(ids: readonly string[]): Promise<Set<string>> {
  const exported = new Set<string>();
  const opened = await openRichFactsDocument(JSON.stringify(SESSION_EXAMPLE));
  if (!opened.ok) throw new Error(`session example unavailable: ${opened.error}`);
  const document = opened.value;
  for (const id of ids) {
    const query = parseRichExplorerQuery({ schemaVersion: 1, metricId: id, quantity: "total",
      selection: { window: { startMs: document.report.window.startMs, endMs: document.report.window.endMs }, grain: "request", tokenScope: "direct", lineage: "all" },
      filters: { provider: "*", model: "*", session: "*" }, groupBy: ["provider"], topK: 10, timeZone: null });
    if (!query) continue;
    const result = evaluateRichExplorerQuery(document, query);
    if (!result.ok) continue;
    const json = JSON.parse(richExplorerResultJson(result.value)) as { measure?: { id: string } };
    const csv = richMetricCsv(result.value);
    if (json.measure?.id === id && csv.startsWith("metric_id,") && csv.includes(`\r\n${id},1,`)) exported.add(id);
  }
  return exported;
}

export async function checkMetricCoverage(): Promise<CoverageResult> {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  const document = JSON.parse(await readFile(resolve(root, "verify/assurance/metrics.json"), "utf8")) as unknown;
  const rows = z.object({ schemaVersion: z.literal(1), metrics: z.array(row) }).passthrough().parse(document).metrics;
  const explorer = new Set(SUPPORTED_METRIC_IDS), rich = new Set(RICH_SUPPORTED_METRIC_IDS);
  for (const id of explorer) if (rich.has(id)) errors.push(`${id}: listed by both the aggregate explorer and the rich explorer`);
  const exportedExplorer = await explorerExports([...explorer]);
  const exportedRich = await richExports([...rich]);
  const gaps = metricExplorerViewGaps();
  for (const id of gaps.unlisted) errors.push(`focused views: family of ${id} is not covered by any focused view`);
  for (const id of gaps.duplicated) errors.push(`focused views: ${id} appears in more than one view`);
  try {
    const catalog = await generateMetricCatalog(true);
    if (catalog.bytes > MAX_METRIC_CATALOG_BYTES) errors.push("catalog: projection exceeds byte budget");
    const projected = projectMetricCatalog(document);
    if (JSON.stringify(projected) !== JSON.stringify([...METRIC_CATALOG])) errors.push("catalog: shipped projection drifted from registry");
  } catch (error) { errors.push(`catalog: ${error instanceof Error ? error.message : "stale"}`); }
  for (const state of metricSupportStates) counts[state] = 0;
  for (const entry of rows) {
    counts[entry.supportState] += 1;
    errors.push(...metricSupportErrors(entry));
    const definition = metricDefinition(entry.id);
    if (!definition) { errors.push(`${entry.id}: missing from shipped catalog`); continue; }
    const implemented = explorer.has(entry.id) || rich.has(entry.id);
    const declaredImplemented = entry.supportState === "implemented-qualified" || entry.supportState === "implemented-unqualified" || entry.supportState === "activation-gated";
    if (implemented && !declaredImplemented) errors.push(`${entry.id}: shipped by code but registry says ${entry.supportState}`);
    if (!implemented && declaredImplemented) errors.push(`${entry.id}: registry says ${entry.supportState} but no explorer implements it`);
    if (declaredImplemented) {
      for (const [name, value] of Object.entries(entry.surfaces)) if (value !== true) errors.push(`${entry.id}: implemented row lacks the ${name} surface (${value})`);
      const exported = explorer.has(entry.id) ? exportedExplorer.has(entry.id) : exportedRich.has(entry.id);
      if (!exported) errors.push(`${entry.id}: export surface declared but no export function emits it`);
    } else {
      const expected = unavailableMetricReason(definition);
      if (entry.unavailableReason !== expected) errors.push(`${entry.id}: unavailable reason ${entry.unavailableReason ?? "missing"} differs from the shipped reason ${expected}`);
      if (entry.unavailableReason && !(entry.unavailableReason in METRIC_REASON_TEXT)) errors.push(`${entry.id}: reason ${entry.unavailableReason} has no user-facing text`);
      if (entry.surfaces.view !== "unavailable-reason") errors.push(`${entry.id}: unavailable metric must render its reason as the view surface`);
      if (entry.shipping !== "profile-unobservable" && entry.supportState === "profile-unobservable") errors.push(`${entry.id}: observable metric marked complete-as-unavailable`);
    }
  }
  counts.explorer = explorer.size; counts.rich = rich.size; counts.rows = rows.length;
  counts.explorerExported = exportedExplorer.size; counts.richExported = exportedRich.size;
  return { ok: errors.length === 0, errors, counts, claim: "declared-coverage-matches-shipped-code; not live-qualified" };
}

if (import.meta.main) {
  const result = await checkMetricCoverage();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
