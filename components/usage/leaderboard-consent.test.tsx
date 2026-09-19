import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaderboardConsentPanel, type ConsentState } from "./leaderboard-consent";

const view = { schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: null } as const;
const markup = (state: ConsentState) => renderToStaticMarkup(<LeaderboardConsentPanel state={state} handle="reader" confirmed
  setHandle={() => {}} setConfirmed={() => {}} publish={() => {}} withdraw={() => {}} retry={() => {}} />);

test("unknown consent never claims an account is unpublished", () => {
  for (const kind of ["loading", "unavailable", "authentication_required", "not_enrolled", "publishing_full", "uncertain"] as const) {
    const html = markup({ kind });
    expect(html).not.toContain("Not publishing");
    expect(html).not.toContain("You are not publishing");
  }
  expect(markup({ kind: "ready", view })).toContain("Not publishing");
});

test("an uncertain consent write offers a read, never a duplicate mutation", () => {
  const html = markup({ kind: "uncertain" });
  expect(html).toContain("your choice may have been saved");
  expect(html).toContain("Check publishing status");
  expect(html).not.toContain("Publish to leaderboard");
  expect(html).not.toContain("Withdraw from leaderboard");
  expect(html).not.toContain("<form");
});

test("in-flight publishing freezes the reviewed choice and shows saving state", () => {
  const html = markup({ kind: "busy", view });
  expect(html).toContain("Saving choice");
  expect(html.match(/disabled=""/g)?.length).toBe(3);
  expect(html).not.toContain("Not publishing");
});

test("published consent gives both withdrawal and access to the public result", () => {
  const html = markup({ kind: "ready", view: { schemaVersion: 1, consent: true, publicHandle: "reader", consentedAtMs: 1_800_000_000_000 } });
  expect(html).toContain("Publishing enabled");
  expect(html).toContain('href="/leaderboard"');
  expect(html).toContain("Withdraw from leaderboard");
});


test("a claimed public handle preserves the editable form and explains recovery", () => {
  const html = markup({ kind: "handle_unavailable", view });
  expect(html).toContain("That handle is already in use. Choose another.");
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain('value="reader"');
  expect(html).toContain("Publish to leaderboard");
  expect(html).not.toContain('disabled=""');
});


test("capacity refusal explains the limit and offers a read without a publishing retry", () => {
  const html = markup({ kind: "publishing_full" });
  expect(html).toContain("The leaderboard is full");
  expect(html).toContain("New publishing requests are not being accepted");
  expect(html).toContain("Check publishing status");
  expect(html).toContain('href="/usage/sessions"');
  expect(html).not.toContain("your choice may have been saved");
  expect(html).not.toContain("Publish to leaderboard");
  expect(html).not.toContain("<form");
});
