import { fileURLToPath, URL } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    include: ["test/**/*.worker.ts"],
    // Each file owns isolated, synthetic bindings. No remote service overrides.
    fileParallelism: false,
    testTimeout: 10_000,
  },
});
