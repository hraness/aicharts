import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

test("native Node service-binding adapter drives the exported qualification dispatcher", async () => {
  const root = join(import.meta.dir, "..");
  const fixture = join(import.meta.dir, "usage-cloudflare-node-binding.fixture.mjs");
  const reviewedLoader = "/Users/bg/Documents/Codex/2026-09-13/res/work/cloudflare-node-loader.mjs";
  const args = ["--experimental-transform-types"];
  if (existsSync(reviewedLoader)) args.push("--import", reviewedLoader);
  args.push(fixture);
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("node", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    const timeout = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 2_000).unref(); }, 30_000);
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("close", code => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
  });
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain('"nativeNode":true');
  expect(result.stdout).toContain('"localBinding":true');
  expect(result.stdout).toContain('"redirectRefused":true');
});
