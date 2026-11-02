import { expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productionDeliveryProofToken } from "@hraness/vercel-delivery";
import {
  HEALTH_PATHS, RETIRED_PATHS, checkHealth, defaultOptions, main, parseArguments, parseVercelInspect, processHost, readGitHubDeployment, verifyDeployment, writeReceipt,
  type FetchOutcome, type Host, type ProcessOutcome,
} from "./verify-production";

const sha = "fc95b51b6cd44527d154853cb3404ffeb26dcb39";
const deploymentUrl = "https://aicharts-k7kua357c-hraness.vercel.app";
const identity = { deploymentId: "dpl_3TA2bNgxfeQzY7Cf67XF6scjyUrm", projectId: "prj_0ppMfRRMDfiVsQ1JaekoxSZ7Mwgn", projectName: "aicharts", sha };
const token = productionDeliveryProofToken(identity);
const deployments = [{ id: 6647776777, sha, environment: "Production", created_at: "2026-09-24T20:46:52Z", task: "deploy" }];
const statuses = [{ id: 18804685126, state: "success", created_at: "2026-09-24T20:46:52Z", environment_url: deploymentUrl, environment: "Production" }];
const inspectText = `\nVercel CLI 59.23.0 (Node.js 24.20.0)\nFetching deployment "aicharts-k7kua357c-hraness.vercel.app" in hraness\n\n  General\n\n    id\t\t${identity.deploymentId}\n    name\taicharts\n    target\tproduction\n    status\t● Ready\n    url\t\t${deploymentUrl}\n    created\tThu Sep 24 2026 16:45:13 GMT-0400 [2h ago]\n\n  Build Machine\n\n    cores\t4\n\n  Aliases\n\n    ╶ https://aicharts.io\n    ╶ https://www.aicharts.io\n    ╶ https://aicharts-hraness.vercel.app\n    \n\n  Builds\n\n    ┌ .        [0ms]\n    ├── λ index (19.89MB) [iad1]\n`;
const projectText = `\nVercel CLI 59.23.0 (Node.js 24.20.0)\n> Found Project hraness/aicharts [219ms]\n\n  General\n\n    ID\t\t\t\t${identity.projectId}\n    Name\t\t\taicharts\n    Owner\t\t\tHraness\n    Root Directory\t\t.\n`;

type Stub = { deployments?: unknown; statuses?: unknown; inspect?: string; project?: string; responses?: Partial<Record<string, FetchOutcome>>; head?: string };
function host(stub: Stub = {}): Host & { calls: string[][]; requests: string[]; requestMethods: string[] } {
  const calls: string[][] = [];
  const requests: string[] = [];
  const requestMethods: string[] = [];
  const ok = (stdout: string): ProcessOutcome => ({ code: 0, stdout, stderr: "" });
  const response = (status: number, value: string | null): FetchOutcome => ({ status, headers: { get: name => name.toLowerCase() === "x-hraness-delivery-proof" ? value : null } });
  return {
    calls, requests, requestMethods,
    exec: async (command, args) => {
      calls.push([command, ...args]);
      const path = args.at(-1) ?? "";
      if (command === "gh" && path.includes("/statuses")) return ok(JSON.stringify(stub.statuses ?? statuses));
      if (command === "gh") return ok(JSON.stringify(stub.deployments ?? deployments));
      if (command === "git") return ok(`${stub.head ?? sha}\n`);
      // The real Vercel CLI prints its report on stderr, not stdout.
      if (command === "vercel" && args[0] === "inspect") return { code: 0, stdout: "", stderr: stub.inspect ?? inspectText };
      if (command === "vercel" && args[0] === "project") return { code: 0, stdout: "", stderr: stub.project ?? projectText };
      return { code: 1, stdout: "", stderr: "unexpected" };
    },
    fetch: async (url, method) => {
      requests.push(url);
      requestMethods.push(method);
      return stub.responses?.[url] ?? response(RETIRED_PATHS.some(path => url === `https://aicharts.io${path}`) ? 404 : 200, token);
    },
    now: () => new Date("2026-09-24T23:00:00.000Z"),
  };
}

