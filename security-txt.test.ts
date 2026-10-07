import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("./public/.well-known/security.txt", import.meta.url), "utf8");

test("security.txt names the advisory and email contacts", () => {
  const contacts = [...text.matchAll(/^Contact: (.+)$/gm)].map((match) => match[1]);
  expect(contacts).toEqual(["https://github.com/hraness/aicharts/security/advisories/new", "mailto:hraness@pm.me"]);
});

test("security.txt has a canonical host and a future expiry", () => {
  expect(text).toContain("Canonical: https://aicharts.io/.well-known/security.txt");
  const expires = /^Expires: (.+)$/m.exec(text)?.[1];
  expect(expires).toBeDefined();
  expect(Date.parse(expires as string)).toBeGreaterThan(Date.now());
});
