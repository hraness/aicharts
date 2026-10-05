import { homeAlternativesCheckedLabel } from "@/app/site";
import { usageReleaseUrl } from "@/lib/usage-cli-release";

/**
 * Copy for `/usage`, shared by the HTML page and its Markdown representation
 * so the two cannot drift. A segment is plain text, a link, or inline code.
 */
export type UsageCopySegment =
  | string
  | Readonly<{ href: string; text: string }>
  | Readonly<{ code: string }>;

export type UsageCopy = readonly UsageCopySegment[];

export type UsageCommand = Readonly<{ command: string; label: string; note: string }>;

export type UsageLink = Readonly<{ href: string; label: string }>;

export const usageHero = {
  eyebrow: "Usage tracking",
  heading: "See how many tokens your AI agents use",
  lede: "The aicharts collector counts tokens, cost, and speed for each model across the coding agents on your machine. Prompts, transcripts, file paths, and provider credentials stay on your machine, and each total lists the sources it covers.",
  dashboardAction: { href: "/dashboard", label: "Open your dashboard" },
  setupAction: { href: "#usage-setup", label: "Set up tracking" },
  status: [
    "In development. Apple silicon Mac and Linux x86-64 builds are on ",
    { href: usageReleaseUrl, text: "GitHub Releases" },
    "; on an Intel Mac, build from source. Account sync runs on macOS only.",
  ],
  platforms: [
    { id: "macos", note: "Apple silicon" },
    { id: "linux", note: "x86_64, local reports" },
  ],
} as const satisfies Readonly<{
  eyebrow: string;
  heading: string;
  lede: string;
  dashboardAction: UsageLink;
  setupAction: UsageLink;
  status: UsageCopy;
  platforms: readonly Readonly<{ id: string; note: string }>[];
}>;

export const usageSimilarTools = {
  heading: "Similar tools",
  body: [
    { href: "https://ccusage.com", text: "ccusage" },
    " and ",
    { href: "https://tokscale.ai", text: "Tokscale" },
    " also read coding agents’ local logs. ccusage runs without an install and prints daily, weekly, monthly, and session reports. Tokscale adds a web dashboard and a public leaderboard, and the aicharts collector builds on its open-source parsers. aicharts shows which sources each total covers, and on a Mac it can sync daily totals to your dashboard. ",
    homeAlternativesCheckedLabel,
  ],
} as const satisfies Readonly<{ heading: string; body: UsageCopy }>;

export const usageSetup = {
  eyebrow: "Setup",
  heading: "Set up tracking in three steps",
  intro: "The collector runs on your machine. When it publishes, it uploads daily totals of tokens, cost, and time for each client and model, with each client’s source coverage.",
  steps: [
    { title: "Install the collector", description: "Choose your platform below. The collector reads token counts from your clients' local files. A few clients, such as Cursor and Warp, need a refresh step first." },
    { title: "Connect your account", description: "On a Mac, run aicharts enroll and approve the pairing in your browser. Each enrolled Mac reports to one account." },
    { title: "Publish on a schedule", description: "Set up a launchd job that runs aicharts autosubmit. Each run refreshes your clients and uploads their latest totals, so your dashboard stays current without manual exports." },
  ],
  installLabel: "Collector platform",
  enroll: {
    command: 'aicharts enroll --state-dir "$HOME/.aicharts/state"',
    label: "Collector setup command",
    note: "macOS, then approve in browser",
  },
  guides: [
    { href: "https://github.com/hraness/aicharts/blob/main/distribution/cli/docs/usage-install.md", label: "Linux download and verification" },
    { href: "https://github.com/hraness/aicharts/blob/main/docs/usage-local.md#build-and-run", label: "Build instructions" },
    { href: "https://github.com/hraness/aicharts/blob/main/docs/usage-autosubmit.md", label: "Scheduled publication guide" },
  ],
} as const satisfies Readonly<{
  eyebrow: string;
  heading: string;
  intro: string;
  steps: readonly Readonly<{ title: string; description: string }>[];
  installLabel: string;
  enroll: UsageCommand;
  guides: readonly UsageLink[];
}>;

export const usageDashboard = {
  eyebrow: "Dashboard",
  heading: "What the dashboard shows",
  intro: "Every figure comes from the records your clients keep locally, reported per client, model, and UTC day.",
  illustrationCaption: "The dashboard for a signed-in account, with made-up numbers.",
  metrics: [
    { label: "Tokens", title: "Token types", description: "Input, cache read, cache write, output, and reasoning tokens are counted separately." },
    { label: "Cost", title: "Reported vs retail", description: "Provider-reported spend beside an estimate at public prices from the models.dev catalog, with the difference between them." },
    { label: "Speed", title: "Tokens per second", description: "Measured over the request durations that clients record, per model and per day. This is not the model's inference speed." },
    { label: "Cache", title: "Cache reads", description: "The share of input tokens served from cache, so you can see where prompt caching helps." },
    { label: "Coverage", title: "Source coverage", description: "Each report lists every client it checked and whether it had data, was empty, was not found, or could not be read in full, so missing sources stay visible." },
    { label: "Clients", title: "55 sources", description: "Codex, Claude Code, Cursor, Devin, OpenCode, Warp, and the other supported sources, reported together. Run aicharts stats --list-clients for the full list." },
  ],
} as const satisfies Readonly<{
  eyebrow: string;
  heading: string;
  intro: string;
  illustrationCaption: string;
  metrics: readonly Readonly<{ label: string; title: string; description: string }>[];
}>;

export const usageLocalReport = {
  eyebrow: "No account needed",
  heading: "Start with a local report",
  paragraphs: [
    ["The collector writes a report file with token counts, known costs, and source coverage. The detailed reports page reads that file in your browser tab and does not upload it."],
    [
      "Installing ",
      { href: "https://xcb.sh", text: "xcb" },
      " or ",
      { href: "https://gobstopper.sh", text: "Gobstopper" },
      " adds aicharts and turns on its daily history and daily update check on your computer, so ",
      { code: "aicharts history report" },
      " and ",
      { code: "aicharts mcp" },
      " work right away. Nothing is uploaded.",
    ],
  ],
  report: {
    command: 'aicharts stats --home "$HOME" --all --json > usage-report.json',
    label: "Local-only report command",
    note: "local only",
  },
  action: { href: "/usage/details", label: "Open a report" },
} as const satisfies Readonly<{
  eyebrow: string;
  heading: string;
  paragraphs: readonly UsageCopy[];
  report: UsageCommand;
  action: UsageLink;
}>;

export const usageTrust = {
  heading: "What the numbers mean",
  body: "A total counts only what each client records in its local files, and it lists the sources it covers. It isn’t a bill or a productivity score, and a counted request may have come from an agent rather than a person.",
  points: ["Source coverage shown", "No transcript uploads", "Public ranking only if you opt in"],
} as const satisfies Readonly<{ heading: string; body: string; points: readonly string[] }>;
