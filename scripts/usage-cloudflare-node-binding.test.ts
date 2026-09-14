import { test, expect } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("native Node service-binding adapter drives the exported qualification dispatcher", async () => {
  const fixture = fileURLToPath(new URL("./usage-cloudflare-node-binding.fixture.mjs", import.meta.url));
  const loader = new URL("./usage-cloudflare-node.mjs", import.meta.url).href;
  // An unrelated cwd and an explicit environment keep this proof independent of
  // local checkouts, private loaders, dotenv files, and provider credentials.
  const parent = await realpath(await mkdtemp(join(tmpdir(), "aicharts-node-binding-")));
  try {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string; failure?: string }>((resolve) => {
      const child = spawn("node", ["--experimental-transform-types", "--import", loader, fixture], {
        cwd: parent, stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "test", TMPDIR: parent },
      });
      const output: Record<"stdout" | "stderr", Buffer> = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      let failure: string | undefined;
      let forceStop: ReturnType<typeof setTimeout> | undefined;
      const stop = (reason: string) => {
        if (failure !== undefined) return;
        failure = reason;
        child.kill("SIGTERM"); // The fixture disposes its owned Miniflare runtime.
        forceStop = setTimeout(() => child.kill("SIGKILL"), 2_000);
      };
      for (const stream of ["stdout", "stderr"] as const) {
        child[stream].on("data", (chunk: Buffer) => {
          const remaining = 65_536 - output[stream].length;
          output[stream] = Buffer.concat([output[stream], chunk.subarray(0, remaining)]);
          if (chunk.length > remaining) stop(`${stream} exceeded the output limit`);
        });
      }
      const timeout = setTimeout(() => stop("native Node fixture timed out"), 30_000);
      child.once("error", () => { failure ??= "native Node could not start"; });
      // Collect close (including both pipes) before deleting the owned directory.
      child.once("close", code => {
        clearTimeout(timeout);
        clearTimeout(forceStop);
        resolve({ code, stdout: output.stdout.toString("utf8"), stderr: output.stderr.toString("utf8"), failure });
      });
    });
    expect(result.failure, result.stderr).toBeUndefined();
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ schemaVersion: 1, nativeNode: true, localBinding: true,
      exactRequest: true, redirectRefused: true, cleanupComplete: true });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}, 40_000);
