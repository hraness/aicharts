import { describe, expect, test } from "bun:test";
import {
  buildChartShareUrl,
  chartImageFilename,
  chartImageShareData,
  parseChartShareView,
  xPostIntentUrl,
  type ChartShareView,
} from "./chart-share";
import { codingAgentRecordKey } from "../lib/coding-agent-data";

const defaultView: ChartShareView = {
  pointKey: null,
  providerId: null,
  xMetric: "costUsd",
  yMetric: "aaIndex",
};

describe("chart sharing", () => {
  test("serializes the selected metrics and exactly one pinned item", () => {
    expect(codingAgentRecordKey({ seriesId: "agent/model", setting: "max" })).toBe("[\"agent/model\",\"max\"]");
    const url = buildChartShareUrl("https://codingchart.com/old?ignored=true#chart", {
      ...defaultView,
      pointKey: "[\"agent/model\",\"max\"]",
      providerId: "ignored-provider",
    });

    expect(url).toBe("https://codingchart.com/old?benchmark=aaIndex&compare=costUsd&point=%5B%22agent%2Fmodel%22%2C%22max%22%5D");
    expect(parseChartShareView(new URL(url).search)).toEqual({
      pointKey: "[\"agent/model\",\"max\"]",
      providerId: null,
      xMetric: "costUsd",
      yMetric: "aaIndex",
    });
  });

  test("rejects unknown metric values and restores provider selection", () => {
    expect(parseChartShareView("?benchmark=nope&compare=durationMinutes&provider=openai")).toEqual({
      pointKey: null,
      providerId: "openai",
      xMetric: "durationMinutes",
      yMetric: null,
    });
  });

  test("restores SWE-Atlas-QnA versus total-token views", () => {
    expect(parseChartShareView("?benchmark=sweAtlas&compare=totalTokens&provider=openai")).toEqual({
      pointKey: null,
      providerId: "openai",
      xMetric: "totalTokens",
      yMetric: "sweAtlas",
    });
  });

  test("builds portable filenames and an encoded X web intent", () => {
    expect(chartImageFilename(defaultView, "GPT-5.6 Sol (max) / test")).toBe(
      "codingchart-aaIndex-costUsd-gpt-5-6-sol-max-test.png",
    );
    expect(chartImageFilename(defaultView, "🔥")).toBe("codingchart-aaIndex-costUsd-all-models.png");

    const intent = new URL(xPostIntentUrl("AA Index vs cost", "https://codingchart.com/?point=a/b"));
    expect(intent.origin + intent.pathname).toBe("https://x.com/intent/tweet");
    expect(intent.searchParams.get("text")).toBe("AA Index vs cost");
    expect(intent.searchParams.get("url")).toBe("https://codingchart.com/?point=a/b");
  });

  test("shares exactly one image without accompanying text or links", () => {
    const file = new File(["png"], "codingchart.png", { type: "image/png" });
    const shareData = chartImageShareData(file);

    expect(Object.keys(shareData)).toEqual(["files"]);
    expect(shareData.files).toEqual([file]);
  });
});
