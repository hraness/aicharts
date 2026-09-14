import {
  Analytics01Icon,
  BrainIcon,
  Briefcase01Icon,
  ChartLineData01Icon,
  Clock01Icon,
  ComputerIcon,
  CpuIcon,
  Database01Icon,
  DollarCircleIcon,
  Globe02Icon,
  GridViewIcon,
  Image01Icon,
  Layers01Icon,
  MessageQuestionIcon,
  MusicNote01Icon,
  RankingIcon,
  Search01Icon,
  SourceCodeIcon,
  Table01Icon,
  TerminalIcon,
  TestTube01Icon,
  TokenCircleIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons";

import type { BenchmarkAtlasCategory } from "@/lib/benchmark-atlas";
import type { XMetric, YMetric } from "@/lib/chart-math";
import type { IntelligenceEfficiencyMetric } from "@/lib/intelligence-efficiency";
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

const X_METRIC_ICONS = {
  costUsd: DollarCircleIcon,
  durationMinutes: Clock01Icon,
  totalTokens: TokenCircleIcon,
} as const satisfies Record<XMetric, Parameters<typeof Icon>[0]["icon"]>;

const INTELLIGENCE_METRIC_ICONS = {
  costUsdPerTask: DollarCircleIcon,
  outputTokensPerTask: TokenCircleIcon,
} as const satisfies Record<IntelligenceEfficiencyMetric, Parameters<typeof Icon>[0]["icon"]>;

const ATLAS_VIEW_ICONS = {
  cost: ChartLineData01Icon,
  ranking: RankingIcon,
  table: Table01Icon,
} as const;

export function PickerGlyph({
  icon,
  size = 14,
}: Readonly<{
  icon: Parameters<typeof Icon>[0]["icon"];
  size?: number;
}>) {
  return <Icon icon={icon} size={size} strokeWidth={1.8} />;
}

export function atlasTaskGlyph(category: BenchmarkAtlasCategory | "all") {
  return <PickerGlyph icon={TASK_ICONS[category]} />;
}

export function codingBenchmarkGlyph(metric: YMetric) {
  return <PickerGlyph icon={BENCHMARK_METRIC_ICONS[metric]} />;
}

export function xMetricGlyph(metric: XMetric) {
  return <PickerGlyph icon={X_METRIC_ICONS[metric]} size={13} />;
}

export function intelligenceMetricGlyph(metric: IntelligenceEfficiencyMetric) {
  return <PickerGlyph icon={INTELLIGENCE_METRIC_ICONS[metric]} size={14} />;
}

export function atlasViewGlyph(view: keyof typeof ATLAS_VIEW_ICONS) {
  return <PickerGlyph icon={ATLAS_VIEW_ICONS[view]} size={14} />;
}

export function hardwareProfileGlyph() {
  return <PickerGlyph icon={CpuIcon} />;
}

export function chartLineGlyph() {
  return <PickerGlyph icon={ChartLineData01Icon} />;
}
