import type { ReactNode } from "react";

import { ChartMockup, isChartView } from "./chart";
import {
  CollectorMockup,
  DataEntryMockup,
  LibraryMockup,
  StatusMockup,
  UsageMockup,
} from "./surfaces";

export { CHART_VIEWS, ChartMockup, type ChartView } from "./chart";
export {
  COLLECTOR_ENROLL_COMMAND,
  COLLECTOR_REPORT_COMMAND,
  CollectorMockup,
  DataEntryMockup,
  LibraryMockup,
  STATUS_SNAPSHOT_LINES,
  StatusMockup,
  UsageMockup,
} from "./surfaces";

/**
 * The launch mockups by the id a launch beat names. The launch post, the
 * homepage tour, and the launch film all render these, so the three always
 * show the same picture.
 */
export const MOCKUP_IDS = ["chart", "library", "data", "usage", "collector", "status"] as const;
export type MockupId = (typeof MOCKUP_IDS)[number];

export function isMockupId(value: string): value is MockupId {
  return (MOCKUP_IDS as readonly string[]).includes(value);
}

export function renderLaunchMockup(
  id: string,
  state: Readonly<Record<string, string>>,
  theme?: "light" | "dark",
): ReactNode {
  if (!isMockupId(id)) throw new RangeError(`No launch mockup is named ${JSON.stringify(id)}.`);
  const themed = theme === undefined ? {} : { theme };
  switch (id) {
    case "chart": {
      const view = state["view"] ?? "models";
      if (!isChartView(view)) throw new RangeError(`No chart view is named ${JSON.stringify(view)}.`);
      return <ChartMockup {...themed} view={view} />;
    }
    case "library":
      return <LibraryMockup {...themed} />;
    case "data":
      return <DataEntryMockup {...themed} />;
    case "usage":
      return <UsageMockup {...themed} />;
    case "collector":
      return <CollectorMockup {...themed} />;
    case "status":
      return <StatusMockup {...themed} />;
  }
}
