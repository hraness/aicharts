import {
  Analytics01Icon,
  BrainIcon,
  Briefcase01Icon,
  ChartLineData01Icon,
  ComputerIcon,
  CpuIcon,
  Database01Icon,
  Globe02Icon,
  GridViewIcon,
  Image01Icon,
  Layers01Icon,
  MessageQuestionIcon,
  MusicNote01Icon,
  Search01Icon,
  SourceCodeIcon,
  TerminalIcon,
  TestTube01Icon,
  Video01Icon,
} from "@hugeicons/core-free-icons";

import type { BenchmarkAtlasCategory } from "@/lib/benchmark-atlas";
import type { YMetric } from "@/lib/chart-math";
import { Icon } from "@/components/ui";

const TASK_ICONS = {
  all: GridViewIcon,
  audio: MusicNote01Icon,
  coding: SourceCodeIcon,
  "computer-use": ComputerIcon,
  general: Layers01Icon,
  image: Image01Icon,
  memory: Database01Icon,
  reasoning: BrainIcon,
  research: Search01Icon,
  science: TestTube01Icon,
  video: Video01Icon,
  work: Briefcase01Icon,
  world: Globe02Icon,
} as const satisfies Record<BenchmarkAtlasCategory | "all", Parameters<typeof Icon>[0]["icon"]>;

const BENCHMARK_METRIC_ICONS = {
  aaIndex: Analytics01Icon,
  deepSwe: SourceCodeIcon,
  sweAtlas: MessageQuestionIcon,
  terminalBench: TerminalIcon,
} as const satisfies Record<YMetric, Parameters<typeof Icon>[0]["icon"]>;

export function PickerGlyph({
  icon,
}: Readonly<{
  icon: Parameters<typeof Icon>[0]["icon"];
}>) {
  return <Icon icon={icon} size={14} strokeWidth={1.8} />;
}

export function atlasTaskGlyph(category: BenchmarkAtlasCategory | "all") {
  return <PickerGlyph icon={TASK_ICONS[category]} />;
}

export function codingBenchmarkGlyph(metric: YMetric) {
  return <PickerGlyph icon={BENCHMARK_METRIC_ICONS[metric]} />;
}

export function hardwareProfileGlyph() {
  return <PickerGlyph icon={CpuIcon} />;
}

export function chartLineGlyph() {
  return <PickerGlyph icon={ChartLineData01Icon} />;
}
