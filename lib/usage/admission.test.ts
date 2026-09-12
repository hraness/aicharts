import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { assertProperty, fc } from "../property-test";
import type { Result } from "../result";
import {
  ADMISSION_BATCH_HEADER_BYTES, ADMISSION_JOURNAL_HEADER_BYTES, MAX_ADMISSION_BATCH_BYTES,
  MAX_ADMISSION_JOURNAL_BYTES, MAX_ADMISSION_TIMESTAMP, OPERATION_RECEIPT_BYTES,
  admissionHex, decodeAdmissionBatch, decodeAdmissionJournal, decodeAdmissionOperation,
  encodeAdmissionBatch, encodeAdmissionJournal, encodeAdmissionOperation,
} from "./admission";
import { createFixtureBatch, fixturePolicy } from "./fixtures";
import { encodeUsageBatch } from "./wire";

const unwrap = <T>(result: Result<T, string>): T => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const bytes = (length: number, value: number) => new Uint8Array(length).fill(value);
const binding = { accountId: bytes(16, 11), deviceId: bytes(32, 12), generation: bytes(32, 13) };
const zero = () => bytes(32, 0);
function operationInput(index = 1, sequence = index) {
  const fixture = createFixtureBatch(), id = new Uint8Array(16);
  new DataView(id.buffer).setUint32(12, index, true);
  const frame = unwrap(encodeUsageBatch({ ...fixture, usage: [{ ...fixture.usage[0], id }], prompts: [], intervals: [] }, fixturePolicy));
  return { ...binding, action: 1 as const, sequence, occurrenceId: id, expectedHeadHash: zero(), frame };
}
const operation = (index = 1, sequence = index) => unwrap(encodeAdmissionOperation(operationInput(index, sequence), fixturePolicy));
const batch = (count = 1, firstSequence = 1) => unwrap(encodeAdmissionBatch(
  Array.from({ length: count }, (_, index) => operation(index + 1, firstSequence + index)), fixturePolicy,
));
function decision(input: Uint8Array) {
  const decoded = unwrap(decodeAdmissionBatch(input, fixturePolicy));
  return { status: 1, accountJournalRevision: 7, committedAtMs: 123_456,
    receipts: decoded.operations.map(item => ({ outcome: 1, headOperationHash: item.operationHash })) };
}
const journal = (input: Uint8Array) => unwrap(encodeAdmissionJournal(input, decision(input), fixturePolicy));
const patch64 = (value: Uint8Array, offset: number, integer: bigint) => {
  const owned = Uint8Array.from(value); new DataView(owned.buffer).setBigUint64(offset, integer, true); return owned;
};

