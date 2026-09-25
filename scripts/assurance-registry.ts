import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import ts from "typescript";
import { z } from "zod";

const text = z.string().trim().min(1).max(4096);
const id = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
const path = text.refine(value => !isAbsolute(value) && !value.split(/[\\/]/u).includes(".."), "repository-relative path required");
const phase = z.enum(["0", "1A", "1B", "1C", "2A", "2B", "3", "4", "5", "6", "7", "7B", "8", "9", "10", "11", "12"]);
const metricFamilies = ["token-volume", "mix", "trends", "typical-sizes", "costs", "cache-economics", "billing-and-limits", "latency-and-generation", "activity-and-concurrency", "sessions-turns-and-agents", "context-and-compaction", "reliability", "coverage-and-freshness", "comparisons", "budgets-and-forecasts", "operations", "benchmark-context"] as const;
const mandatoryControls = new Set(["worker:leaderboard_index", "worker:restore_fence", "worker:fence_lease", "worker:fence_attempt", "worker:account_enrollment", "worker:usage_admission_control", "worker:usage_admission_devices", "worker:usage_stats_control", "worker:usage_stats_devices", "worker:usage_stats_writers", "worker:usage_stats_day_sources", "ledger:sender_binding", "ledger:sender_accepted", "ledger:sender_settled", "r2:enrollment-namespace-anchors"]);
export const metricSupportStates = ["implemented-qualified", "implemented-unqualified", "activation-gated", "planned-incomplete", "profile-unobservable"] as const;
export const metricUnavailableReasons = ["needs-observation-facts", "needs-billing-evidence", "needs-source-health", "needs-tariff-evidence", "needs-account-dimensions", "separate-benchmark-population"] as const;
const surface = z.union([z.literal(true), z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u)]);
export function metricSupportErrors(row: { id: string; status: string; shipping: string; supportState: string; surfaces: Record<string, true | string>; unavailableReason?: string }): string[] {
  const errors: string[] = [];
  const implemented = row.supportState === "implemented-qualified" || row.supportState === "implemented-unqualified" || row.supportState === "activation-gated";
  if (implemented && row.status === "planned") errors.push(`${row.id}: ${row.supportState} requires status implemented or qualified`);
  if (!implemented && row.status !== "planned") errors.push(`${row.id}: status ${row.status} requires an implemented support state`);
  if ((row.supportState === "implemented-qualified") !== (row.status === "qualified")) errors.push(`${row.id}: implemented-qualified and status qualified must agree`);
  if (row.supportState === "profile-unobservable" && row.shipping !== "profile-unobservable") errors.push(`${row.id}: observable metric marked profile-unobservable`);
  if (row.shipping === "profile-unobservable" && row.supportState === "planned-incomplete") errors.push(`${row.id}: unobservable metric must be profile-unobservable, not planned`);
  if (implemented && row.surfaces.view !== true) errors.push(`${row.id}: implemented metric lacks a declared view surface`);
  if (implemented && row.unavailableReason !== undefined) errors.push(`${row.id}: implemented metric carries an unavailable reason`);
  if (!implemented && row.unavailableReason === undefined) errors.push(`${row.id}: ${row.supportState} requires an unavailable reason`);
  if (!implemented && Object.values(row.surfaces).some(value => value === true)) errors.push(`${row.id}: ${row.supportState} metric declares a live surface`);
  return errors;
}
const metric = z.object({
  id, version: z.literal(1), family: z.enum(metricFamilies), question: text, unit: text, grain: text,
  sourceCapabilities: z.array(text).min(1), numerator: text, denominator: text.nullable(),
  aggregation: text, rounding: text, dimensions: z.array(text), correction: text, coverage: text,
  availability: z.enum(["existing-aggregate", "local-profile", "new-facts", "billing-evidence"]),
  shipping: z.enum(["required", "source-conditional", "profile-unobservable"]),
  producer: text, implementationPhase: phase, uiPhase: z.enum(["7", "7B", "9"]),
  status: z.enum(["planned", "implemented", "qualified"]),
  supportState: z.enum(metricSupportStates), surfaces: z.object({ view: surface, filters: surface, drilldown: surface, export: surface }).strict(),
  unavailableReason: z.enum(metricUnavailableReasons).optional(), evidence: z.array(path).min(1),
  exactness: z.object({ kind: z.enum(["exact", "model", "explicit-approximation"]), contract: text }).strict(),
  acceptance: z.array(z.object({ id, obligation: text }).strict()).min(1),
  verification: z.array(path),
}).strict();
const metricReceipt = z.object({
  schemaVersion: z.literal(1), kind: z.enum(["metric-regression", "metric-proof"]), metricId: id, metricVersion: z.literal(1),
  cases: z.array(id).min(1), command: text, outcome: z.literal("passed"), assertionCount: z.number().int().positive(),
  sourceSha256: z.record(path, z.string().regex(/^[a-f0-9]{64}$/u)),
  toolchain: z.record(text, text),
}).strict();
const obligation = z.object({
  id: z.string().regex(/^F\d{2}$/u), phase, invariants: z.array(z.string().regex(/^S\d{2}$/u)).min(1),
  regression: id, owner: path, obligation: text, status: z.enum(["open", "fixed", "qualified"]),
  evidenceClass: z.enum(["reproduced", "source-or-assurance-gap"]),
}).strict();
const obligationsSchema = z.object({
  schemaVersion: z.literal(1), auditCommit: z.string().regex(/^[a-f0-9]{40}$/u), phases: z.array(phase),
  invariants: z.array(z.object({ id: z.string().regex(/^S\d{2}$/u), name: text, contract: text }).strict()),
  findings: z.array(obligation), proofClaim: text,
}).strict();
const capacitiesSchema = z.object({
  schemaVersion: z.literal(1), capacities: z.array(z.object({
    id, scope: id, unit: z.enum(["count", "bytes", "milliseconds"]), value: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    source: z.object({ path, symbol: z.string().regex(/^[A-Z][A-Z_0-9]*$/u) }).strict(),
  }).strict()).min(1),
  relations: z.array(z.object({ left: id, right: id, relation: z.literal("equal"), status: z.enum(["enforced", "known-defect"]), finding: z.string().nullable() }).strict()),
  budgetExamples: z.array(z.object({ id, capacity: id, bytesPerItem: z.number().int().positive(), minimumPayloadBytes: z.number().int().positive(), claim: text, finding: text }).strict()),
}).strict();
const surfacesSchema = z.object({ schemaVersion: z.literal(1), scope: text, surfaces: z.array(z.object({
  id: text, table: text.nullable(), owner: path, kind: z.enum(["authoritative", "derived"]), retentionPolicy: id,
  controlEvidence: z.boolean(),
  rebuildFrom: text.nullable(), lifecycleStatus: z.enum(["qualification-required", "qualified"]),
}).strict()).min(1) }).strict();
const retentionSchema = z.object({
  schemaVersion: z.literal(1), status: z.literal("frozen-implementation-contract"), activation: text,
  policies: z.array(z.object({ id, duration: text, physicalReclamation: text, recovery: text }).strict()).min(1),
  objectives: z.object({ rpo: text, rto: text, publicWithdrawal: text }).strict(), reclamationGate: z.array(text).min(1),
}).strict();
const profilesSchema = z.object({
  schemaVersion: z.literal(1), profiles: z.array(z.object({
    id, source: path, grain: text, totalPartition: z.array(text).min(1), subsets: z.record(text, text), unknown: text, coverage: text,
  }).strict()).min(1), conversionRules: z.array(text).min(1),
}).strict();
const capabilitiesSchema = z.object({
  schemaVersion: z.literal(1), registryRevision: z.number().int().positive(),
  clients: z.array(z.object({ id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u), qualification: z.enum(["unreviewed", "fixture-supported", "live-qualified", "limited", "unsupported"]), phase, evidence: z.array(path).min(1), limit: text }).strict()).min(1),
  platforms: z.array(z.object({ id, evidence: path, qualification: text, limit: text }).strict()).min(1),
}).strict();

