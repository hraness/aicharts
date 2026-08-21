import { describe, expect, test } from "bun:test";

import { AGENT_GUIDE_CONTENT_TYPE, agentGuideMarkdown } from "@/lib/site-markdown";

import { GET } from "./route";

describe("llms.txt", () => {
  test("publishes the agent guide as a plain-text file", () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(AGENT_GUIDE_CONTENT_TYPE);
    expect(response.headers.get("Vary")).toBe("Accept");
    return expect(response.text()).resolves.toBe(agentGuideMarkdown());
  });
});