test("argument parsing admits only the documented flags and a complete explicit identity pair", () => {
  expect(parseArguments([]).sha).toBeNull();
  expect(parseArguments(["--sha", sha]).sha).toBe(sha);
  expect(parseArguments(["--deployment-id", identity.deploymentId, "--project-id", identity.projectId]).projectId).toBe(identity.projectId);
  for (const argv of [["--sha"], ["--sha", "abc"], ["--sha", sha.toUpperCase()], ["--deployment-id", identity.deploymentId], ["--project-id", identity.projectId],
    ["--deployment-id", "nope", "--project-id", identity.projectId], ["--origin", "http://aicharts.io"], ["--unknown", "x"], ["--sha", "--sha"], ["--scope", "Hraness"],
    ["--sha", sha, "--sha", sha], ["--output", ""], ["--origin", "https://aicharts.io/usage"], ["--origin", "https://aicharts.io?secret=value"]]) {
    expect(() => parseArguments(argv)).toThrow("deployment_verify_invalid_arguments");
  }
});

test("a successful receipt binds the GitHub deployment, the inspected Vercel identity and the recomputed proof", async () => {
  const stub = host();
  const receipt = await verifyDeployment(parseArguments(["--sha", sha]), stub);
  expect(receipt.github.deploymentId).toBe(6647776777);
  expect(receipt.github.status).toEqual({ id: 18804685126, state: "success", createdAt: "2026-09-24T20:46:52Z", environmentUrl: deploymentUrl });
  expect(receipt.vercel).toEqual({ deploymentId: identity.deploymentId, projectId: identity.projectId, projectName: "aicharts", target: "production",
    status: "Ready", url: deploymentUrl, source: "vercel-inspect", aliases: ["https://aicharts.io", "https://www.aicharts.io", "https://aicharts-hraness.vercel.app"] });
  expect(receipt.proof).toEqual({ header: "X-Hraness-Delivery-Proof", expectedToken: token });
  expect(receipt.checks.map(check => check.path)).toEqual([...HEALTH_PATHS, ...RETIRED_PATHS]);
  expect(receipt.checks.every(check => check.token === token && check.status === (check.kind === "public" ? 200 : 404))).toBe(true);
  expect(stub.requests).toEqual([...HEALTH_PATHS, ...RETIRED_PATHS].map(path => `https://aicharts.io${path}`));
  expect(stub.requests.filter((_, index) => stub.requestMethods[index] === "HEAD"))
    .toEqual(["https://aicharts.io/api/suite-auth/start", "https://aicharts.io/api/suite-auth/callback"]);
  expect(receipt.verifiedAt).toBe("2026-09-24T23:00:00Z");
  expect(receipt.claim).toBe("exact-deployment-benchmark-reference-health");
  expect(stub.calls.map(call => call.join(" "))).toEqual([
    `gh api -H Accept: application/vnd.github+json repos/hraness/aicharts/deployments?sha=${sha}&per_page=100`,
    "gh api -H Accept: application/vnd.github+json repos/hraness/aicharts/deployments/6647776777/statuses?per_page=100",
    `vercel inspect ${deploymentUrl} --scope hraness`,
    "vercel project inspect aicharts --scope hraness",
  ]);
});

