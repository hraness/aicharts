import { describe, expect, test } from "bun:test";

import terminalBenchScienceData from "@/data/terminal-bench-science.json";
import { parseTerminalBenchScienceSnapshot } from "@/lib/terminal-bench-science-data";

import { dynamic, GET } from "./terminal-bench-science-0-1.json/route";

describe("Terminal-Bench-Science 0.1 JSON download", () => {
  test("serves the checked owner snapshot with download and freshness headers", async () => {
    const expected = parseTerminalBenchScienceSnapshot(terminalBenchScienceData);
    if (!expected.ok) throw expected.error;

    expect(dynamic).toBe("force-static");
    const response = GET();
    const downloaded = parseTerminalBenchScienceSnapshot(await response.json());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="aicharts-terminal-bench-science-0-1.json"',
    );
    expect(response.headers.get("Last-Modified")).toBe(
      new Date(expected.value.source.retrievedAt).toUTCString(),
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(downloaded).toEqual(expected);
  });
});
