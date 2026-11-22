import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { previewInputs } from "./preview.mjs";
import receipt from "./media/preview.json";

test("the portfolio preview matches its chart inputs (rebuild and run bun run showcase to refresh)", async () => {
  expect(receipt.inputs).toEqual(await previewInputs());
  expect(receipt.sha256).toBe(createHash("sha256").update(await readFile("showcase/media/preview.webp")).digest("hex"));
});
