import { createHash } from "node:crypto";
import { expect, test } from "bun:test";

test("the viewport shell matches its immutable design-kit source", async () => {
  const directory = new URL("../styles/vendor/hraness-site-shell/", import.meta.url);
  const css = await Bun.file(new URL("site-shell.css", directory)).text();
  const provenance = await Bun.file(new URL("provenance.json", directory)).json();
  expect(createHash("sha256").update(css).digest("hex")).toBe(provenance.sha256);
  expect(provenance.commit).toBe("27a3a33aa8f8015dd56bfce0a8025bd1e476bbbe");
});
