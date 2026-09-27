import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseStatsTotals, type StatsTotals } from "@/lib/usage/stats-totals-contract";
import { totalsFreshness, UsageTotalsView, type TotalsPanelState } from "./totals-panel";

const day = 20_000, now = day * 86_400_000;
const split = (total: bigint) => ({ input: String(total / 4n), cacheRead: String(total / 2n), cacheWrite: "0", output: String(total / 4n), reasoning: String(total - total / 4n - total / 2n - total / 4n) });
const cell = (tokens: bigint, records: number, days: number) => ({ records, days, firstUtcDay: day - days + 1, lastUtcDay: day, tokens: split(tokens) });
function fixture(): StatsTotals {
  const totals = parseStatsTotals({ schemaVersion: 2, generatedAtMs: now, revision: 9, updatedAtMs: now - 60_000, legacyRevision: 0, legacyVerifiedRevision: 0, legacyComplete: true,
    total: cell(1_000_000_000n, 300, 30),
    // The contract orders clients by name; the view must rank them by tokens.
    clients: [{ client: "claude", basis: "snapshots", ...cell(1_000_000n, 100, 10) }, { client: "codex", basis: "snapshots", ...cell(999_000_000n, 200, 30) }],
    devices: [{ deviceId: "b".repeat(64), enrolledAtMs: now - 5 * 86_400_000, revokedAtMs: now - 86_400_000, ...cell(1_000_000n, 100, 5), clients: [] },
      { deviceId: "a".repeat(64), enrolledAtMs: now - 40 * 86_400_000, revokedAtMs: null, ...cell(999_000_000n, 200, 30),
        clients: [{ client: "codex", basis: "snapshots", ...cell(999_000_000n, 200, 30) }] }],
  });
  if (totals === null) throw new Error("fixture must satisfy the totals contract");
  return totals;
}
const render = (state: TotalsPanelState, totals: StatsTotals | null = null) =>
  renderToStaticMarkup(<UsageTotalsView state={state} totals={totals} returnTo="/dashboard" retry={() => {}} />);

test("ready totals lead with the figure and rank clients and devices by tokens with shares", () => {
  const html = render("ready", fixture());
  expect(html).toContain("<strong>1.00B</strong> tokens"); expect(html).toContain("1,000,000,000 exact");
  expect(html.indexOf("Codex CLI")).toBeLessThan(html.indexOf("Claude Code"));
  expect(html).toContain(" · 100%"); expect(html).toContain(" · &lt;1%");
  expect(html.indexOf(`title="${"a".repeat(64)}"`)).toBeLessThan(html.indexOf(`title="${"b".repeat(64)}"`));
  expect(html).toContain("Revoked"); expect(html).toContain("No clients yet");
  expect(html).not.toContain("<table");
});

test("the panel says when the account last accepted an upload and flags a quiet collector", () => {
  expect(totalsFreshness(now - 38 * 60_000, now)).toEqual({ text: "38 minutes ago", tone: "fresh" });
  expect(totalsFreshness(now - 5 * 3_600_000, now)).toEqual({ text: "5 hours ago", tone: "idle" });
  expect(totalsFreshness(now - 26 * 3_600_000, now)).toEqual({ text: "26 hours ago", tone: "stale" });
  expect(totalsFreshness(now - 3 * 86_400_000, now)).toEqual({ text: "3 days ago", tone: "stale" });
  expect(totalsFreshness(now + 5_000, now)).toEqual({ text: "just now", tone: "fresh" });
  const fresh = renderToStaticMarkup(<UsageTotalsView state="ready" totals={fixture()} returnTo="/dashboard" retry={() => {}} nowMs={now} />);
  expect(fresh).toContain('data-tone="fresh"'); expect(fresh).toContain("Last upload 1 minute ago");
  const stale = renderToStaticMarkup(<UsageTotalsView state="ready" totals={fixture()} returnTo="/dashboard" retry={() => {}} nowMs={now + 2 * 86_400_000} />);
  expect(stale).toContain('data-tone="stale"'); expect(stale).toContain("check the collector");
  // One stacked share bar, in the same client hues as the rows (Codex keeps slot 0).
  expect(fresh).toMatch(/usage-totals__stack[^]*data-series="0"/u);
});

test("loading, signed-out, unenrolled and failed states never show figures", () => {
  const loading = render("loading");
  expect(loading).toContain('aria-busy="true"'); expect(loading).toContain("Loading your account totals.");
  expect(render("ready")).toContain('aria-busy="true"');
  expect(render("authentication_required")).toContain("/api/suite-auth/start?return_to=%2Fdashboard");
  expect(render("not_enrolled")).toContain("Enroll a collector");
  const failed = render("unavailable");
  expect(failed).toContain('role="alert"'); expect(failed).toContain(">Try again</button>");
  for (const html of [loading, failed]) expect(html).not.toContain("tokens</p>");
});
