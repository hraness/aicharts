import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productionDeliveryProofToken } from "@hraness/vercel-delivery";
import {
  HEALTH_PATHS, checkHealth, defaultOptions, main, parseArguments, parseVercelInspect, readGitHubDeployment, verifyDeployment, writeReceipt,
  type FetchOutcome, type Host, type ProcessOutcome,
} from "./usage-deployment-verify";

const sha = "fc95b51b6cd44527d154853cb3404ffeb26dcb39";
const deploymentUrl = "https://aicharts-k7kua357c-hraness.vercel.app";
const identity = { deploymentId: "dpl_3TA2bNgxfeQzY7Cf67XF6scjyUrm", projectId: "prj_0ppMfRRMDfiVsQ1JaekoxSZ7Mwgn", projectName: "aicharts", sha };
const token = productionDeliveryProofToken(identity);
const deployments = [{ id: 6647776777, sha, environment: "Production", created_at: "2026-09-24T20:46:52Z", task: "deploy" }];
const statuses = [{ id: 18804685126, state: "success", created_at: "2026-09-24T20:46:52Z", environment_url: deploymentUrl, environment: "Production" }];
const inspectText = `\nVercel CLI 59.23.0 (Node.js 24.20.0)\nFetching deployment "aicharts-k7kua357c-hraness.vercel.app" in hraness\n\n  General\n\n    id\t\t${identity.deploymentId}\n    name\taicharts\n    target\tproduction\n    status\t● Ready\n    url\t\t${deploymentUrl}\n    created\tThu Sep 24 2026 16:45:13 GMT-0400 [2h ago]\n\n  Build Machine\n\n    cores\t4\n\n  Aliases\n\n    ╶ https://aicharts.io\n    ╶ https://www.aicharts.io\n    ╶ https://aicharts-hraness.vercel.app\n    \n\n  Builds\n\n    ┌ .        [0ms]\n    ├── λ index (19.89MB) [iad1]\n`;
const projectText = `\nVercel CLI 59.23.0 (Node.js 24.20.0)\n> Found Project hraness/aicharts [219ms]\n\n  General\n\n    ID\t\t\t\t${identity.projectId}\n    Name\t\t\taicharts\n    Owner\t\t\tHraness\n    Root Directory\t\t.\n`;

type Stub = { deployments?: unknown; statuses?: unknown; inspect?: string; project?: string; responses?: Partial<Record<string, FetchOutcome>>; head?: string };
function host(stub: Stub = {}): Host & { calls: string[][] } {
  const calls: string[][] = [];
  const ok = (stdout: string): ProcessOutcome => ({ code: 0, stdout, stderr: "" });
  const response = (status: number, value: string | null): FetchOutcome => ({ status, headers: { get: name => name.toLowerCase() === "x-hraness-delivery-proof" ? value : null } });
  return {
    calls,
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
    fetch: async url => stub.responses?.[url] ?? response(200, token),
    now: () => new Date("2026-09-24T23:00:00.000Z"),
  };
}