/** Only decimal literals joined by multiplication are admitted; source is never evaluated. */
export function numericConstant(source: string, symbol: string, language: "typescript" | "rust" = "typescript"): number | null {
  if (!/^[A-Z][A-Z_0-9]*$/u.test(symbol)) return null;
  if (language === "typescript") {
    const file = ts.createSourceFile("capacity.ts", source, ts.ScriptTarget.Latest, true);
    const values: ts.Expression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Const)) for (const declaration of node.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === symbol && declaration.initializer) values.push(declaration.initializer);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    if (values.length !== 1) return null;
    const evaluate = (value: ts.Expression): number | null => {
      if (ts.isNumericLiteral(value)) return Number(value.text.replaceAll("_", ""));
      if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
        const left = evaluate(value.left), right = evaluate(value.right);
        return left === null || right === null ? null : left * right;
      }
      return null;
    };
    const result = evaluate(values[0]);
    return result !== null && Number.isSafeInteger(result) && result >= 0 ? result : null;
  }
  const matches = [...rustDeclarationText(source).matchAll(new RegExp(`\\bconst\\s+${symbol}(?:\\s*:\\s*[A-Za-z0-9_]+)?\\s*=\\s*([^;]+);`, "gu"))];
  const match = matches.length === 1 ? matches[0] : null;
  if (!match || !/^\s*\d[\d_]*(?:\s*\*\s*\d[\d_]*)*\s*$/u.test(match[1])) return null;
  const value = match[1].split("*").reduce((product, token) => product * Number(token.replaceAll("_", "").trim()), 1);
  return Number.isSafeInteger(value) ? value : null;
}

