import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("the root boundary delegates public-link and footer-submit instrumentation", async () => {
  const source = await readFile(new URL("./analytics-boundary.tsx", import.meta.url), "utf8");

  expect(source).toContain('document.addEventListener("click", handleDocumentClick, true)');
  expect(source).toContain('document.addEventListener("submit", handleDocumentSubmit, true)');
  expect(source).toContain('event.target.closest("a[href]")');
  expect(source).toContain("anchor.dataset.analyticsDestinationId");
  expect(source).toContain("anchor.dataset.analyticsDestinationKind");
  expect(source).toContain('form.dataset.slot !== mailingFormSlot');
  expect(source).toContain("newsletterSignupRequestEvent(audience)");
  expect(source).toContain('document.removeEventListener("click", handleDocumentClick, true)');
  expect(source).toContain('document.removeEventListener("submit", handleDocumentSubmit, true)');
});

test("the delegated boundary never reads personal or free-form DOM content", async () => {
  const source = await readFile(new URL("./analytics-boundary.tsx", import.meta.url), "utf8");

  for (const forbidden of [
    'input[name="email"]',
    "FormData",
    "MutationObserver",
    ".innerHTML",
    ".innerText",
    ".textContent",
    "fetch(",
  ]) {
    expect(source).not.toContain(forbidden);
  }
});