test("argument parsing admits only the documented flags and a complete explicit identity pair", () => {
  expect(parseArguments([]).sha).toBeNull();
  expect(parseArguments(["--sha", sha]).sha).toBe(sha);
  expect(parseArguments(["--deployment-id", identity.deploymentId, "--project-id", identity.projectId]).projectId).toBe(identity.projectId);
  for (const argv of [["--sha"], ["--sha", "abc"], ["--sha", sha.toUpperCase()], ["--deployment-id", identity.deploymentId], ["--project-id", identity.projectId],
    ["--deployment-id", "nope", "--project-id", identity.projectId], ["--origin", "http://aicharts.io"], ["--unknown", "x"], ["--sha", "--sha"], ["--scope", "Hraness"]]) {
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
  expect(receipt.checks.map(check => check.path)).toEqual([...HEALTH_PATHS]);
  expect(receipt.checks.every(check => check.status === 200 && check.token === token)).toBe(true);
  expect(receipt.verifiedAt).toBe("2026-09-24T23:00:00Z");
  expect(receipt.claim).toBe("exact-deployment-health-only");
  expect(stub.calls.map(call => call.join(" "))).toEqual([
    `gh api -H Accept: application/vnd.github+json repos/hraness/aicharts/deployments?sha=${sha}&per_page=100`,
    "gh api -H Accept: application/vnd.github+json repos/hraness/aicharts/deployments/6647776777/statuses?per_page=100",
    `vercel inspect ${deploymentUrl} --scope hraness`,
    "vercel project inspect aicharts --scope hraness",
  ]);
});

test("the commit defaults to git HEAD and an explicit identity pair skips provider inspection", async () => {
  const stub = host();
  const receipt = await verifyDeployment(parseArguments(["--deployment-id", identity.deploymentId, "--project-id", identity.projectId]), stub);
  expect(receipt.sha).toBe(sha);
  expect(receipt.vercel.source).toBe("explicit");
  expect(receipt.vercel.aliases).toEqual([]);
  expect(stub.calls[0]).toEqual(["git", "rev-parse", "HEAD"]);
  expect(stub.calls.some(call => call[0] === "vercel")).toBe(false);
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
  ];
  for (const [deployment, project, code] of cases) {
    expect(() => parseVercelInspect(deployment, project, { projectName: "aicharts", url: deploymentUrl })).toThrow(`deployment_verify_${code}`);
  }
  await expect(verifyDeployment(parseArguments(["--sha", sha]), host({ inspect: inspectText.replace("    ╶ https://aicharts.io\n", "") })))
    .rejects.toThrow("deployment_verify_vercel_alias_missing");
  const failing = host(); failing.exec = async (command, args) => command === "vercel" ? { code: 1, stdout: "", stderr: "Error: not authenticated" } : host().exec(command, args);
  await expect(verifyDeployment(parseArguments(["--sha", sha]), failing)).rejects.toThrow("deployment_verify_vercel_inspect_failed");
});

test("health checks require HTTP 200 and the exact recomputed proof on every fixed path", async () => {
  const stub = host();
  expect((await checkHealth(stub, "https://aicharts.io", token)).map(check => check.path)).toEqual(["/", "/dashboard", "/usage/sessions"]);
  const respond = (status: number, value: string | null): FetchOutcome => ({ status, headers: { get: () => value } });
  await expect(checkHealth(host({ responses: { "https://aicharts.io/dashboard": respond(308, token) } }), "https://aicharts.io", token)).rejects.toThrow("deployment_verify_health_status");
  await expect(checkHealth(host({ responses: { "https://aicharts.io/usage/sessions": respond(200, null) } }), "https://aicharts.io", token)).rejects.toThrow("deployment_verify_proof_mismatch");
  const stale = productionDeliveryProofToken({ ...identity, deploymentId: "dpl_HRUt74pjFKM4bQe6DNkbr7E86TqX" });
  await expect(checkHealth(host({ responses: { "https://aicharts.io/": respond(200, stale) } }), "https://aicharts.io", token)).rejects.toThrow("deployment_verify_proof_mismatch");
});

test("the receipt is written only after every check passes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aicharts-deployment-verify-"));
  try {
    const output = join(directory, "nested", "receipt.json");
    expect(await main(["--sha", sha, "--output", output], host())).toBe(0);
    const receipt = JSON.parse(readFileSync(output, "utf8")) as { sha: string; checks: unknown[]; vercel: { deploymentId: string } };
    expect(receipt.sha).toBe(sha); expect(receipt.checks).toHaveLength(3); expect(receipt.vercel.deploymentId).toBe(identity.deploymentId);
    const failedOutput = join(directory, "failed.json");
    await expect(main(["--sha", sha, "--output", failedOutput], host({ statuses: [{ ...statuses[0], state: "pending" }] }))).rejects.toThrow("deployment_verify_github_deployment_unsuccessful");
    expect(existsSync(failedOutput)).toBe(false);
    const written = await writeReceipt(await verifyDeployment({ ...defaultOptions, sha }, host()), join(directory, "direct.json"));
    expect(readFileSync(written, "utf8").endsWith("\n")).toBe(true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