/** Mask comments (including nested Rust comments) and strings before declaration discovery. */
function rustDeclarationText(source: string): string {
  let result = "", index = 0;
  while (index < source.length) {
    const start = index;
    if (source.startsWith("//", index)) { index = source.indexOf("\n", index); if (index < 0) index = source.length; }
    else if (source.startsWith("/*", index)) {
      index += 2; let depth = 1;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) { depth++; index += 2; }
        else if (source.startsWith("*/", index)) { depth--; index += 2; }
        else index++;
      }
    } else {
      const raw = /^(?:b|c)?r(#{0,255})"/u.exec(source.slice(index));
      if (raw) { const end = source.indexOf(`"${raw[1]}`, index + raw[0].length); index = end < 0 ? source.length : end + raw[1].length + 1; }
      else if (source[index] === '"') {
        index++; while (index < source.length) { if (source[index] === "\\") index += 2; else if (source[index++] === '"') break; }
      } else { result += source[index++]; continue; }
    }
    result += source.slice(start, index).replace(/[^\n]/gu, " ");
  }
  return result;
}

function sqlTables(source: string): string[] {
  return [...source.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z_0-9]*)/giu)].map(match => match[1]);
}

export type RegistryReader = Readonly<{
  read: (path: string) => string;
  exists: (path: string) => boolean;
  sqlSources: () => readonly string[];
}>;
export type RegistryResult = Readonly<{ ok: boolean; errors: readonly string[]; gaps: readonly string[]; counts: Readonly<Record<string, number>> }>;

