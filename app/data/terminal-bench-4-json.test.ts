import { describe, expect, test } from "bun:test";

import terminalBenchData from "@/data/terminal-bench.json";
import { parseTerminalBenchSnapshot } from "@/lib/terminal-bench-data";

import { dynamic, GET } from "./terminal-bench-4.json/route";

describe("Terminal-Bench 4 JSON download", () => {
  test("serves the exact checked owner snapshot with download and freshness headers", async () => {
    const expected = parseTerminalBenchSnapshot(terminalBenchData);
    if (!expected.ok) throw expected.error;

    expect(dynamic).toBe("force-static");
    const response = GET();
    const downloaded = parseTerminalBenchSnapshot(await response.json());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="aicharts-terminal-bench-4.json"',
    );
    expect(response.headers.get("Last-Modified")).toBe(
      new Date(expected.value.source.retrievedAt).toUTCString(),
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(downloaded).toEqual(expected);
  });
});
