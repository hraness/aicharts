import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PairingApproval, PairingApprovalPanel } from "./pairing-approval";
import type { PairingView } from "@/app/usage/pairing/client";
const intent = "11".repeat(32), token = "22".repeat(32);
const reply = { schemaVersion: 1, state: "pending", accountId: `acct_${"33".repeat(16)}`, expiresAtMs: 1_800_000_300_000, csrfToken: token } as const;
const markup = (view: PairingView) => renderToStaticMarkup(<PairingApprovalPanel view={view} read={() => {}} decide={() => {}} navigating={() => {}} />);

test("disabled SSR is meaningful without browser globals and has no auth action", () => {
  const html = renderToStaticMarkup(<PairingApproval available={false} />);
  expect(html).toContain("Connect your collector"); expect(html).toContain("Collector connection is unavailable. Local collection still works.");
  expect(html).not.toContain("<form"); expect(html).not.toContain("/api/suite-auth/start");
});
test("start is a native canonical POST form with one hidden locator and no account or proof", () => {
  const html = markup({ kind: "start", intentId: intent });
  expect(html).toContain('method="post"'); expect(html).toContain('action="/api/usage/pairing/start"');
  expect(html).toContain('encType="application/x-www-form-urlencoded"'); expect(html).toContain('name="intentId"');
  expect(html).toContain("Continue with Hraness"); expect(html).not.toContain(token); expect(html).not.toContain(reply.accountId);
  expect(markup({ kind: "starting", intentId: intent })).toContain('disabled=""');
});
test("only a checked pending account displays approve/deny, with opaque identity and expiry", () => {
  const html = markup({ kind: "reply", reply });
  expect(html).toContain("Approve collector"); expect(html).toContain(">Deny</button>"); expect(html).toContain(reply.accountId);
  expect(html).toContain('<time dateTime="'); expect(html).toContain(" UTC"); expect(html).not.toContain(token);
  for (const state of ["browser-approved", "terminal-confirmed", "denied"] as const) {
    const shown = markup({ kind: "reply", reply: { ...reply, state } });
    expect(shown).not.toContain("Approve collector"); expect(shown).not.toContain(token);
  }
  const approved = markup({ kind: "reply", reply: { ...reply, state: "browser-approved" } });
  expect(approved).toContain("Approved. Return to your terminal to confirm this account.");
  expect(approved).toContain(">Deny</button>");
  for (const state of ["terminal-confirmed", "denied"] as const) {
    expect(markup({ kind: "reply", reply: { ...reply, state } })).not.toContain(">Deny</button>");
  }
});
test("uncertainty has an explicit read action and no POST retry or ordinary sign-in", () => {
  for (const kind of ["uncertain", "unavailable", "rejected"] as const) {
    const html = markup({ kind }); expect(html).toContain("Check approval status"); expect(html).not.toContain("Approve collector");
    expect(html).not.toContain("<form"); expect(html).not.toContain("/api/suite-auth/start");
  }
  for (const kind of ["expired", "invalid", "loading", "deciding"] as const) {
    expect(markup({ kind })).not.toContain("Approve collector"); expect(markup({ kind })).not.toContain("<button");
  }
});