test("Rust and TypeScript match every independently assembled admission golden artifact", async () => {
  const source = await Bun.file(new URL("../../crates/aicharts-protocol/tests/fixtures/admission-v1.hex", import.meta.url)).text();
  const golden = new Map<string, Uint8Array>();
  for (const line of source.trim().split("\n")) {
    if (line.startsWith("#")) continue;
    const [key, value] = line.split("=");
    expect(value).toMatch(/^(?:[0-9a-f]{2})+$/);
    expect(golden.has(key)).toBe(false);
    golden.set(key, Uint8Array.from(Buffer.from(value, "hex")));
  }
  const get = (key: string) => { const value = golden.get(key); if (!value) throw new Error("missing synthetic fixture"); return value; };
  const policy = { firstDay: 20_706, lastDay: 20_706, registry: { revision: 1, models: [] } };
  const put = unwrap(decodeAdmissionOperation(get("operation_put"), policy));
  const tombstone = unwrap(decodeAdmissionOperation(get("operation_tombstone"), policy));
  expect(put.frame).toEqual(get("frame"));
  expect(put.operationHash).toEqual(get("operation_hash_put"));
  expect(tombstone.operationHash).toEqual(get("operation_hash_tombstone"));
  for (const op of [put, tombstone]) {
    expect(unwrap(encodeAdmissionOperation({ accountId: bytes(16, 0x11), deviceId: bytes(32, 0x22), generation: bytes(32, 0x33),
      action: op.action, sequence: op.action === 1 ? 41 : 42, occurrenceId: bytes(16, op.action === 1 ? 0x44 : 0x66),
      expectedHeadHash: bytes(32, op.action === 1 ? 0 : 0x77), frame: op.frame }, policy))).toEqual(op.bytes);
  }
  expect(unwrap(encodeAdmissionBatch([put.bytes, tombstone.bytes], policy))).toEqual(get("batch"));
  expect(unwrap(decodeAdmissionBatch(get("batch"), policy)).batchHash).toEqual(get("batch_hash"));
  for (const key of ["journal_accepted", "journal_conflict", "journal_revoked", "journal_deleted"]) {
    const decoded = unwrap(decodeAdmissionJournal(get(key), get("batch"), policy));
    expect(decoded.accountJournalRevision).toBe(7); expect(decoded.committedAtMs).toBe(1_800_000_000_000);
    expect(unwrap(encodeAdmissionJournal(get("batch"), { status: decoded.status, accountJournalRevision: 7,
      committedAtMs: 1_800_000_000_000, receipts: decoded.receipts.map(({ outcome, headOperationHash }) => ({ outcome, headOperationHash })) }, policy))).toEqual(get(key));
    if (key === "journal_accepted") {
      expect(decoded.receipts[0].bytes).toEqual(get("receipt_inserted"));
      expect(decoded.receipts[1].bytes).toEqual(get("receipt_tombstoned"));
    }
  }
});

