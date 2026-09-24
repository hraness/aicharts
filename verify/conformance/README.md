# Production conformance schedules

This directory specifies bounded, generated schedules through actual production
entry points. It supplies sampled implementation correspondence alongside the
separately checked finite TLA+ models. Neither artifact is an implementation
refinement proof. The baseline counterexamples under `verify/tla` remain intact.

`cases.json` fixes three seeds for each of thirteen trace groups, thirty Worker
tests, six browser-contract tests and one native test containing three seeds.
The native generator varies source order, quantities and retry counts. The
Worker generator varies execution order, accounts, device selection, quantities,
provider fault location, retry order and delay. The browser generator adds 24
commands selected from capture, account reply, old reply and signout. Production
capacities are unchanged; the schedule sizes are testing bounds only.

Each command runs a real RPC, public native storage API, or browser contract
function. An independent test state predicts the result and the resulting
abstraction. Every command checks that prediction before continuing. Setup
creates fresh synthetic bindings and valid enrollment; setup is not a generated
authentication proof. Object identifiers, provider object versions and opaque
capabilities come from the real runtime; generated quantities and expected
account, ownership, revision and terminal decisions come from the test model.

The adapters print one `ASSURANCE_CONFORMANCE ` line per completed seed. Its
JSON contains the group, seed, ordered commands and inputs, observed outcomes,
expected and actual abstract states, and action/outcome coverage. Snapshots are
copied when the transition is checked, so later oracle mutation cannot rewrite
earlier evidence. A failed assertion reports a stable `CONFORMANCE:` marker with
the seed and command. Replaying the retained seed runs the same commands; the
receipt retains the concrete resulting commands as well. There is no random
wall-clock seed, silent command skip, or success inferred from process exit alone.

## Runner interface

The integration-owned runner consumes `cases.json`, uses its exact commands and
requires every `(model, seed)` once. It validates 3–256 steps, listed coverage,
every recorded `expected`/`actual` pair, the test counts and a successful process
completion. Missing, duplicate, malformed, oversized or contradictory traces
fail. The native command needs `--nocapture` to retain successful traces.

Bind each receipt to the adapter, helper, case and mutation inventory, the
repaired TLA+ modules/configurations, the relevant production source, both
lockfiles, the Rust toolchain and the actual Worker/Bun/native runtime. Capture
source before and after execution; refuse drift. Retain stdout/stderr and parsed
traces in an ignored directory. Do not reuse a successful trace from a different
production tree. The Worker dispatcher already isolates provider credentials and
owns synthetic local bindings. Its runtime needs approved localhost access.

`mutations.json` defines an exact one-match change to the production drain guard.
Run it in an isolated copy with unchanged specifications and adapters. The
original source must pass first. The mutated run is evidence only if the named
test executes and reports `CONFORMANCE:M1:publish:outcome`; a compile failure,
missing test, timeout, runtime setup error or unrelated nonzero exit is a failed
experiment. Never leave the production worktree mutated.

## Evidence boundaries

The state abstractions intentionally omit secrets, private content, timestamps
irrelevant to the selected guard, and unrelated rows. They include exact numeric
facts, canonical revisions, source checkpoints, frozen/accepted generations,
terminal decisions, ownership, reserved charges and visibility where the
corresponding contract needs them. Production codecs decode stored native/wire
frames for the abstraction; codec correctness remains separately tested and
partly verified. The test model does not call production decision reducers.

The Worker schedules inject failures before a put, lost replies after an actual
immutable put, and a paused actual source reply followed by a newer withdrawal.
They evict/reopen real Durable Objects. Eviction is local process reconstruction,
not production point-in-time recovery. The Phase 1B regressions additionally run
real five-second canonical namespace and immutable-orphan timeout schedules and
lost acquisition/release replies at `AccountEnrollment`. Those remain required
runtime evidence for the M1 continuation contract; the generic fence adapter
alone cannot prove that a caller registers every continuation.

The seven models' exact action mapping, assumptions, conditional progress
obligations and later phase gaps are in
[`repaired-action-map.md`](../tla/repaired-action-map.md). This framework does not
qualify live providers, OAuth signatures, SQLite internals, filesystem durability,
all concurrent histories, or arbitrary account sizes.
