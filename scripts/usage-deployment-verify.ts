import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_DELIVERY_PROOF_HEADER, productionDeliveryProofToken } from "@hraness/vercel-delivery";
import { z } from "zod";

/**
 * Exact-deployment health verifier (plan Phase 12).
 *
 * Given one Git commit, it reads the GitHub Production deployment records for
 * that commit, resolves the Vercel deployment and project identity behind the
 * successful deployment, recomputes the delivery-proof token that
 * `@hraness/vercel-delivery` binds into every response, and checks that the
 * canonical origin serves the fixed page set with HTTP 200 and that exact
 * token. It writes one receipt only when every check passes. It never
 * deploys, promotes, aliases, or changes provider configuration.
 *
 * Passing proves that the canonical alias currently serves a Vercel build of
 * the named commit for the registered project. It does not establish
 * authenticated product journeys, Cloudflare Worker deployment, feature-flag
 * state, or data invariants; those have their own documented evidence.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHA = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/u;
const PROJECT_ID = /^prj_[A-Za-z0-9]+$/u;
const REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/u;
const SCOPE = /^[a-z0-9-]+$/u;
const VERCEL_URL = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+vercel\.app$/u;
const MAX_PROCESS_OUTPUT = 1_048_576;
const FETCH_TIMEOUT_MS = 15_000;
export const HEALTH_PATHS = Object.freeze(["/", "/dashboard", "/usage/sessions"] as const);

export type ProcessOutcome = { code: number | null; stdout: string; stderr: string };
export type FetchOutcome = { status: number; headers: { get(name: string): string | null } };
export type Host = {
  exec(command: string, args: readonly string[]): Promise<ProcessOutcome>;
  fetch(url: string): Promise<FetchOutcome>;
  now(): Date;
};

export type Options = {
  sha: string | null;
  repository: string;
  origin: string;
  projectName: string;
  scope: string;
  deploymentId: string | null;
  projectId: string | null;
  output: string;
};

export const defaultOptions: Options = Object.freeze({
  sha: null, repository: "hraness/aicharts", origin: "https://aicharts.io", projectName: "aicharts", scope: "hraness",
  deploymentId: null, projectId: null, output: "target/assurance/deployment/receipt.json",
});

// A function declaration (explicitly typed) lets control-flow analysis treat
// each call as an assertion that never returns.
function fail(code: string): never { throw new Error(`deployment_verify_${code}`); }

export function parseArguments(argv: readonly string[], base: Options = defaultOptions): Options {
  const options = { ...base };
  const flags: Record<string, keyof Options> = {
    "--sha": "sha", "--repository": "repository", "--origin": "origin", "--project-name": "projectName", "--scope": "scope",
    "--deployment-id": "deploymentId", "--project-id": "projectId", "--output": "output",
  };
  for (let index = 0; index < argv.length; index += 2) {
    const key = flags[argv[index] ?? ""], value = argv[index + 1];
    if (key === undefined || value === undefined || value.startsWith("--")) fail("invalid_arguments");
    options[key] = value;
  }
  if (options.sha !== null && !SHA.test(options.sha)) fail("invalid_arguments");
  if (!REPOSITORY.test(options.repository) || !SCOPE.test(options.scope) || !SCOPE.test(options.projectName)) fail("invalid_arguments");
  if (!/^https:\/\/[a-z0-9.-]+$/u.test(options.origin)) fail("invalid_arguments");
  if ((options.deploymentId === null) !== (options.projectId === null)) fail("invalid_arguments");
  if (options.deploymentId !== null && !DEPLOYMENT_ID.test(options.deploymentId)) fail("invalid_arguments");
  if (options.projectId !== null && !PROJECT_ID.test(options.projectId)) fail("invalid_arguments");
  if (options.output.length === 0 || options.output.includes("\0")) fail("invalid_arguments");
  return options;
}

const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u);
const deploymentSchema = z.object({
  id: z.number().int().positive(), sha: z.string().regex(SHA), environment: z.string().min(1).max(64),
  created_at: timestamp, task: z.string().max(64).optional(),
}).passthrough();
const statusSchema = z.object({
  id: z.number().int().positive(), state: z.enum(["error", "failure", "inactive", "in_progress", "queued", "pending", "success"]),
  created_at: timestamp, environment_url: z.string().nullable().optional(), environment: z.string().optional(),
}).passthrough();

function parseJson(text: string, code: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { return fail(code); }
}

const completed = (outcome: ProcessOutcome) => outcome.code === 0 && outcome.stdout.length <= MAX_PROCESS_OUTPUT;

async function githubApi(host: Host, path: string): Promise<unknown> {
  const outcome = await host.exec("gh", ["api", "-H", "Accept: application/vnd.github+json", path]);
  if (!completed(outcome)) fail("github_api_failed");
  return parseJson(outcome.stdout, "github_api_invalid");
}

export type GitHubDeployment = {
  deploymentId: number; environment: string; createdAt: string;
  status: { id: number; state: "success"; createdAt: string; environmentUrl: string };
  productionDeploymentsForSha: number;
};

/** Selects the newest successful Production deployment of the exact commit. */
export async function readGitHubDeployment(host: Host, repository: string, sha: string): Promise<GitHubDeployment> {
  const listed = z.array(deploymentSchema).max(100).safeParse(await githubApi(host, `repos/${repository}/deployments?sha=${sha}&per_page=100`));
  if (!listed.success) fail("github_api_invalid");
  const production = listed.data.filter(row => row.sha === sha && row.environment === "Production");
  if (production.length === 0) fail("github_deployment_missing");
  let selected: GitHubDeployment | null = null;
  for (const row of production) {
    const statuses = z.array(statusSchema).max(100).safeParse(await githubApi(host, `repos/${repository}/deployments/${row.id}/statuses?per_page=100`));
    if (!statuses.success) fail("github_api_invalid");
    // The newest status is authoritative; an earlier success superseded by a
    // failure or inactivity is not a live deployment.
    const newest = [...statuses.data].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0];
    if (newest === undefined || newest.state !== "success") continue;
    const environmentUrl = newest.environment_url ?? null;
    if (environmentUrl === null || !VERCEL_URL.test(environmentUrl)) fail("github_environment_url_invalid");
    const candidate: GitHubDeployment = {
      deploymentId: row.id, environment: row.environment, createdAt: row.created_at,
      status: { id: newest.id, state: "success", createdAt: newest.created_at, environmentUrl },
      productionDeploymentsForSha: production.length,
    };
    if (selected === null || candidate.status.createdAt > selected.status.createdAt) selected = candidate;
  }
  return selected ?? fail("github_deployment_unsuccessful");
}

