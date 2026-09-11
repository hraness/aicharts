# Usage measurement wire v1

This is the local-only foundation for AI Charts Usage. No authenticated ingestion route is enabled by this contract. A structurally valid packet is self-reported data, not proof of authentic provider usage. Identity enrollment, durable admission, provider reconciliation and publishing remain separate work.

The separate [admission v1 contract](usage-admission-v1.md) wraps exact single-Usage frames with operation identities, predecessor hashes, bounded batches and terminal journals. It does not change these measurement bytes or turn structurally valid frames into authenticated usage.

## Representation

Unsigned integers use little-endian encoding; 16-byte opaque identifiers compare lexicographically as bytes. There are no strings, arbitrary metadata, padding extensions or client-supplied dollar amounts. IDs will be scoped to a user's recovered deduplication namespace, never based on device/path identity. The local collector requires an explicit private namespace key for keyed source identities; that key is never serialized.

Each batch covers one UTC epoch day. Offsets are milliseconds into the day. Records may span midnight only by splitting intervals at the UTC boundary while preserving execution identity. Decoders take an explicit accepted day range and a trusted model registry; no model names are learned from submitted data. Model ID 0 means unknown and never implies free pricing. Registry revision 1 initially contains only unknown model ID 0; real model mappings require a separately reviewed registry change.

Header (24 bytes):

| Offset | Field |
| --- | --- |
| 0 | 4 bytes, literal ASCII `AICU` |
| 4 | u16 version, exactly 1 |
| 6 | u16 reserved, zero |
| 8 | u32 UTC epoch day |
| 12 | u16 usage count |
| 14 | u16 prompt count |
| 16 | u16 interval count |
| 18 | u16 reserved, zero |
| 20 | u32 registry revision, exactly the caller's trusted revision |

Each family allows 0–4,096 records; at least one record overall. Exact total size is `24 + usageCount*112 + promptCount*56 + intervalCount*48`, capped at 884,760 bytes. Check framing/counts before allocation. No compression in the wire v1 admission boundary. Reject truncated/trailing bytes, unsupported values, duplicate/out-of-order keys and invalid relational bounds. Errors are fixed codes that never reflect submitted values.

Usage record (112 bytes):

| Offset | Field |
| --- | --- |
| 0 | 16-byte occurrence ID, nonzero |
| 16 | 16-byte execution ID; all-zero means unknown |
| 32 | 16-byte account ID; all-zero means unassigned |
| 48 | u32 completion offset, less than 86,400,000 |
| 52 | u8 provider: 1 Codex, 2 Claude Code |
| 53 | u8 auth mode: 0 unknown, 1 subscription, 2 API |
| 54 | u16 evidence flags: bit 0 imported, bit 1 live; exactly one set |
| 56 | u32 model registry ID |
| 60 | u16 context tier: 0 unknown; v1 accepts only 0 until a price registry defines tiers |
| 62 | u16 reserved, zero |
| 64,72,80,88 | four u64: uncached input, cache read, cache write 5m, cache write 1h |
| 96,104 | two u64: output and its reasoning subset |

Every token counter is at most 10^12. Reasoning cannot exceed output and is never added again to total tokens. Codex cache-write counters must be zero. At least one disjoint token category must be nonzero. These are transport bounds, not a fraud score. Usage records are strictly sorted by occurrence ID, rejecting conflicting duplicates. Conflicting finalized occurrences across batches require a future explicit correction operation, never silent accumulation.

Prompt record (56 bytes): occurrence ID, execution ID and account ID at offsets 0/16/32; u32 timestamp at 48; provider u8 at 52; origin u8 at 53 (0 unknown, 1 human, 2 automation); evidence u16 at 54 with the same flags. Occurrence ID is nonzero; the other IDs may be zero. Strictly sort by occurrence ID. A provider `user` role does not establish human authorship; historical parsers must use unknown origin unless structured provenance establishes otherwise.

Interval record (48 bytes): nonzero execution ID at 0, account ID at 16; u32 start/end offsets at 32/36; provider u8 at 40; kind u8 at 41 (1 agent work in progress, 2 API request in flight); evidence u16 at 42; clock uncertainty u32 milliseconds at 44 (at most 60,000). `0 <= start < end <= 86,400,000`. Sort strictly by `(execution ID, kind, start, end, account ID, provider)`; reject exact duplicate keys. For kind 1, execution ID identifies the agent/subagent run; for kind 2 it identifies an individual API request in a separate keyed namespace, not its parent agent. Otherwise parallel requests could be incorrectly unioned. Observations can overlap and are unioned before computing metrics. Imported events alone cannot synthesize exact activity intervals.

## Rust API shared with the collector

The `aicharts-protocol` crate exports `Id = [u8;16]`, `Provider::{Codex,ClaudeCode}`, `AuthMode::{Unknown,Subscription,Api}`, `Origin::{Unknown,Human,Automation}`, `IntervalKind::{AgentWork,ApiRequest}`, `Evidence::{Imported,Live}`, `Tokens { input_uncached, cache_read, cache_write_5m, cache_write_1h, output, reasoning_output }`, `Usage { id, execution_id, account_id, offset_ms, provider, auth_mode, evidence, model_id, context_tier, tokens }`, `Prompt { id, execution_id, account_id, offset_ms, provider, origin, evidence }`, `Interval { execution_id, account_id, start_ms, end_ms, provider, kind, evidence, clock_uncertainty_ms }`, and `Batch { utc_day, registry_revision, usage, prompts, intervals }`.

Validation uses `Policy { first_day, last_day, registry: &Registry }` and `Registry { revision, models: Vec<(Provider,u32)> }`. Unknown model 0 is accepted for either provider without a registry entry. Export `encode(&Batch, &Policy) -> Result<Vec<u8>, Error>` and `decode(&[u8], &Policy) -> Result<Batch, Error>`, and checked `Tokens::total()`. Enum wire values follow the tables above. Public constructors do not bypass validation. Encoders require canonical order, rather than silently dropping duplicate data.

The TypeScript decoder/encoder in `lib/usage` follows the same byte contract with `bigint` token counters. The offline CLI never sends a packet. Future HTTP handling must cap bytes before buffering and prevent raw-body logging before calling the decoder.

## Measurement laws

Token sums are disjoint. Quarter-hour consumption is completed tokens/900, not streaming model speed. Event-bearing minute counts are not active seconds. Union intervals per execution before a cross-device sweep; process ends before starts at equal timestamps. Peak agents is the maximum active execution count, not the sum of per-device peaks. Compute independent 15-minute (900,000ms) activity and 16-minute (960,000ms) concurrency windows. Agent work and API-request intervals are different series. Unknown account, origin, model and coverage remain unknown. A zero reasoning subdivision without measurement coverage is not proof of no reasoning; the local Claude adapter reports that subdivision unavailable.

The pure day rollup accepts separately established coverage; coverage is not inferred from packets or client flags. Coverage at midnight must exclude uncertainty reaching from adjacent days. For example, a prior-day interval ending 500ms before midnight with 1,000ms uncertainty invalidates the next day's first 500ms. The future ledger must compute that boundary before admitting coverage; the day-only function cannot discover neighboring records by itself.

## Privacy evidence and limits

Fixtures are synthetic. Content-value substitutions preserve measurement output; byte cursors may differ if string length changes. Skip content values rather than storing transcript representations. Malformed/deep/oversized input must fail with bounded, non-reflecting errors. The numeric wire cannot prevent deliberate steganography, prove human authorship or authenticate counters. Neither this crate nor separate process names establish OS-enforced isolation.
