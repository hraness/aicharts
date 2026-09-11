import { env, exports as workerExports } from "cloudflare:workers";
import { listDurableObjectIds } from "cloudflare:test";
import { expect, test } from "vitest";

test("every public path and method remains unavailable without creating durable state", async () => {
  for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    for (const path of ["/", "/device", "/pair", "/ingest", "/status", "/recover", "/?secret=canary"]) {
      const response = await workerExports.default.fetch(new Request(`https://usage.invalid${path}`, {
        method,
        headers: { authorization: "Bearer credential-canary", origin: "https://aicharts.io" },
        ...(method === "POST" ? { body: "private-transcript-canary" } : {}),
      }));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      for (const header of ["set-cookie", "location", "access-control-allow-origin"]) expect(response.headers.has(header)).toBe(false);
      if (method !== "HEAD") expect(await response.text()).toBe('{"error":"usage_service_unavailable"}');
    }
  }
  expect(await listDurableObjectIds(env.PAIRINGS)).toEqual([]);
  expect((await env.STAGING.list()).objects).toEqual([]);
});