export type VercelIdentity = {
  deploymentId: string; projectId: string; projectName: string; target: "production"; status: "Ready";
  url: string; aliases: readonly string[]; source: "vercel-inspect" | "explicit";
};

const inspectField = (text: string, label: string, pattern: RegExp) => {
  const match = new RegExp(`^\\s+${label}\\s+(${pattern.source})\\s*$`, "mu").exec(text);
  return match?.[1] ?? null;
};

/** Parses the human-readable `vercel inspect` and `vercel project inspect`
 * outputs. Every required field must be present with its exact expected
 * shape; missing or ambiguous fields fail closed. */
export function parseVercelInspect(deploymentText: string, projectText: string, expected: { projectName: string; url: string }): Omit<VercelIdentity, "source"> {
  const deploymentId = inspectField(deploymentText, "id", /dpl_[A-Za-z0-9]+/u);
  const name = inspectField(deploymentText, "name", /[a-z0-9-]+/u);
  const target = inspectField(deploymentText, "target", /[a-z]+/u);
  const status = inspectField(deploymentText, "status", /[●○◌•]? ?[A-Za-z]+/u)?.replace(/^[●○◌•] ?/u, "") ?? null;
  const url = inspectField(deploymentText, "url", /https:\/\/[a-z0-9.-]+/u);
  const aliasStart = deploymentText.search(/^\s+Aliases\s*$/mu);
  const afterAliases = aliasStart === -1 ? "" : deploymentText.slice(aliasStart + "Aliases".length + 2);
  const aliasEnd = afterAliases.search(/^\s+(?:Builds|General|Build Machine)\s*$/mu);
  const aliasSection = aliasEnd === -1 ? afterAliases : afterAliases.slice(0, aliasEnd);
  const aliases = [...aliasSection.matchAll(/https:\/\/[a-z0-9.-]+/gu)].map(match => match[0]);
  const projectId = inspectField(projectText, "ID", /prj_[A-Za-z0-9]+/u);
  const projectName = inspectField(projectText, "Name", /[a-z0-9-]+/u);
  if (deploymentId === null || !DEPLOYMENT_ID.test(deploymentId) || projectId === null || !PROJECT_ID.test(projectId)) fail("vercel_inspect_invalid");
  if (name !== expected.projectName || projectName !== expected.projectName) fail("vercel_identity_mismatch");
  if (target !== "production" || status !== "Ready") fail("vercel_deployment_not_ready");
  if (url !== expected.url) fail("vercel_identity_mismatch");
  return { deploymentId, projectId, projectName, target: "production", status: "Ready", url, aliases: Object.freeze(aliases) };
}

