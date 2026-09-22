import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UsageAccountControl, UsageAccountPanel, type AccountControlState } from "./account-control";
const accountId = `acct_${"a".repeat(32)}`;
function render(state: AccountControlState, id: string | null = accountId) {
  return renderToStaticMarkup(<UsageAccountPanel state={state} accountId={id} copyState="idle" copy={() => {}} retry={() => {}} signOut={() => {}} returnTo="/dashboard" />);
}
test("private identity never enters initial rendered HTML", () => {
  const html = renderToStaticMarkup(<UsageAccountControl returnTo="/dashboard" />);
  expect(html).toContain("Checking account"); expect(html).not.toContain("acct_"); expect(html).not.toContain("Verified with Hraness");
});
test("verified account disclosure exposes full selectable ID, copy and explicit account actions", () => {
  const html = render("ready");
  expect(html).toContain('<details class="usage-account" aria-label="Hraness account controls">');
  expect(html).not.toContain(" open="); expect(html).toContain(`value="${accountId}"`); expect(html).toContain('readOnly=""');
  for (const text of ["Verified with Hraness", "Copy account ID", "aicharts account", "does not confirm a successful upload", "Sign out", "Switch account"]) expect(html).toContain(text);
});
test("account failures and sign-out uncertainty expose recovery without false success", () => {
  const unavailable = render("unavailable", null);
  expect(unavailable).toContain("Retry account check"); expect(unavailable).toContain(">Sign out</button>");
  const failed = render("sign_out_failed");
  expect(failed).toContain("Sign-out unconfirmed"); expect(failed).toContain("Retry sign-out"); expect(failed).toContain("Last verified account ID");
  expect(failed).not.toContain("Verified with Hraness"); expect(failed).toContain('disabled="">Switch account');
  const signedOut = render("authentication_required", null);
  expect(signedOut).toContain("Sign-in required"); expect(signedOut).not.toContain("Signed out"); expect(signedOut).toContain(">Sign out</button>");
  expect(signedOut).toContain('action="/api/suite-auth/start"'); expect(signedOut).toContain('value="/dashboard"'); expect(signedOut).not.toContain("acct_");
  expect(render("signing_out").match(/disabled=""/g)?.length).toBe(3);
});