describe("canonical admission operations", () => {
  test("uses exact fixed lengths, independently derived hashes and generic trusted frame policy", () => {
    const raw = operation(), decoded = unwrap(decodeAdmissionOperation(raw, fixturePolicy));
    expect(raw.length).toBe(320);
    expect(new TextDecoder().decode(raw.subarray(0, 4))).toBe("AICO");
    expect(decoded.frame).toEqual(operationInput().frame);
    expect(decoded.occurrenceId).toEqual(operationInput().occurrenceId);
    expect(admissionHex(decoded.payloadHash)).toBe(createHash("sha256").update(raw.subarray(184)).digest("hex"));
    expect(admissionHex(decoded.operationHash)).toBe(createHash("sha256").update("aicharts:usage-operation:v1\0").update(raw).digest("hex"));
    expect(decoded.frame[24 + 32]).toBe(3); // Provider account metadata is not the outer Hraness account binding.
    expect(decodeAdmissionOperation(raw, { ...fixturePolicy, firstDay: 20_001, lastDay: 20_001 }).ok).toBe(false);
  });

  test("supports fixed tombstones but does not accept payload bytes or hashes on them", () => {
    const tombstone = { ...operationInput(), action: 2, frame: new Uint8Array(), expectedHeadHash: bytes(32, 14) };
    const raw = unwrap(encodeAdmissionOperation(tombstone, fixturePolicy));
    expect(raw.length).toBe(184);
    expect(unwrap(decodeAdmissionOperation(raw, fixturePolicy)).action).toBe(2);
    raw[152] = 1;
    expect(decodeAdmissionOperation(raw, fixturePolicy)).toEqual({ ok: false, error: "invalid_hash" });
    expect(encodeAdmissionOperation({ ...tombstone, frame: bytes(136, 0) }, fixturePolicy).ok).toBe(false);
  });

  test("rejects every truncated prefix, trailing bytes, arbitrary strings and oversized input", () => {
    const raw = operation();
    for (let length = 0; length < raw.length; length += 1) expect(decodeAdmissionOperation(raw.subarray(0, length), fixturePolicy).ok).toBe(false);
    for (const input of [null, {}, "private transcript", new Uint8Array([...raw, 0]), bytes(100_000, 0)]) {
      expect(decodeAdmissionOperation(input, fixturePolicy).ok).toBe(false);
    }
  });

  test("validates magic, both versions, reserved bytes, action, identities, payload digest and occurrence", () => {
    for (const [offset, value] of [[0, 0], [4, 2], [6, 1], [8, 2], [10, 3], [11, 1], [12, 0], [104, 2], [152, 9], [184, 0]]) {
      const raw = operation(); raw[offset] = value;
      expect(decodeAdmissionOperation(raw, fixturePolicy).ok).toBe(false);
    }
    for (const [start, end] of [[16, 32], [32, 64], [64, 96], [104, 120]]) {
      const raw = operation(); raw.fill(0, start, end);
      expect(decodeAdmissionOperation(raw, fixturePolicy).ok).toBe(false);
    }
    for (const value of [0n, 9_007_199_254_740_992n, 0xffff_ffff_ffff_ffffn]) {
      expect(decodeAdmissionOperation(patch64(operation(), 96, value), fixturePolicy).ok).toBe(false);
    }
    expect(decodeAdmissionOperation(patch64(operation(), 96, BigInt(Number.MAX_SAFE_INTEGER)), fixturePolicy).ok).toBe(true);
  });

  test("rejects structured content extensions and accessors without invoking getters", () => {
    let called = false;
    const getter = { ...operationInput(), get frame() { called = true; throw new Error("private content"); } };
    for (const input of [{ ...operationInput(), transcript: "private content" }, { ...operationInput(), [Symbol("private")]: 1 }, getter]) {
      expect(encodeAdmissionOperation(input, fixturePolicy)).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(called).toBe(false);
    for (const sequence of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      expect(encodeAdmissionOperation({ ...operationInput(), sequence }, fixturePolicy).ok).toBe(false);
    }
  });

  test("owns input bytes and all decoded byte fields, including Node Buffer subviews", () => {
    const raw = Buffer.from(operation()), expected = unwrap(decodeAdmissionOperation(raw, fixturePolicy));
    const framed = Buffer.alloc(raw.length + 10); raw.copy(framed, 5);
    const decoded = unwrap(decodeAdmissionOperation(framed.subarray(5, -5), fixturePolicy));
    raw.fill(0); framed.fill(0);
    expect(decoded).toEqual(expected);
    decoded.bytes.fill(0);
    expect(decoded.frame).toEqual(operationInput().frame);
    expect(decoded.accountId).toEqual(binding.accountId);
  });
});

describe("immutable admission batch", () => {
  test("accepts 1 and 256, rejects 0 and 257, and hashes the exact complete container", () => {
    expect(batch(1).length).toBe(424);
    const raw = batch(256), decoded = unwrap(decodeAdmissionBatch(raw, fixturePolicy));
    expect(raw.length).toBe(MAX_ADMISSION_BATCH_BYTES);
    expect(decoded.operations.length).toBe(256);
    expect(admissionHex(decoded.batchHash)).toBe(createHash("sha256").update("aicharts:usage-batch:v1\0").update(raw).digest("hex"));
    expect(encodeAdmissionBatch([], fixturePolicy).ok).toBe(false);
    expect(encodeAdmissionBatch(Array.from({ length: 257 }, (_, index) => operation(index + 1)), fixturePolicy).ok).toBe(false);
    expect(decodeAdmissionBatch(new Uint8Array([...raw, 0]), fixturePolicy).ok).toBe(false);
  });

  test("enforces binding, unique occurrence IDs and contiguous full safe sequence range", () => {
    expect(encodeAdmissionBatch([operation(1), operation(1, 2)], fixturePolicy)).toEqual({ ok: false, error: "duplicate_occurrence" });
    expect(encodeAdmissionBatch([operation(1), operation(2, 3)], fixturePolicy)).toEqual({ ok: false, error: "invalid_sequence" });
    for (const key of ["accountId", "deviceId", "generation"] as const) {
      const second = unwrap(encodeAdmissionOperation({ ...operationInput(2), [key]: bytes(binding[key].length, 31) }, fixturePolicy));
      expect(encodeAdmissionBatch([operation(1), second], fixturePolicy)).toEqual({ ok: false, error: "invalid_binding" });
    }
    expect(batch(2, Number.MAX_SAFE_INTEGER - 1).length).toBe(744);
    expect(encodeAdmissionBatch([operation(1, Number.MAX_SAFE_INTEGER), operation(2, 1)], fixturePolicy).ok).toBe(false);
  });

  test("rejects trailing, truncated, malformed member lengths and header/member disagreement", () => {
    const raw = batch(2);
    for (let length = 0; length < raw.length; length += 1) expect(decodeAdmissionBatch(raw.subarray(0, length), fixturePolicy).ok).toBe(false);
    for (const [offset, value] of [[0, 0], [4, 2], [6, 1], [8, 2], [10, 0], [12, 0], [16, 90], [96, 2], [104 + 12, 255]]) {
      const changed = Uint8Array.from(raw); changed[offset] = value;
      expect(decodeAdmissionBatch(changed, fixturePolicy).ok).toBe(false);
    }
    expect(decodeAdmissionBatch(new Uint8Array([...raw, 0]), fixturePolicy).ok).toBe(false);
  });

  test("can carry mixed canonical puts and tombstones without changing framing", () => {
    const tombstone = unwrap(encodeAdmissionOperation({ ...operationInput(2), action: 2, frame: new Uint8Array(), expectedHeadHash: bytes(32, 5) }, fixturePolicy));
    const raw = unwrap(encodeAdmissionBatch([operation(1), tombstone], fixturePolicy));
    expect(raw.length).toBe(608);
    expect(unwrap(decodeAdmissionBatch(raw, fixturePolicy)).operations.map(item => item.action)).toEqual([1, 2]);
  });

  test("rejects custom arrays and index accessors without consuming their iterators/getters", () => {
    let invoked = false;
    const iterator = [operation()];
    Object.defineProperty(iterator, Symbol.iterator, { value: function* () { invoked = true; yield operation(1); yield operation(2); } });
    const accessor = [operation()];
    Object.defineProperty(accessor, "0", { get() { invoked = true; throw new Error("private canary"); } });
    const extension = Object.assign([operation()], { transcript: "private canary" });
    const symbol = Object.assign([operation()], { [Symbol("private")]: true });
    for (const input of [iterator, accessor, extension, symbol, new Array(1), new Array(1_000_000)]) {
      expect(encodeAdmissionBatch(input, fixturePolicy).ok).toBe(false);
    }
    const raw = batch(), selected = decision(raw);
    Object.defineProperty(selected.receipts, "0", { get() { invoked = true; throw new Error("private canary"); } });
    expect(encodeAdmissionJournal(raw, selected, fixturePolicy).ok).toBe(false);
    expect(invoked).toBe(false);
  });

  test("typed-array snapshots use intrinsic bytes, not custom iterators/length, and reject proxies/shared memory", () => {
    let invoked = false;
    const raw = operation();
    Object.defineProperty(raw, "length", { get() { invoked = true; throw new Error("private canary"); } });
    Object.defineProperty(raw, Symbol.iterator, { value() { invoked = true; throw new Error("private canary"); } });
    expect(decodeAdmissionOperation(raw, fixturePolicy).ok).toBe(true);
    expect(invoked).toBe(false);
    expect(decodeAdmissionOperation(new Proxy(raw, {}), fixturePolicy).ok).toBe(false);
    expect(encodeAdmissionOperation({ ...operationInput(), frame: new Proxy(operationInput().frame, {}) }, fixturePolicy).ok).toBe(false);
    expect(decodeAdmissionBatch(new Uint8Array(new SharedArrayBuffer(424)), fixturePolicy).ok).toBe(false);
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    expect(encodeAdmissionOperation(revoked.proxy, fixturePolicy).ok).toBe(false);
  });
});

describe("exact terminal journal", () => {
  test("echoes operation descriptors and hashes, with one revision/time for all members", () => {
    const raw = batch(2), terminal = journal(raw), decoded = unwrap(decodeAdmissionJournal(terminal, raw, fixturePolicy));
    expect(terminal.length).toBe(160 + 2 * 264);
    expect(decoded.status).toBe(1);
    expect(decoded.accountJournalRevision).toBe(7);
    expect(decoded.committedAtMs).toBe(123_456);
    for (let index = 0; index < 2; index += 1) {
      const op = unwrap(decodeAdmissionBatch(raw, fixturePolicy)).operations[index];
      const receipt = decoded.receipts[index];
      expect(receipt.bytes.subarray(12, 184)).toEqual(op.bytes.subarray(12, 184));
      expect(receipt.headOperationHash).toEqual(op.operationHash);
    }
    const largest = batch(256);
    expect(journal(largest).length).toBe(MAX_ADMISSION_JOURNAL_BYTES);
  });

  test("admits correct replacements, tombstones and identical-payload duplicates", () => {
    for (const [action, outcome] of [[1, 2], [2, 3]] as const) {
      const op = unwrap(encodeAdmissionOperation({ ...operationInput(), action, expectedHeadHash: bytes(32, 99),
        frame: action === 1 ? operationInput().frame : new Uint8Array() }, fixturePolicy));
      const raw = unwrap(encodeAdmissionBatch([op], fixturePolicy)), selected = decision(raw);
      selected.receipts[0].outcome = outcome;
      expect(encodeAdmissionJournal(raw, selected, fixturePolicy).ok).toBe(true);
    }
    const raw = batch(), selected = decision(raw);
    selected.receipts[0] = { outcome: 4, headOperationHash: bytes(32, 71) };
    expect(encodeAdmissionJournal(raw, selected, fixturePolicy).ok).toBe(true);
  });

  test("all-or-nothing rejection requires a conflict/deletion or uniform device revocation", () => {
    const raw = batch(2);
    for (const outcomes of [[5, 6], [8, 6], [5, 8], [7, 7]]) {
      const selected = { ...decision(raw), status: 2,
        receipts: outcomes.map(outcome => ({ outcome, headOperationHash: bytes(32, outcome === 8 ? 18 : 0) })) };
      const terminal = unwrap(encodeAdmissionJournal(raw, selected, fixturePolicy));
      expect(unwrap(decodeAdmissionJournal(terminal, raw, fixturePolicy)).status).toBe(2);
    }
    for (const outcomes of [[6, 6], [7, 6], [7, 5], [7, 8], [5, 1], [1, 1]]) {
      expect(encodeAdmissionJournal(raw, { ...decision(raw), status: 2,
        receipts: outcomes.map(outcome => ({ outcome, headOperationHash: zero() })) }, fixturePolicy).ok).toBe(false);
    }
  });

  test("rejects impossible action, predecessor, outcome and head combinations", () => {
    const raw = batch();
    for (const [outcome, head] of [[1, zero()], [1, bytes(32, 4)], [2, bytes(32, 4)], [3, bytes(32, 4)], [4, zero()], [8, zero()], [7, bytes(32, 4)]]) {
      expect(encodeAdmissionJournal(raw, { ...decision(raw), status: (outcome as number) <= 4 ? 1 : 2,
        receipts: [{ outcome, headOperationHash: head }] }, fixturePolicy).ok).toBe(false);
    }
    const replace = unwrap(encodeAdmissionOperation({ ...operationInput(), expectedHeadHash: bytes(32, 4) }, fixturePolicy));
    const changed = unwrap(encodeAdmissionBatch([replace], fixturePolicy));
    expect(encodeAdmissionJournal(changed, decision(changed), fixturePolicy).ok).toBe(false);
  });

  test("one corrupt receipt invalidates the entire journal and never returns partial acceptance", () => {
    const raw = batch(2), terminal = journal(raw), second = ADMISSION_JOURNAL_HEADER_BYTES + OPERATION_RECEIPT_BYTES;
    for (const relative of [0, 4, 6, 8, 10, 12, 16, 32, 64, 96, 104, 120, 152, 184, 216, 248, 256]) {
      const changed = Uint8Array.from(terminal); changed[second + relative] ^= 1;
      expect(decodeAdmissionJournal(changed, raw, fixturePolicy).ok).toBe(false);
    }
    for (const offset of [0, 4, 6, 8, 10, 12, 16, 32, 64, 96, 104, 136, 144, 152, 153, 159]) {
      const changed = Uint8Array.from(terminal); changed[offset] ^= 1;
      expect(decodeAdmissionJournal(changed, raw, fixturePolicy).ok).toBe(false);
    }
    for (let length = 0; length < terminal.length; length += 1) expect(decodeAdmissionJournal(terminal.subarray(0, length), raw, fixturePolicy).ok).toBe(false);
    expect(decodeAdmissionJournal(new Uint8Array([...terminal, 0]), raw, fixturePolicy).ok).toBe(false);
    expect(decodeAdmissionJournal(terminal, batch(2, 2), fixturePolicy).ok).toBe(false);
  });

  test("strictly bounds times/revisions and rejects extensions without reflecting content", () => {
    const raw = batch();
    expect(encodeAdmissionJournal(raw, { ...decision(raw), committedAtMs: 0, accountJournalRevision: Number.MAX_SAFE_INTEGER }, fixturePolicy).ok).toBe(true);
    expect(encodeAdmissionJournal(raw, { ...decision(raw), committedAtMs: MAX_ADMISSION_TIMESTAMP }, fixturePolicy).ok).toBe(true);
    for (const [field, values] of [["accountJournalRevision", [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]],
      ["committedAtMs", [-1, 1.5, Infinity, MAX_ADMISSION_TIMESTAMP + 1]]] as const) {
      for (const value of values) expect(encodeAdmissionJournal(raw, { ...decision(raw), [field]: value }, fixturePolicy).ok).toBe(false);
    }
    expect(encodeAdmissionJournal(raw, { ...decision(raw), content: "private content" }, fixturePolicy).ok).toBe(false);
    expect(encodeAdmissionJournal(raw, { ...decision(raw), receipts: [{ ...decision(raw).receipts[0], content: "private" }] }, fixturePolicy).ok).toBe(false);
  });

  test("decoders return independent owned bytes and do not treat re-encoding as authentication", () => {
    const raw = batch(), terminal = Buffer.from(journal(raw));
    const decoded = unwrap(decodeAdmissionJournal(terminal, raw, fixturePolicy));
    const expected = Uint8Array.from(decoded.receipts[0].bytes);
    terminal.fill(0); raw.fill(0); decoded.bytes.fill(0);
    expect(decoded.receipts[0].bytes).toEqual(expected);
  });
});

test("bounded arbitrary and mutated input either fails or exactly re-encodes", () => {
  assertProperty(fc.property(fc.uint8Array({ maxLength: 1_000 }), value => {
    const decoded = decodeAdmissionBatch(value, fixturePolicy);
    if (decoded.ok) expect(unwrap(encodeAdmissionBatch(decoded.value.operations.map(item => item.bytes), fixturePolicy))).toEqual(value);
    else expect(decoded.error).toMatch(/^[a-z_]+$/);
  }));
  assertProperty(fc.property(fc.integer({ min: 0, max: 423 }), fc.integer({ min: 0, max: 255 }), (offset, value) => {
    const raw = batch(); raw[offset] = value;
    const decoded = decodeAdmissionBatch(raw, fixturePolicy);
    if (decoded.ok) expect(unwrap(encodeAdmissionBatch(decoded.value.operations.map(item => item.bytes), fixturePolicy))).toEqual(raw);
  }));
  expect(ADMISSION_BATCH_HEADER_BYTES).toBe(104);
});
