import { fileURLToPath, URL } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    include: ["test/**/*.worker.ts"],
    // Each file owns isolated, synthetic bindings (per-file storage), so files run
    // in parallel. Four workers match a hosted Linux runner. No remote service overrides.
    maxWorkers: 4,
    testTimeout: 10_000,
  },
});