test("the commit defaults to git HEAD and supplied identity IDs must match provider readback", async () => {
  const stub = host();
  const receipt = await verifyDeployment(parseArguments(["--deployment-id", identity.deploymentId, "--project-id", identity.projectId]), stub);
  expect(receipt.sha).toBe(sha);
  expect(receipt.vercel.source).toBe("vercel-inspect");
  expect(receipt.vercel.aliases).toContain("https://aicharts.io");
  expect(stub.calls[0]).toEqual(["git", "rev-parse", "HEAD"]);
  expect(stub.calls.filter(call => call[0] === "vercel")).toHaveLength(2);
  await expect(verifyDeployment(parseArguments(["--sha", sha, "--deployment-id", "dpl_other", "--project-id", identity.projectId]), host()))
    .rejects.toThrow("deployment_verify_vercel_identity_mismatch");
  await expect(verifyDeployment(parseArguments(["--sha", sha, "--deployment-id", identity.deploymentId, "--project-id", "prj_other"]), host()))
    .rejects.toThrow("deployment_verify_vercel_identity_mismatch");
  await expect(verifyDeployment(parseArguments([]), host({ head: "not-a-sha" }))).rejects.toThrow("deployment_verify_sha_unresolved");
});

test("GitHub deployment selection fails closed on absent, foreign, unsuccessful or superseded records", async () => {
  await expect(readGitHubDeployment(host({ deployments: [] }), "hraness/aicharts", sha)).rejects.toThrow("deployment_verify_github_deployment_missing");
  await expect(readGitHubDeployment(host({ deployments: [{ ...deployments[0], environment: "Preview" }] }), "hraness/aicharts", sha))
    .rejects.toThrow("deployment_verify_github_deployment_missing");
  await expect(readGitHubDeployment(host({ deployments: [{ ...deployments[0], sha: sha.replace("f", "0") }] }), "hraness/aicharts", sha))
    .rejects.toThrow("deployment_verify_github_deployment_missing");
  await expect(readGitHubDeployment(host({ statuses: [{ ...statuses[0], state: "failure" }] }), "hraness/aicharts", sha))
    .rejects.toThrow("deployment_verify_github_deployment_unsuccessful");
  const superseded = [statuses[0], { ...statuses[0], id: 18804685127, state: "inactive", created_at: "2026-09-24T21:00:00Z" }];
  await expect(readGitHubDeployment(host({ statuses: superseded }), "hraness/aicharts", sha)).rejects.toThrow("deployment_verify_github_deployment_unsuccessful");
  await expect(readGitHubDeployment(host({ statuses: [{ ...statuses[0], environment_url: "https://example.com" }] }), "hraness/aicharts", sha))
    .rejects.toThrow("deployment_verify_github_environment_url_invalid");
  await expect(readGitHubDeployment(host({ statuses: "not json" }), "hraness/aicharts", sha)).rejects.toThrow("deployment_verify_github_api_invalid");
  const newer = { ...deployments[0], id: 6647776778, created_at: "2026-09-24T21:10:00Z" };
  const stub = host({ deployments: [deployments[0], newer] });
  stub.exec = (original => async (command, args) => {
    const outcome = await original(command, args);
    return args.at(-1)?.includes("6647776778/statuses") ? { ...outcome, stdout: JSON.stringify([{ ...statuses[0], id: 1, created_at: "2026-09-24T21:11:00Z" }]) } : outcome;
  })(stub.exec);
  expect((await readGitHubDeployment(stub, "hraness/aicharts", sha)).deploymentId).toBe(6647776778);
});