async function resolveVercelIdentity(host: Host, options: Options, deployment: GitHubDeployment): Promise<VercelIdentity> {
  if (options.deploymentId !== null && options.projectId !== null) {
    return { deploymentId: options.deploymentId, projectId: options.projectId, projectName: options.projectName, target: "production",
      status: "Ready", url: deployment.status.environmentUrl, aliases: Object.freeze([]), source: "explicit" };
  }
  const inspected = await host.exec("vercel", ["inspect", deployment.status.environmentUrl, "--scope", options.scope]);
  const project = await host.exec("vercel", ["project", "inspect", options.projectName, "--scope", options.scope]);
  if (!completed(inspected) || !completed(project)) fail("vercel_inspect_failed");
  // The Vercel CLI prints its human-readable report on stderr; both streams are
  // parsed with the same exact field shapes.
  const identity = parseVercelInspect(`${inspected.stdout}\n${inspected.stderr}`, `${project.stdout}\n${project.stderr}`,
    { projectName: options.projectName, url: deployment.status.environmentUrl });
  // The canonical origin must be an alias of this exact deployment; otherwise
  // a health check against the origin would measure a different build.
  if (!identity.aliases.includes(options.origin)) fail("vercel_alias_missing");
  return { ...identity, source: "vercel-inspect" };
}

export type HealthCheck = { path: string; status: number; token: string };

export async function checkHealth(host: Host, origin: string, expectedToken: string): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  for (const path of HEALTH_PATHS) {
    const response = await host.fetch(`${origin}${path}`);
    const token = response.headers.get(PRODUCTION_DELIVERY_PROOF_HEADER);
    if (response.status !== 200) fail("health_status");
    if (token !== expectedToken) fail("proof_mismatch");
    checks.push({ path, status: response.status, token });
  }
  return checks;
}

export type Receipt = {
  schemaVersion: 1; operation: "production-deployment-verification"; claim: "exact-deployment-health-only";
  verifiedAt: string; repository: string; sha: string; origin: string;
  github: GitHubDeployment; vercel: VercelIdentity; proof: { header: string; expectedToken: string };
  checks: HealthCheck[]; limits: string[];
};

export async function verifyDeployment(options: Options, host: Host): Promise<Receipt> {
  let sha = options.sha;
  if (sha === null) {
    const head = await host.exec("git", ["rev-parse", "HEAD"]);
    sha = head.stdout.trim();
    if (!completed(head) || !SHA.test(sha)) fail("sha_unresolved");
  }
  const github = await readGitHubDeployment(host, options.repository, sha);
  const vercel = await resolveVercelIdentity(host, options, github);
  const expectedToken = productionDeliveryProofToken({ deploymentId: vercel.deploymentId, projectId: vercel.projectId, projectName: vercel.projectName, sha });
  const checks = await checkHealth(host, options.origin, expectedToken);
  return {
    schemaVersion: 1, operation: "production-deployment-verification", claim: "exact-deployment-health-only",
    verifiedAt: host.now().toISOString().replace(/\.\d{3}Z$/u, "Z"), repository: options.repository, sha, origin: options.origin,
    github, vercel, proof: { header: PRODUCTION_DELIVERY_PROOF_HEADER, expectedToken }, checks,
    limits: [
      "Proves the canonical origin serves a Vercel build of this commit for the registered project; nothing more.",
      "Does not establish authenticated product journeys, Cloudflare Worker deployment, feature-flag state or data invariants.",
      "Explicit --deployment-id/--project-id input is caller-supplied identity, not provider readback.",
    ],
  };
}

export async function writeReceipt(receipt: Receipt, output: string): Promise<string> {
  const path = isAbsolute(output) ? output : resolve(root, output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  return path;
}

function execute(command: string, args: readonly string[]): Promise<ProcessOutcome> {
  return new Promise((resolveOutcome, reject) => {
    const child = spawn(command, [...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "", stderr = "", exceeded = false;
    const collect = (sink: "stdout" | "stderr") => (chunk: Buffer) => {
      if (stdout.length + stderr.length + chunk.length > MAX_PROCESS_OUTPUT) { exceeded = true; child.kill("SIGKILL"); return; }
      if (sink === "stdout") stdout += chunk.toString("utf8"); else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", collect("stdout")); child.stderr.on("data", collect("stderr"));
    child.once("error", reject);
    child.once("close", code => resolveOutcome({ code: exceeded ? null : code, stdout, stderr }));
  });
}

export const processHost: Host = {
  exec: execute,
  fetch: async url => {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "text/html" } });
    await response.body?.cancel();
    return { status: response.status, headers: response.headers };
  },
  now: () => new Date(),
};

export async function main(argv: readonly string[], host: Host = processHost): Promise<number> {
  const options = parseArguments(argv);
  const receipt = await verifyDeployment(options, host);
  const path = await writeReceipt(receipt, options.output);
  console.log(JSON.stringify({ operation: receipt.operation, sha: receipt.sha, deploymentId: receipt.vercel.deploymentId, checks: receipt.checks.length, receipt: path }));
  return 0;
}

if (import.meta.main) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) {
    const code = error instanceof Error && error.message.startsWith("deployment_verify_") ? error.message : "deployment_verify_failed";
    console.error(JSON.stringify({ operation: "production-deployment-verification", ok: false, error: code }));
    process.exitCode = 1;
  }
}
