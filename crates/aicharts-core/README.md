# Local metadata readers

`parse_reader(reader, provider, &namespace_key)` imports an explicitly supplied Codex or Claude Code JSONL stream. `merge_collections` merges copied files and supported Claude streaming revisions before totals are computed. Both return fixed errors; neither opens files, discovers providers, reads credentials, stores data nor sends network requests.

The caller supplies a private 32-byte key. HMAC-SHA256 produces scoped 16-byte event and execution IDs from native metadata. The key is never included in a collection. Use the same key when merging copies of a source; namespace rotation needs a separate migration design. Opaque IDs remain pseudonymous personal data.

## Supported measurements

- Codex `session_meta` and `event_msg/token_count` records with RFC 3339 timestamps and `total_token_usage`. Input includes cached input; the reader subtracts that subset. Reasoning is an output subset and is never summed twice. An initial `last_token_usage` is retained only when it fits within the first cumulative snapshot; preceding unobserved history is explicitly omitted. Without that initial last-usage snapshot, the first total establishes a baseline and contributes no usage. Later unchanged cumulative snapshots contribute nothing.
- A decrease in any Codex cumulative counter stops the remaining chain with a coverage warning. The reader does not guess whether a decrease is compaction, reset, stale data or a new session. Declared fork histories are excluded, including records read before a late fork declaration. Missing lineage cannot establish that an undeclared session is not replayed history. IDs use native session identity and the normalized timestamp; optional turn/event metadata does not change identity. Conflicting same-time events fail rather than receive fabricated line-number identities.
- Claude Code assistant records with `requestId`, `message.id`, numeric `message.usage` and RFC 3339 timestamps. Matching request/message IDs represent streaming revisions. Componentwise-monotonic revisions keep one final usage, even when input order is reversed or files are copied. Incomparable revisions fail; the reader does not synthesize per-field maxima from conflicting snapshots. The latest observed revision timestamp determines the completion bucket.
- Claude input, cache reads and cache creation are separate quantities. Cache creation requires the explicit `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` split whenever its aggregate is positive. Legacy records without a split are omitted with `claude_cache_ttl_unknown`; a TTL is not guessed. This may omit substantial historical Claude coverage until a reviewed unknown-TTL protocol category exists.
- Claude main execution IDs use `sessionId`; sidechain IDs require both `sessionId` and `agentId`. Usage with missing execution metadata can still be retained under its request/message ID, with unknown execution. Different execution attribution for one occurrence is a conflict, not an additional request.

All records have imported evidence, unknown model and auth mode, and an unassigned account. The parser makes no pricing or subscription claims. Historical prompt authorship and precise activity intervals remain unmeasured. No text inspection attempts to distinguish humans, automation, tool results or injected messages. Empty prompt/interval arrays mean unavailable coverage, not a claim of zero prompts or activity.

Claude usage does not report a separate reasoning-token subdivision in this projection. Its `reasoning_output` is zero with an `unmeasured_reasoning` coverage warning; this is not proof of zero thinking tokens. The total output counter remains intact. Any future admission or reporting route must preserve this coverage distinction.

Collections contain canonical, per-UTC-day batches, split at 4,096 records. More than 100,000 physical lines or 100,000 distinct measurements fail. One line is capped at 1 MiB and JSON nesting at 64. Larger valid histories must be supported by a later checkpointed parser that preserves cumulative state; splitting a Codex source arbitrarily changes baseline coverage and is not a supported workaround.

## Privacy boundary

The reader streams from the caller's `BufRead` view of one line instead of copying complete transcript lines. Its deserialized structs contain only numeric counters, bounded native IDs, timestamps and closed record kinds. Serde skips unknown values, including message content, title, model name, path and tool arguments. Native IDs and timestamps exist briefly during normalization; only keyed IDs and normalized numeric timestamps reach the collection.

The process must still read source bytes to find metadata and skip values. Rust, these types and the numeric wire are not an OS-enforced sandbox or a proof of non-exfiltration. A malicious uploader can encode data into numbers. This crate establishes the honest implementation's content-minimization boundary; OS isolation and authenticated admission are separate work.

Synthetic tests change non-allowlisted text while comparing encoded packet bytes, exercise escaped strings and nesting, and assert non-reflecting failures. They do not establish compatibility with every installed client version or prove live provider totals. This first implementation has not been tested on private user logs.

## Source reference

Schema field names were checked against the public Tokscale parsers at commit [`d9a45a65ddfaf21bea2fe9de692aca89f46e67bf`](https://github.com/junhoyeo/tokscale/tree/d9a45a65ddfaf21bea2fe9de692aca89f46e67bf/crates/tokscale-core/src/sessions) on September 10, 2026. This is an independently written, narrower implementation with synthetic fixtures; it does not copy Tokscale's code or retain its content-derived identities, path fallback, token estimation or clamping behavior. These JSONL layouts are versioned client internals, not a stable provider billing API.
