import { describe, expect, test } from "bun:test";
import { assertProperty, fc } from "../property-test";
import { createFixtureBatch, fixturePolicy } from "./fixtures";
import { DAY_MS, MAX_PACKET_BYTES, MAX_RECORDS, MAX_TOKEN_COUNT, decodeUsageBatch, encodeUsageBatch, totalTokens, type Batch, type WireError } from "./wire";

function encoded(batch: Batch = createFixtureBatch()): Uint8Array {
  const result = encodeUsageBatch(batch, fixturePolicy);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("usage wire v1", () => {
  test("matches the independent Rust/TypeScript golden fixture byte for byte", async () => {
    const hex = (await Bun.file(new URL("../../fixtures/usage/v1.hex", import.meta.url)).text()).replace(/\s/g, "");
    expect(hex).toMatch(/^(?:[0-9a-f]{2})+$/);
    const bytes = new Uint8Array(hex.match(/../g)!.map(value => Number.parseInt(value, 16)));
    expect(encoded()).toEqual(bytes);
    expect(decodeUsageBatch(bytes, fixturePolicy)).toEqual({ ok: true, value: createFixtureBatch() });
  });

  test("round-trips all families with exact bigint counters and nonzero byteOffset", () => {
    const batch = createFixtureBatch(), bytes = encoded(batch);
    expect(bytes.length).toBe(240);
    expect(Array.from(bytes.slice(0, 24))).toEqual([65, 73, 67, 85, 1, 0, 0, 0, 32, 78, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    const framed = new Uint8Array(bytes.length + 8);
    framed.set(bytes, 4);
    expect(decodeUsageBatch(framed.subarray(4, -4), fixturePolicy)).toEqual({ ok: true, value: batch });
    expect(totalTokens(batch.usage[0].tokens)).toEqual({ ok: true, value: 1_368n });
  });

  test("rejects framing changes and reserved fields without reflecting input", () => {
    const patches: readonly [number, number, WireError][] = [
      [0, 0, "invalid_header"], [4, 2, "unsupported_version"], [6, 1, "reserved_nonzero"],
      [18, 1, "reserved_nonzero"], [20, 2, "registry_mismatch"], [24 + 62, 1, "reserved_nonzero"],
    ];
    for (const [offset, value, error] of patches) {
      const bytes = encoded(); bytes[offset] = value;
      expect(decodeUsageBatch(bytes, fixturePolicy)).toEqual({ ok: false, error });
    }
    expect(decodeUsageBatch(new Uint8Array(MAX_PACKET_BYTES + 1), fixturePolicy)).toEqual({ ok: false, error: "invalid_size" });
    expect(decodeUsageBatch(encoded().slice(0, -1), fixturePolicy)).toEqual({ ok: false, error: "invalid_size" });
    expect(decodeUsageBatch(new Uint8Array([...encoded(), 0]), fixturePolicy)).toEqual({ ok: false, error: "invalid_size" });
    const countOverflow = encoded(); new DataView(countOverflow.buffer).setUint16(12, MAX_RECORDS + 1, true);
    expect(decodeUsageBatch(countOverflow, fixturePolicy)).toEqual({ ok: false, error: "invalid_count" });
  });

  test("decoded identifiers do not retain mutable Node Buffer input views", () => {
    const bytes = Buffer.from(encoded()), decoded = decodeUsageBatch(bytes, fixturePolicy);
    if (!decoded.ok) throw new Error(decoded.error);
    bytes.fill(0);
    expect(decoded.value).toEqual(createFixtureBatch());
  });

  test("rejects out-of-policy days, untrusted models, unsupported tiers, and invalid enums", () => {
    const batch = createFixtureBatch();
    expect(encodeUsageBatch({ ...batch, utcDay: 20_001 }, fixturePolicy)).toEqual({ ok: false, error: "invalid_day" });
    expect(decodeUsageBatch(encoded(), { ...fixturePolicy, firstDay: 20_001 })).toEqual({ ok: false, error: "invalid_policy" });
    for (const [field, value, error] of [
      ["modelId", 2, "unknown_model"], ["contextTier", 1, "invalid_context_tier"],
      ["provider", 3, "invalid_enum"], ["authMode", 3, "invalid_enum"], ["evidence", 3, "invalid_enum"],
      ["offsetMs", DAY_MS, "invalid_offset"],
    ] as const) {
      expect(encodeUsageBatch({ ...batch, usage: [{ ...batch.usage[0], [field]: value }] }, fixturePolicy)).toEqual({ ok: false, error });
    }
    const models = { ...fixturePolicy, registry: { revision: 1, models: [[1, 2]] as const } };
    expect(encodeUsageBatch({ ...batch, usage: [{ ...batch.usage[0], modelId: 2 }] }, models).ok).toBe(true);
    expect(encodeUsageBatch({ ...batch, usage: [{ ...batch.usage[0], modelId: 2, provider: 2 }] }, models)).toEqual({ ok: false, error: "unknown_model" });
  });

  test("enforces counter relationships, provider semantics, IDs, and canonical order", () => {
    const batch = createFixtureBatch(), usage = batch.usage[0];
    for (const tokens of [
      { ...usage.tokens, inputUncached: MAX_TOKEN_COUNT + 1n }, { ...usage.tokens, cacheRead: -1n },
      { ...usage.tokens, reasoningOutput: usage.tokens.output + 1n }, { ...usage.tokens, cacheWrite5m: 1n },
      { ...usage.tokens, inputUncached: 0n, cacheRead: 0n, output: 0n, reasoningOutput: 0n },
    ]) expect(encodeUsageBatch({ ...batch, usage: [{ ...usage, tokens }] }, fixturePolicy)).toEqual({ ok: false, error: "invalid_tokens" });
    expect(encodeUsageBatch({ ...batch, usage: [{ ...usage, id: new Uint8Array(16) }] }, fixturePolicy)).toEqual({ ok: false, error: "invalid_id" });
    expect(encodeUsageBatch({ ...batch, usage: [usage, usage] }, fixturePolicy)).toEqual({ ok: false, error: "invalid_order" });
    expect(encodeUsageBatch({ ...batch, prompts: [batch.prompts[0], batch.prompts[0]] }, fixturePolicy)).toEqual({ ok: false, error: "invalid_order" });
    expect(encodeUsageBatch({ ...batch, intervals: [batch.intervals[0], batch.intervals[0]] }, fixturePolicy)).toEqual({ ok: false, error: "invalid_order" });
    expect(encodeUsageBatch({ ...batch, intervals: [{ ...batch.intervals[0], endMs: 1_000 }] }, fixturePolicy)).toEqual({ ok: false, error: "invalid_offset" });
    expect(encodeUsageBatch({ ...batch, intervals: [{ ...batch.intervals[0], clockUncertaintyMs: 60_001 }] }, fixturePolicy)).toEqual({ ok: false, error: "invalid_offset" });
  });

  test("rejects free-form keys and string token counts at the encoder boundary", () => {
    const batch = createFixtureBatch();
    for (const value of [null, {}, "private prompt", { ...batch, transcript: "private prompt" }]) expect(encodeUsageBatch(value, fixturePolicy).ok).toBe(false);
    expect(encodeUsageBatch({ ...batch, usage: [{ ...batch.usage[0], transcript: "private prompt" }] }, fixturePolicy)).toEqual({ ok: false, error: "invalid_record" });
    expect(encodeUsageBatch({ ...batch, usage: [{ ...batch.usage[0], tokens: { ...batch.usage[0].tokens, output: "789" } }] }, fixturePolicy)).toEqual({ ok: false, error: "invalid_tokens" });
  });

  test("accepts maximum family sizes at the exact packet cap", () => {
    const fixture = createFixtureBatch();
    const identifier = (index: number) => {
      const bytes = new Uint8Array(16); new DataView(bytes.buffer).setUint32(12, index + 1); return bytes;
    };
    const batch: Batch = {
      ...fixture,
      usage: Array.from({ length: MAX_RECORDS }, (_, index) => ({ ...fixture.usage[0], id: identifier(index) })),
      prompts: Array.from({ length: MAX_RECORDS }, (_, index) => ({ ...fixture.prompts[0], id: identifier(index) })),
      intervals: Array.from({ length: MAX_RECORDS }, (_, index) => ({ ...fixture.intervals[0], executionId: identifier(index) })),
    };
    const bytes = encoded(batch);
    expect(bytes.byteLength).toBe(MAX_PACKET_BYTES);
    const decoded = decodeUsageBatch(bytes, fixturePolicy);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.intervals.length).toBe(MAX_RECORDS);
  });

  test("counter round-trip holds across bounded bigint values", () => {
    assertProperty(fc.property(
      fc.bigInt({ min: 0n, max: MAX_TOKEN_COUNT }), fc.bigInt({ min: 0n, max: MAX_TOKEN_COUNT }),
      fc.bigInt({ min: 1n, max: MAX_TOKEN_COUNT }), fc.boolean(),
      (input, cached, output, claude) => {
        const fixture = createFixtureBatch();
        const batch: Batch = { ...fixture, usage: [{ ...fixture.usage[0], provider: claude ? 2 : 1, tokens: {
          inputUncached: input, cacheRead: cached, cacheWrite5m: claude ? cached : 0n,
          cacheWrite1h: claude ? input : 0n, output, reasoningOutput: output / 2n,
        } }] };
        expect(decodeUsageBatch(encoded(batch), fixturePolicy)).toEqual({ ok: true, value: batch });
      },
    ));
  });

  test("arbitrary bytes produce bounded errors or canonically re-encodable packets", () => {
    assertProperty(fc.property(fc.uint8Array({ maxLength: 2_000 }), bytes => {
      const decoded = decodeUsageBatch(bytes, fixturePolicy);
      if (decoded.ok) expect(encodeUsageBatch(decoded.value, fixturePolicy)).toEqual({ ok: true, value: bytes });
      else expect(decoded.error).toMatch(/^[a-z_]+$/);
    }));
  });

  test("mutated valid frames cannot bypass canonical decoding", () => {
    assertProperty(fc.property(fc.integer({ min: 0, max: 239 }), fc.integer({ min: 0, max: 255 }), (offset, value) => {
      const bytes = encoded(); bytes[offset] = value;
      const decoded = decodeUsageBatch(bytes, fixturePolicy);
      if (decoded.ok) expect(encodeUsageBatch(decoded.value, fixturePolicy)).toEqual({ ok: true, value: bytes });
      else expect(decoded.error).toMatch(/^[a-z_]+$/);
    }));
  });
});
