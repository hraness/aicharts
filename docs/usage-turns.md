# Daily turn measurements

The local daily rollup can calculate average elapsed runtime, accounted tokens, and tool calls for explicitly identified completed root turns. Each average has its own measured-turn count. The current Codex and Claude historical collectors do not produce these observations yet, so their real-data turn averages remain unavailable. This contract does not enable uploads or change [wire v1](usage-wire-v1.md).

## What a turn measures

A root turn is one provider-defined turn of the primary agent, not an entire session, assistant message, API request, or child-agent turn. Structured evidence must establish its identity, root status, and terminal outcome. A file ending, a quiet period, or a record with the `user` role does not establish completion or human authorship.

| Daily metric | Measurement | Eligible completed turns |
| --- | --- | --- |
| Average elapsed runtime | Terminal timestamp minus start timestamp, including waits | Both boundaries known, ordered, and without clock uncertainty |
| Average accounted tokens | Uncached input, cache read, cache write by lifetime, and output | Complete direct-turn attribution for all five disjoint categories |
| Average tool calls | Distinct dispatched invocations, including failed calls | Complete direct-turn dispatch evidence |

Reasoning tokens are already part of output. They are not added again, and the projection makes no claim about their separate coverage. Tool results and repeated records do not add calls. A retried dispatch with a new invocation identity is another call; a repeated observation of the same invocation is not. Evidence of a requested call alone is insufficient to label it dispatched.

The initial scope is `root_direct`: child tokens and calls do not contribute to the parent mean. Root elapsed runtime never adds child durations. An inclusive descendant measurement would need its own explicit ownership and completeness contract.

## Day and cohort

Attribute the complete turn to the UTC day containing its terminal timestamp. A turn crossing midnight contributes one denominator and its full elapsed runtime on that day. These turn-attributed token sums can differ from the existing token-event-day totals. Civil-time rebucketing is not implemented here.

Completed roots form the default cohort, across all observed origins. Callers can select confirmed human, confirmed automation, or unknown origin. Unknown origin never becomes human. Aborted roots have a separate observed count and are excluded from completed averages. Open or incomplete runs have no terminal observation; their absence does not prove that all turns have been observed.

A known zero-token or zero-call turn contributes a zero numerator and one measured turn. Unknown contributes neither. Runtime may legitimately be zero at the source's timestamp resolution.

## Exact averages and coverage

`lib/usage/turns.ts` exports `rollupTurnDay(utcDay, input?)`. It works without usage packets, including on a turn-only or empty day. `rollupUsageDay` accepts the same optional input as its fourth argument and includes the result in its daily `turns` field. Hourly, activity, and concurrency calculations remain unchanged.

Each metric returns `sum` as a `bigint`, `measuredTurns`, and `unmeasuredTurns`. `observedAverage` is an exact `{ numerator, denominatorTurns }` pair, or `null` when no eligible turns exist. Never average device or day averages: add disjoint sums and eligible counts, then divide for display.

`average` describes the complete selected population only when independent terminal enumeration is complete, no observed completed turn has ambiguous membership, and every selected completed turn has that measurement. Otherwise it is `null`, even when an observed average exists. Enumeration completeness must cover the exact selected provider/account scope and cannot be inferred from record presence, an imported/live flag, or existing token/activity coverage.

Omitting input returns `available: false`. Supplying an empty observed set returns `available: true` but does not prove a zero-turn day unless enumeration is independently complete. Even a proven zero-turn day has a `null` average, not zero or an undefined division.

## Numeric input boundary

The input has exactly `observations`, `terminalCoverageComplete`, and `originFilter`. Origin filters are 0 all, 1 human, 2 automation, and 3 unknown. Each observation contains exactly:

- `id`, `executionId`, and `accountId`: fixed 16-byte keyed identities. Turn and execution IDs are nonzero; account zero means unassigned. Native IDs, paths, and device names are not accepted.
- `provider`: 1 Codex or 2 Claude Code. `origin`: 0 unknown, 1 human, or 2 automation.
- `lineage`: 0 unknown, 1 root, or 2 subagent. `outcome`: 1 completed or 2 aborted.
- `endedAtMs` and nullable `startedAtMs`: safe nonnegative epoch milliseconds. Terminal time must fall in the requested UTC day. Elapsed time is capped at 31 days.
- Nullable `clockUncertaintyMs`: zero is required for runtime eligibility; values up to 60,000 ms are retained as uncertain. An absent start requires absent uncertainty.
- Nullable `tokens`: exactly the five disjoint `bigint` categories, each at most 10^12. Codex cache-write categories remain zero. All-zero tokens are valid when completely measured.
- Nullable `toolCalls`: an integer from zero to 1,000,000.

These are local projection limits, not evidence of genuine provider usage or a fraud score. The boundary rejects unknown fields, accessors, unsupported enums, shared identity buffers, malformed counters, and more than 65,536 raw observations before deduplication. Errors are fixed codes with no submitted values. It admits no prompts, tool names, arguments, results, titles, or free-form metadata. This in-process API is not a sandbox for hostile JavaScript or a persisted binary protocol.

## Corrections and validation

Pass one resolved current-head snapshot. Exact repeated turn identities are inert; changed observations with the same identity fail with `conflicting_turn`. Conflicting execution identity also fails. A caller must resolve authorized corrections and deletions before aggregation; this function does not choose the newest or largest value. A correction can decrease a sum, remove a measured denominator, change the outcome, or move the entire contribution between terminal days.

Run `bun test lib/usage/turns.test.ts lib/usage/rollups.test.ts` for synthetic examples and independent property checks. They cover weighted means, unknown versus zero, duplicate and permutation invariance, partitioned sums, corrections by recomputation, midnight, child exclusion, origin ambiguity, token bounds, large exact sums, and non-reflecting input failures. Passing these tests does not qualify a provider adapter, live service, or public dashboard.
