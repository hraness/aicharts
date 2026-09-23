import { expect, test } from "bun:test";
import { exportCurrentStatsImage } from "./stats-export";

test("an image prepared across a closed view or changed authority never initiates a download", async () => {
  let resolve!: (image: string) => void, current = true, downloads = 0;
  const image = new Promise<string>(done => { resolve = done; });
  const result = exportCurrentStatsImage(() => current, () => image, () => { downloads++; });
  current = false; resolve("private-A");
  expect(await result).toBe(false); expect(downloads).toBe(0);
});
test("current views export once while canceled views do not even start preparation", async () => {
  for (const current of [false, true]) {
    let prepared = 0; const downloaded: string[] = [];
    expect(await exportCurrentStatsImage(() => current, async () => { prepared++; return "numeric-image"; }, image => downloaded.push(image))).toBe(current);
    expect(prepared).toBe(current ? 1 : 0); expect(downloaded).toEqual(current ? ["numeric-image"] : []);
  }
});
