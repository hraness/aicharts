import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([".next/**", "skills/aicharts/scripts/support-foundation.mjs", "coverage/**", "next-env.d.ts", "desktop/target/**", "outputs/**", "**/.wrangler/**", "services/usage-worker/worker-configuration.d.ts"]),
]);
