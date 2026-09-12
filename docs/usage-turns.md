# Daily turn measurements

The generic local daily rollup can calculate average elapsed runtime, accounted tokens, and tool calls for explicitly identified completed root turns. Each average has its own measured-turn count. A separate `aicharts turns` command reports provider-measured Codex runtime and partial response-token/requested-call subtotals from explicit files. Its complete token/tool totals and population means remain unavailable. The ordinary historical collectors do not supply turn observations to the generic rollup. Neither path enables uploads or changes [wire v1](usage-wire-v1.md).

## Observed Codex runtime

Follow [the local command guide](usage-local.md#inspect-observed-daily-turn-runtime) to run `aicharts turns --codex FILE --occurrence-key-file KEY [--json]`. The Rust reader's `sourceProfile: 2` selects lifecycle, response-usage, and supported raw call metadata. It returns exact daily runtime sums and eligible counts alongside observed subtotals. It does not retain source text, expose native identities, infer human authorship, or persist its result.

This reader uses independently provider-reported elapsed milliseconds, not terminal-minus-start wall-clock time. Only explicit root starts with qualified timing and compatible terminal evidence make runtime eligible. Multiple distinct starts, missing or malformed start timing, or mismatching valid start coordinates leave runtime unavailable. Terminal epoch seconds determine the UTC day at one-second precision. Completed and aborted roots remain separate; completed includes provider terminal errors and is not task success.

Each completed and aborted cohort adds `observedSubtotals.responseTokens` with basis `observed_response_total`, and `observedSubtotals.requestedCalls` with basis `observed_requested_calls`. Each contains a decimal-string `sum`, numeric `observations` and `turnsWithEvidence`, `subtotalMean: null | { numerator: DECIMAL, denominator: COUNT }`, `coverage: "partial"`, and `populationMean: null`. The mean divides the sum of observed per-turn subtotals by distinct turns with evidence for that metric. Do not use a shared denominator, divide by response/call count, or average file means. A zero-token report contributes one measured turn; absent reports do not prove zero work. No call record is not evidence for zero calls.

Response subtotals use only top-level `token_usage_record.payload.usage.total_tokens`, once per keyed response ID. Its explicit thread, session, root, and turn must agree with the file and joined root lifecycle. The product cap is 10^12 tokens per report. Cumulative totals, `token_count`, nested compaction snapshots, and replacement histories are ignored. A qualifying top-level compaction response still contributes once. Codex records this usage on a best-effort basis: its producer omits the usage record when completion usage is absent, and its [synthetic four-response regression](https://github.com/openai/codex/blob/4d205c7a4dc36b719679a0356a45b23133732265/codex-rs/core/tests/suite/token_usage_rollout.rs) retains only three usage observations. A terminal or matching cumulative total cannot prove completeness.

Requested-call subtotals select raw `function_call`, `custom_tool_call`, `local_shell_call`, and `tool_search_call` by `call_id`, and `web_search_call` and `image_generation_call` by `id`. Each needs an explicit stamped turn. There is no positional owner inference or legacy ID fallback. Optional function/custom item IDs do not add calls. Outputs, typed terminal tool items, manual user-shell items, and nested Code Mode calls are excluded. A denied, failed, or interrupted raw request can still count as requested; it does not establish dispatch or success. The pinned [response variants and owner metadata](https://github.com/openai/codex/blob/4d205c7a4dc36b719679a0356a45b23133732265/codex-rs/protocol/src/models.rs) define this source basis.

Exact copies deduplicate before daily totals, while conflicting selected owners, kinds, or totals fail before ancestry filtering. Incomplete evidence with both an established file-thread identity and an observation ID stays retained for conflict checks; a later copy cannot silently replace missing evidence with a value. Usage/calls before a file header remain unowned and are not added to those maps. Missing ownership or totals produce fixed diagnostics. Late or cross-source fork/subagent declarations exclude the whole thread. Observations join the terminal's day; aborted work has a separate subtotal mean, and open/undated work has none. Multiple starts can leave runtime unavailable while explicitly owned subtotals still describe one logical turn.

Input omissions, historical starts without explicit root attribution, declared fork/subagent history, and missing measurements cannot establish a complete population. Complete `tokens` and dispatched `toolCalls` remain null. All subtotal population means remain null, and human origin remains unknown. The reader is feature-detected against pinned [Codex source evidence](../crates/aicharts-core/README.md#separate-codex-lifecycle-profile), not a promise about every installed version.

The combined ceiling is 65,536 raw lifecycle/usage/supported-call observations across all selected sources. `rawObservations` counts them before deduplication, including complete selected records with missing fields. Incomplete non-LF tails remain deferred and unclassified under the inherited byte/physical-record limits. Malformed or duplicate selected keys fail closed. Names, prompts, arguments, outputs, and other ignored content are not retained or used for identity, attribution, or metric values. Byte/line/depth bookkeeping and limit failures still depend on input shape; fixed errors never echo content.

### Container identity and refusals

The first valid session header fixes the file's canonical thread. A later header never changes which thread owns observations. Codex can give a descendant thread the same root-session ID as its parent; the reader accepts that distinction only with explicit ancestry and excludes the child from root measurements. A missing root-session ID remains unknown. Repeated explicit values for one metadata thread must agree, including canonical evidence merged across files.

Declared copied-history files are more limited. They may contain ancestor headers after the canonical inherited-history declaration only when there are no selected lifecycle, response-usage, or supported-call observations. Those ancestor headers cannot exclude an independent parent's file. For an observation-free file, `inherited_metadata_only` is added when it contains a foreign header, or its own canonical evidence combines a distinct shared root-session ID with inherited history. This diagnostic is not synthesized from flags first combined across files. These accepted metadata-only shapes also receive `unsupported_ancestry`; other ancestry exclusions can report `unsupported_ancestry` alone.

Mixed metadata with any selected observation refuses, even when the observation has missing IDs or precedes the later header. Shared-session inherited history also refuses selected observations when its ancestry is learned in another file. Selected malformed fields still fail their own checks before an ownership refusal. Existing equal-ID, single-header fork exclusions are unchanged; they are not proof of general copied-record ownership.

| Fixed error | Meaning |
| --- | --- |
| `turn_session_tree_mismatch` | A metadata thread differs from its explicit root session without supported exclusion evidence. |
| `turn_metadata_session_conflict` | Repeated explicit root-session values for one metadata thread disagree. |
| `turn_container_identity_ambiguous` | A foreign header appears without the canonical thread's prior inherited-history declaration. |
| `turn_inherited_observation_ownership` | A mixed-metadata or shared-session inherited shape contains selected observations whose ownership is unsupported. |

These replace the independent turn reader's `turn_session_identity_changed` error; the ordinary historical collector is unchanged. Preserve the source when a shape is refused. The command does not repair logs, skip a failed requested file, or return a partial summary. This compatibility change retains `sourceProfile: 2`, existing measured-root output, metric denominators, and all resource limits. Synthetic shape tests establish these rules, not compatibility with every installed provider release.

The following generic projection remains separate. It accepts its own exact numeric observations and calculates elapsed runtime from qualified boundary timestamps. No conversion currently fabricates those timestamps from provider durations, and no CLI output is automatically fed into it. Observed response totals and requested calls cannot populate its complete-token/dispatched-call fields. An eventual persistence/transport adapter must preserve the measurement basis, independent denominators, and partial-coverage distinction.

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
