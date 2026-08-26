import { afterEach, describe, expect, test } from "bun:test";
import { shareFileNatively } from "@hraness/design-kit/browser";

import {
  prepareModelCardImage,
  sharePreparedModelCardImage,
} from "./model-card-share";

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

afterEach(() => {
  if (originalNavigator === undefined) Reflect.deleteProperty(globalThis, "navigator");
  else Object.defineProperty(globalThis, "navigator", originalNavigator);
});

describe("model card image sharing", () => {
  test("prepares only successful PNG responses", async () => {
    const signal = new AbortController().signal;
    const prepared = await prepareModelCardImage({
      fetchImage: async () => new Response(new Blob(["png"], { type: "image/png" }), {
        headers: { "Content-Type": "image/png; charset=binary" },
      }),
      filename: "model.png",
      imageUrl: "/models/example/card.png?v=one",
      signal,
    });
    expect(prepared.file.name).toBe("model.png");
    expect(prepared.file.type).toBe("image/png");
    expect(prepared.imageUrl).toBe("/models/example/card.png?v=one");

    await expect(prepareModelCardImage({
      fetchImage: async () => new Response("not an image", {
        headers: { "Content-Type": "text/html" },
      }),
      filename: "model.png",
      imageUrl: "/models/example/card.png",
      signal,
    })).rejects.toThrow("not a PNG");
    await expect(prepareModelCardImage({
      fetchImage: async () => new Response(null, { status: 503 }),
      filename: "model.png",
      imageUrl: "/models/example/card.png",
      signal,
    })).rejects.toThrow("503");
  });

  test("falls back to one download when native image sharing is unavailable", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const file = new File([blob], "model.png", { type: "image/png" });
    const downloads: Array<readonly [Blob, string]> = [];
    const outcome = await sharePreparedModelCardImage(
      { blob, file, imageUrl: "/card.png" },
      "model.png",
      {
        download: (value, filename) => downloads.push([value, filename]),
        share: async () => ({ kind: "unavailable" }),
      },
    );
    expect(outcome).toBe("downloaded");
    expect(downloads).toEqual([[blob, "model.png"]]);
  });

  test("passes only the image file to the native Web Share API", async () => {
    const payloads: ShareData[] = [];
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        canShare: (payload: ShareData) => {
          payloads.push(payload);
          return true;
        },
        share: async (payload: ShareData) => { payloads.push(payload); },
      },
    });
    const file = new File(["png"], "model.png", { type: "image/png" });
    expect(await shareFileNatively(file)).toEqual({ kind: "shared" });
    expect(payloads).toHaveLength(2);
    for (const payload of payloads) {
      expect(Object.keys(payload)).toEqual(["files"]);
      expect(payload.files).toEqual([file]);
    }
  });
});
