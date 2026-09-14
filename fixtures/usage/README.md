# Synthetic usage fixtures

`v1.hex` was assembled independently from the byte table in `docs/usage-wire-v1.md`, not exported from either codec. It is 240 bytes: one record from each family on UTC epoch day 20,000, registry revision 1.

- Usage: ID `01` repeated 16 times, execution `02` repeated, account `03` repeated; offset 1,234ms; Codex/subscription/imported; unknown model/context tier; token counters `[123,456,0,0,789,42]` in wire order. Disjoint total is 1,368; reasoning 42 is a subset.
- Prompt: ID `04` repeated, zero execution/account IDs; offset 1,000ms; Codex/unknown origin/imported.
- Interval: execution/account `02`/`03` repeated; `[1,000,2,000)`ms; Codex/agent work/live; clock uncertainty 5ms.

Both Rust and TypeScript must decode these values and encode the exact same bytes. No fixture is copied from a private session or credential.

## Session report fixture

`session-history-v1.json` is synthetic output from the native `sessions`
command with a 32-byte key filled with byte 9. The core projection test checks
its exact serialization, and the browser parser test checks its token totals
and unknown timing. No real session identifiers or content are included.
