export interface BenchmarkPortfolioItem {
  readonly id: string;
  readonly signal: string;
  readonly name: string;
  readonly version: string;
  readonly sourceLabel: string;
  readonly sourceUrl: string;
  readonly measure: string;
  readonly comparisonRule: string;
  readonly standard: boolean;
}

export const BENCHMARK_DATA_DESCRIPTION =
  "Versioned benchmark data and sourcing methods for Terminal-Bench 4, Terminal-Bench-Science, and the Artificial Analysis coding-agent snapshot.";

export const CORE_BENCHMARK_PORTFOLIO = [
  {
    id: "terminal-bench",
    signal: "Agentic terminal engineering",
    name: "Terminal-Bench",
    version: "4.0.0",
    sourceLabel: "Harbor Framework release",
    sourceUrl: "https://github.com/harbor-framework/terminal-bench/releases/tag/v4.0.0",
    measure: "Terminal engineering across software, systems, CAD, science, and formal proof.",
    comparisonRule: "Coding standard. Compare only exact 4.0.0 results under the same run policy.",
    standard: true,
  },
  {
    id: "terminal-bench-science",
    signal: "Scientific workflows",
    name: "Terminal-Bench-Science",
    version: "0.1.0",
    sourceLabel: "Terminal-Bench-Science v0.1.0 release",
    sourceUrl: "https://github.com/harbor-framework/terminal-bench-science/releases/tag/v0.1.0",
    measure: "Research tasks that require domain software, computation, and scientific evidence.",
    comparisonRule: "Keep its task-set version explicit and separate from general terminal coding.",
    standard: false,
  },
  {
    id: "gdpval-aa",
    signal: "Professional work",
    name: "GDPval-AA",
    version: "v2",
    sourceLabel: "Artificial Analysis leaderboard",
    sourceUrl: "https://artificialanalysis.ai/evaluations/gdpval-aa",
    measure: "Work products for economically valuable tasks across occupations and industries.",
    comparisonRule: "Use v2 results and name the evaluator and judge configuration with every score.",
    standard: false,
  },
  {
    id: "osworld",
    signal: "Computer use",
    name: "OSWorld 2.0",
    version: "osworld-v2-2026.08.08",
    sourceLabel: "Pinned OSWorld release manifest",
    sourceUrl: "https://github.com/xlang-ai/OSWorld-V2/blob/v2026.08.08/benchmark_releases/osworld-v2-2026.08.08.json",
    measure: "Long-horizon work carried out across desktop and web applications.",
    comparisonRule: "Pin code, tasks, assets, website, and image; keep binary completion and partial reward separate.",
    standard: false,
  },
  {
    id: "humanitys-last-exam",
    signal: "Broad expert reasoning",
    name: "Humanity’s Last Exam",
    version: "cais/hle · 5a81a4c",
    sourceLabel: "Pinned classic HLE dataset revision",
    sourceUrl: "https://huggingface.co/datasets/cais/hle/tree/5a81a4c7271a2a2a312b9a690f0c2fde837e4c29",
    measure: "Closed-ended, expert-level questions across more than 100 academic subjects.",
    comparisonRule: "Pin revision, modality, judge, and tools mode; never mix classic HLE with HLE-Rolling.",
    standard: false,
  },
] as const satisfies readonly BenchmarkPortfolioItem[];

export const SUPPLEMENTAL_CODING_BENCHMARK = {
  name: "CursorBench",
  version: "3.2",
  sourceLabel: "CursorBench leaderboard",
  sourceUrl: "https://cursor.com/cursorbench",
  measure: "Private, production-aligned evidence for ambiguous multi-file coding work inside Cursor’s agent harness.",
} as const;