/** A passing inventory proves consistency of declarations, not correctness of listed code. */
export function checkAssuranceRegistry(reader: RegistryReader): RegistryResult {
  const errors: string[] = [], gaps: string[] = [];
  const counts: Record<string, number> = {};
  const parse = <T>(name: string, schema: z.ZodType<T>): T | null => {
    try {
      const parsed = schema.safeParse(JSON.parse(reader.read(`verify/assurance/${name}.json`)) as unknown);
      if (parsed.success) return parsed.data;
      errors.push(`${name}: invalid schema (${parsed.error.issues.map(issue => issue.path.join(".")).join(", ")})`);
    } catch { errors.push(`${name}: unreadable JSON`); }
    return null;
  };
  const unique = (values: readonly string[], label: string) => {
    if (new Set(values).size !== values.length) errors.push(`${label}: duplicate IDs`);
  };
  const links = (values: readonly string[], label: string) => {
    for (const value of values) if (!reader.exists(value)) errors.push(`${label}: missing ${value}`);
  };
  const obligations = parse("obligations", obligationsSchema);
  if (obligations) {
    counts.findings = obligations.findings.length; counts.invariants = obligations.invariants.length;
    unique(obligations.findings.map(row => row.id), "findings");
    unique(obligations.invariants.map(row => row.id), "invariants");
    unique(obligations.phases, "phases");
    const expected = (prefix: string, size: number) => Array.from({ length: size }, (_, index) => `${prefix}${String(index + 1).padStart(2, "0")}`);
    for (const value of expected("F", 26)) if (!obligations.findings.some(row => row.id === value)) errors.push(`missing finding ${value}`);
    for (const value of expected("S", 16)) if (!obligations.invariants.some(row => row.id === value)) errors.push(`missing invariant ${value}`);
    for (const row of obligations.findings) {
      links([row.owner], row.id);
      if (!obligations.phases.includes(row.phase)) errors.push(`${row.id}: unknown phase`);
      for (const value of row.invariants) if (!obligations.invariants.some(item => item.id === value)) errors.push(`${row.id}: missing invariant ${value}`);
      if (row.status === "open") gaps.push(`${row.id}: ${row.obligation}`);
    }
  }
  const metrics = parse("metrics", z.object({ schemaVersion: z.literal(1), metrics: z.array(metric).min(1).max(1024) }).strict());
  if (metrics) {
    const rows = metrics.metrics;
    counts.metrics = rows.length; counts.metricFamilies = new Set(rows.map(row => row.family)).size;
    unique(rows.map(row => row.id), "metrics");
    if (counts.metricFamilies !== 17) errors.push("metrics: all 17 catalog families required");
    for (const state of metricSupportStates) counts[`metrics:${state}`] = rows.filter(row => row.supportState === state).length;
    for (const row of rows) {
      links(row.evidence, row.id);
      errors.push(...metricSupportErrors(row));
      unique(row.acceptance.map(item => item.id), `${row.id}: acceptance`);
      const executed = new Set<string>();
      for (const receiptPath of row.verification) {
        try {
          const receipt = metricReceipt.parse(JSON.parse(reader.read(receiptPath)) as unknown);
          if (receipt.metricId !== row.id || receipt.metricVersion !== row.version) throw new Error("wrong metric");
          const sources = Object.entries(receipt.sourceSha256);
          if (!sources.some(([file]) => /\.(?:ts|rs|lean)$/u.test(file)) || Object.keys(receipt.toolchain).length === 0) throw new Error("unattributed receipt");
          for (const [file, digest] of sources) {
            if (createHash("sha256").update(reader.read(file)).digest("hex") !== digest) throw new Error("source drift");
          }
          for (const caseId of receipt.cases) {
            if (!row.acceptance.some(item => item.id === caseId)) throw new Error("unknown case");
            executed.add(caseId);
          }
        } catch { errors.push(`${row.id}: invalid or stale verification receipt ${receiptPath}`); }
      }
      if (row.status === "qualified" && row.acceptance.some(item => !executed.has(item.id))) errors.push(`${row.id}: qualification requires executed acceptance receipts`);
    }
  }
  const capacities = parse("capacities", capacitiesSchema);
  if (capacities) {
    counts.capacities = capacities.capacities.length;
    unique(capacities.capacities.map(row => row.id), "capacities");
    const byId = new Map(capacities.capacities.map(row => [row.id, row]));
    for (const row of capacities.capacities) {
      try { if (numericConstant(reader.read(row.source.path), row.source.symbol, row.source.path.endsWith(".rs") ? "rust" : "typescript") !== row.value) errors.push(`${row.id}: source capacity drift`); }
      catch { errors.push(`${row.id}: unreadable source`); }
    }
    for (const row of capacities.relations) {
      const left = byId.get(row.left), right = byId.get(row.right);
      if (!left || !right || left.unit !== right.unit) { errors.push("capacity relation: missing or incompatible operands"); continue; }
      const equal = left.value === right.value;
      if (row.status === "enforced" && !equal) errors.push(`${row.left}/${row.right}: incompatible capacities`);
      if (row.status === "known-defect") {
        if (equal || !obligations?.findings.some(finding => finding.id === row.finding && finding.status === "open")) errors.push(`${row.left}/${row.right}: stale defect exemption`);
        else gaps.push(`${row.finding}: ${row.left}=${left.value}, ${row.right}=${right.value}`);
      }
    }
    for (const row of capacities.budgetExamples) {
      const capacity = byId.get(row.capacity);
      if (!capacity || BigInt(capacity.value) * BigInt(row.bytesPerItem) !== BigInt(row.minimumPayloadBytes)) errors.push(`${row.id}: budget arithmetic drift`);
    }
  }
  const retention = parse("retention", retentionSchema);
  if (retention) { counts.retentionPolicies = retention.policies.length; unique(retention.policies.map(row => row.id), "retention"); }
  const profiles = parse("profiles", profilesSchema);
  if (profiles) for (const row of profiles.profiles) {
    links([row.source], row.id); unique(row.totalPartition, `${row.id}: partition`);
    for (const [subset, containing] of Object.entries(row.subsets)) if (row.totalPartition.includes(subset) || !row.totalPartition.includes(containing)) errors.push(`${row.id}: subset double-count or missing parent`);
  }
  const surfaces = parse("surfaces", surfacesSchema);
  if (surfaces) {
    counts.surfaces = surfaces.surfaces.length; unique(surfaces.surfaces.map(row => row.id), "surfaces");
    for (const control of mandatoryControls) if (!surfaces.surfaces.some(row => row.id === control)) errors.push(`${control}: missing mandatory authority control`);
    for (const row of surfaces.surfaces) {
      links([row.owner], row.id);
      if (!retention?.policies.some(policy => policy.id === row.retentionPolicy)) errors.push(`${row.id}: missing retention policy`);
      if (mandatoryControls.has(row.id) && !row.controlEvidence) errors.push(`${row.id}: known authority control cannot be unclassified`);
      if (row.controlEvidence && row.retentionPolicy !== "authority-and-deletion-controls") errors.push(`${row.id}: authority controls require replay-safe retention`);
      if (row.kind === "derived" && !row.rebuildFrom) errors.push(`${row.id}: missing authoritative rebuild source`);
      if (row.table) {
        try { if (!sqlTables(reader.read(row.owner)).includes(row.table)) errors.push(`${row.id}: stale schema declaration`); }
        catch { errors.push(`${row.id}: unreadable schema source`); }
      }
    }
    try {
      for (const source of reader.sqlSources()) for (const table of sqlTables(reader.read(source))) {
        if (!surfaces.surfaces.some(row => row.owner === source && row.table === table)) errors.push(`unregistered SQL table ${source}:${table}`);
      }
    } catch { errors.push("SQL schema discovery failed"); }
  }
  const capabilities = parse("capabilities", capabilitiesSchema);
  if (capabilities) {
    counts.clients = capabilities.clients.length; unique(capabilities.clients.map(row => row.id), "clients");
    for (const row of capabilities.clients) links(row.evidence, row.id);
    for (const row of capabilities.platforms) links([row.evidence], row.id);
    try {
      const registered = z.object({ revision: z.number(), clients: z.array(z.object({ id: text })) }).parse(JSON.parse(reader.read("data/usage-registry.json")) as unknown);
      if (registered.revision !== capabilities.registryRevision || registered.clients.map(row => row.id).sort().join("\n") !== capabilities.clients.map(row => row.id).sort().join("\n")) errors.push("client capability inventory drift");
    } catch { errors.push("unreadable source client registry"); }
  }
  return { ok: errors.length === 0, errors, gaps, counts };
}

export function repositoryReader(root: string): RegistryReader {
  const sources = (directory: string): string[] => readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => {
    if (/^(?:tests?|fixtures?|__tests__)$/u.test(entry.name) || /(?:[._-](?:test|tests|worker)|^tests)\.(?:ts|rs)$/u.test(entry.name)) return [];
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sources(name);
    return entry.isFile() && /\.(?:ts|rs)$/u.test(entry.name) ? [name] : [];
  });
  return {
    read: path => readFileSync(resolve(root, path), "utf8"),
    exists: path => { try { return statSync(resolve(root, path)).isFile(); } catch { return false; } },
    sqlSources: () => [ ...sources("services/usage-worker/src"),
      ...readdirSync(resolve(root, "crates"), { withFileTypes: true }).filter(entry => entry.isDirectory())
        .flatMap(entry => sources(`crates/${entry.name}/src`)),
    ].sort(),
  };
}

if (import.meta.main) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkAssuranceRegistry(repositoryReader(root));
  console.log(JSON.stringify({ ...result, claim: "inventory-consistency-only", root: relative(process.cwd(), root) || "." }, null, 2));
  if (!result.ok) process.exitCode = 1;
}
