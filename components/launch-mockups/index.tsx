import type { ReactNode } from "react";

import { ChartMockup, isChartView } from "./chart";
import {
  DataEntryMockup,
  LibraryMockup,
} from "./surfaces";

export { CHART_VIEWS, ChartMockup, type ChartView } from "./chart";
export {
  DataEntryMockup,
  LibraryMockup,
} from "./surfaces";

/**
 * The benchmark illustrations by the id each introductory section names.
 * The article and standalone render tool share these components.
 */
export const MOCKUP_IDS = ["chart", "library", "data"] as const;
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
  }
}