test("Vercel inspection requires the exact project, production target, Ready status, URL and canonical alias", async () => {
  expect(parseVercelInspect(inspectText, projectText, { projectName: "aicharts", url: deploymentUrl }).deploymentId).toBe(identity.deploymentId);
  const cases: [string, string, string][] = [
    [inspectText.replace("name\taicharts", "name\tother"), projectText, "vercel_identity_mismatch"],
    [inspectText, projectText.replace("Name\t\t\taicharts", "Name\t\t\tother"), "vercel_identity_mismatch"],
    [inspectText.replace("target\tproduction", "target\tpreview"), projectText, "vercel_deployment_not_ready"],
    [inspectText.replace("● Ready", "● Building"), projectText, "vercel_deployment_not_ready"],
    [inspectText.replace(`url\t\t${deploymentUrl}`, "url\t\thttps://aicharts-other-hraness.vercel.app"), projectText, "vercel_identity_mismatch"],
    [inspectText.replace(`id\t\t${identity.deploymentId}`, "id\t\t"), projectText, "vercel_inspect_invalid"],
    [inspectText, projectText.replace(identity.projectId, "prj_"), "vercel_inspect_invalid"],
    [`${inspectText}\n    id\t\t${identity.deploymentId}\n`, projectText, "vercel_inspect_invalid"],
    [inspectText, `${projectText}\n    ID\t\t${identity.projectId}\n`, "vercel_inspect_invalid"],
  ];
  for (const [deployment, project, code] of cases) {
    expect(() => parseVercelInspect(deployment, project, { projectName: "aicharts", url: deploymentUrl })).toThrow(`deployment_verify_${code}`);
  }
  await expect(verifyDeployment(parseArguments(["--sha", sha]), host({ inspect: inspectText.replace("    ╶ https://aicharts.io\n", "") })))
    .rejects.toThrow("deployment_verify_vercel_alias_missing");
  const failing = host(); failing.exec = async (command, args) => command === "vercel" ? { code: 1, stdout: "", stderr: "Error: not authenticated" } : host().exec(command, args);
  await expect(verifyDeployment(parseArguments(["--sha", sha]), failing)).rejects.toThrow("deployment_verify_vercel_inspect_failed");
});

test("public routes require 200 and the exact proof; every retired route requires proof-bound 404 or 410", async () => {
  const stub = host();
  expect((await checkHealth(stub, "https://aicharts.io", token)).map(check => check.path)).toEqual([...HEALTH_PATHS, ...RETIRED_PATHS]);
  expect(HEALTH_PATHS).toEqual(["/", "/benchmarks", "/coding", "/models", "/calculator", "/data", "/data/benchmark-atlas.json", "/blog", "/blog/introducing-ai-charts", "/llms.txt"]);
  for (const path of ["/usage", "/dashboard", "/leaderboard", "/install.sh", "/api/usage", "/api/usage/pairing/start", "/api/suite-auth/start", "/api/suite-auth/callback", "/api/suite-auth/session", "/api/suite-auth/refresh", "/api/suite-auth/sign-out"] as const) {
    expect(RETIRED_PATHS).toContain(path);
  }
  const respond = (status: number, value: string | null): FetchOutcome => ({ status, headers: { get: () => value } });
  for (const path of HEALTH_PATHS) {
    await expect(checkHealth(host({ responses: { [`https://aicharts.io${path}`]: respond(308, token) } }), "https://aicharts.io", token)).rejects.toThrow("deployment_verify_health_status");
    await expect(checkHealth(host({ responses: { [`https://aicharts.io${path}`]: respond(200, null) } }), "https://aicharts.io", token)).rejects.toThrow("deployment_verify_proof_mismatch");
  }
  for (const path of RETIRED_PATHS) {
    const url = `https://aicharts.io${path}`;
    for (const status of [200, 204, 301, 302, 307, 308, 401, 403, 405, 500]) {
      await expect(checkHealth(host({ responses: { [url]: respond(status, token) } }), "https://aicharts.io", token)).rejects.toThrow("deployment_verify_retired_route_open");
    }
    await expect(checkHealth(host({ responses: { [url]: respond(404, null) } }), "https://aicharts.io", token)).rejects.toThrow("deployment_verify_proof_mismatch");
    expect((await checkHealth(host({ responses: { [url]: respond(410, token) } }), "https://aicharts.io", token)).find(check => check.path === path)?.status).toBe(410);
  }
  const stale = productionDeliveryProofToken({ ...identity, deploymentId: "dpl_HRUt74pjFKM4bQe6DNkbr7E86TqX" });
  await expect(checkHealth(host({ responses: { "https://aicharts.io/": respond(200, stale) } }), "https://aicharts.io", token)).rejects.toThrow("deployment_verify_proof_mismatch");
});

