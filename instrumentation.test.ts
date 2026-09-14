import { expect, test } from "bun:test";

test("server instrumentation uses the shared privacy and endpoint boundaries", async () => {
  const source = await Bun.file(new URL("./instrumentation.ts", import.meta.url)).text();

  expect(source).toContain("approvedPostHogEndpoint(");
  expect(source).toContain("sanitizedServerError(value)");
  expect(source).toContain("endpoint === null");
  expect(source).toContain("host: endpoint.apiHost");
  expect(source).toContain("event_schema_version: 1");
  expect(source).not.toContain("source.message");
  expect(source).not.toContain("source.stack");
});