test("the receipt is written only after every check passes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aicharts-deployment-verify-"));
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const output = join(directory, "nested", "receipt.json");
    expect(await main(["--sha", sha, "--output", output], host())).toBe(0);
    const receipt = JSON.parse(readFileSync(output, "utf8")) as { sha: string; checks: unknown[]; vercel: { deploymentId: string } };
    expect(receipt.sha).toBe(sha); expect(receipt.checks).toHaveLength(HEALTH_PATHS.length + RETIRED_PATHS.length); expect(receipt.vercel.deploymentId).toBe(identity.deploymentId);
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, "nested")).mode & 0o777).toBe(0o700);
    const failedOutput = join(directory, "failed.json");
    await expect(main(["--sha", sha, "--output", failedOutput], host({ statuses: [{ ...statuses[0], state: "pending" }] }))).rejects.toThrow("deployment_verify_github_deployment_unsuccessful");
    expect(existsSync(failedOutput)).toBe(false);
    await expect(main(["--sha", sha, "--output", failedOutput], host({ responses: {
      "https://aicharts.io/api/suite-auth/session": { status: 200, headers: { get: () => token } },
    } }))).rejects.toThrow("deployment_verify_retired_route_open");
    expect(existsSync(failedOutput)).toBe(false);
    const written = await writeReceipt(await verifyDeployment({ ...defaultOptions, sha }, host()), join(directory, "direct.json"));
    expect(readFileSync(written, "utf8").endsWith("\n")).toBe(true);
  } finally { log.mockRestore(); rmSync(directory, { recursive: true, force: true }); }
});

test("evidence refuses public repository paths, shared directories and linked targets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aicharts-private-evidence-"));
  try {
    const receipt = await verifyDeployment({ ...defaultOptions, sha }, host());
    await expect(writeReceipt(receipt, "public/production-verification.json")).rejects.toThrow("deployment_verify_receipt_path_not_private");
    chmodSync(directory, 0o755);
    await expect(writeReceipt(receipt, join(directory, "shared.json"))).rejects.toThrow("deployment_verify_receipt_directory_not_private");
    chmodSync(directory, 0o700);
    const original = join(directory, "original.json");
    await writeReceipt(receipt, original);
    const linked = join(directory, "linked.json");
    symlinkSync(original, linked);
    await expect(writeReceipt(receipt, linked)).rejects.toThrow("deployment_verify_receipt_target_not_regular");
    expect(JSON.parse(readFileSync(original, "utf8"))).toEqual(receipt);
    const linkedDirectory = join(directory, "linked-directory");
    symlinkSync(directory, linkedDirectory);
    await expect(writeReceipt(receipt, join(linkedDirectory, "receipt.json"))).rejects.toThrow("deployment_verify_receipt_directory_not_private");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("network probes are anonymous GET/HEAD requests without redirects and discard response bodies", async () => {
  let canceled = 0;
  const response = () => new Response(new ReadableStream({ cancel: () => { canceled += 1; } }), { status: 404 });
  const mocked = spyOn(globalThis, "fetch").mockResolvedValueOnce(response()).mockResolvedValueOnce(response());
  try {
    expect((await processHost.fetch("https://aicharts.io/usage", "GET")).status).toBe(404);
    expect((await processHost.fetch("https://aicharts.io/api/suite-auth/start", "HEAD")).status).toBe(404);
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(mocked.mock.calls[0]?.[1]).toMatchObject({ method: "GET", credentials: "omit", redirect: "manual", cache: "no-store" });
    expect(mocked.mock.calls[1]?.[1]).toMatchObject({ method: "HEAD", credentials: "omit", redirect: "manual", cache: "no-store" });
    expect(canceled).toBe(2);
  } finally { mocked.mockRestore(); }
});
