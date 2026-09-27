# Production kernels and finite-history laws

`bun run usage:formal:theorems` freshly extracts selected production Rust into
Lean, checks the maintained proofs, and then runs the isolated negative
controls listed in `mutations.json`: four production mutations of the extracted
Rust bodies and one mutation of the separate mathematical laws. It never imports
a checked-in handwritten replacement for the Rust functions.

The production roots are `checked_add_bounded`, `checked_replace`,
`price_microusd` and `merge_owner`. Extraction includes their actual dependencies
and loop bodies: eight generated functions, with no opaque local functions.
`ProductionKernels.proofs.lean` and `Pricing.proofs.lean` contain proofs only.
The runner appends both to the fresh generated definitions and checks the exact
twenty-six declarations and their axiom lists. The array-equality helper connects
the translated standard library model to equality of the full sixteen-byte
owner identifiers.

The pricing proof quantifies all five u128 token counts and all five optional
u128 rates. An independent natural-number fold describes zero-token skips,
missing used rates, product and accumulation overflow, the single per-record
half-up operation and the 24-digit admission limit. The proof establishes loop
termination and exact success or the first refusal. A second theorem expresses
success as the exact dot product and rounding formula, together with the rate
availability and overflow conditions. An unused missing rate remains unknown
and does not prevent pricing.

Three unit-rate witnesses cover the maximum admitted result, offset overflow
and the first result beyond the profile limit. A five-bucket witness uses five
distinct non-unit rates and returns exactly 55 micro-USD. Four production mutants
must fail their named unchanged proofs: wrapping addition, owner replacement,
the wrong half-up offset and erasing non-unit rate products. A fifth control
mutates the `UsageLaws` bounded-fold specification so that a law-file edit
which silently weakens a theorem is also caught. The runner derives every
negative control from the manifest; an unlisted or unmatched mutation refuses.

`UsageLaws.lean` is a separate mathematical specification. Its nine theorems
cover evidence counts, known zero versus missing, append aggregation,
correction conservation, the reasoning subset, and exact bounded folding over
arbitrary finite histories. They do not establish refinement of Rust, SQL,
provider observations or the occurrence-revision operation. Population identity
and source completeness remain caller obligations.

The admitted Lean axioms are `propext`, `Quot.sound` and, for the translated
library proofs, `Classical.choice`. A new axiom, admission, warning, missing
theorem, incomplete process or zero obligations refuses the gate. Each negative
control must reach Lean and fail inside its named unchanged theorem; extraction
failure, timeout and an unrelated diagnostic cannot count as success.

The toolchain is pinned in `toolchain.json`: Aeneas commit
`12a018bb0fab3333be572dadc0eab5108758552b`, its bundled Charon, Rust
`nightly-2026-09-17`, and Lean 4.31.0. The Aeneas backend's dependency lock pins
Mathlib and its transitive packages. Install tools only from the recorded
official release artifacts after checking their SHA-256 digests. Follow the
[tool provisioning procedure](../tools/README.md) to prepare the task-local
directories and exact backend dependencies. The proof runner performs no network
installation.

Each run stages unchanged kernel source bytes in a dependency-free workspace
that preserves the real inherited package values. Receipts retain the original
and staged manifests/lockfiles, source and generated-definition hashes, observed
tool versions and executable hashes, commands, elapsed times, exact theorem
inventory, axiom lists, and mutation outcomes. Source or tool changes during
execution invalidate the receipt. These measurements do not attest every
dynamically loaded library or the host itself. Rust/Charon/Aeneas translation,
standard-library models and the Lean kernel remain trusted boundaries.

## Route decision and current limits

The bounded macOS pilot compared the same production checked arithmetic,
replacement and owner-selection bodies. Aeneas produced four translated
functions and five accepted proof obligations. Verus verified six obligations,
also covering the inclusive-output constructor and disjoint projection, using
the proof-only body snapshot in `pilot/ProductionBodies.verus.rs`. That snapshot
is historical comparison evidence, not a second maintained implementation.

Aeneas is the main theorem route because its maintained fresh extraction
connects proofs to the production definitions without manually copying their
bodies. The first maintained positive run took 1.317 seconds for extraction,
0.536 seconds for translation and 16.234 seconds for Lean checking on this host;
the separate list laws took 0.643 seconds. These are observed pilot timings,
not a performance service level. The Verus pilot reported six verified and
zero errors. Linux execution is recorded: the required Formal verification job
of PR #422 (GitHub Actions run 36055796464, ubuntu-24.04) passed
`usage:formal:theorems`, and `toolchain.json` names that run as the Linux
qualification; each receipt records its own platform and is the only evidence
for that run. The Verus snapshot in `pilot/verus.json` is a historical record
with no runner, gate or CI job.

The tool comparison also found real limits. Whole-crate extraction initially
rejected an early return in `TokenPartition::to_wire`; selecting inherent
methods directly was unsupported by the pinned Charon. Pricing's iterator
`zip` and range iteration exposed unsupported standard-library models. The
bounded five-bucket pricing loop now uses explicit indexing after a 27,622-case
differential check preserved its arithmetic, zero skips and error order.
Pricing extraction and the general five-bucket proof now pass the maintained
macOS gate. The full-u128 unit-rate Kani query hit its bounded solver deadlines;
it transferred to the required Lean proof only after that proof, its witnesses
and the offset mutation passed. `verify/kani/harnesses.json` records the explicit
replacement, and the Kani gate refuses unless a theorem receipt for the same
kernel bytes admits that replacement; the twenty Kani harnesses retain all
fifty-three required covers.

General arbitrary-rate pricing is covered by the extracted arithmetic proof.
Arbitrary-denominator rounding, decimal tariff parsing, tariff validity and
caller population selection remain separate obligations. The pricing proof
does not establish that provider observations or prices are true. Persistence,
concurrency, privacy and whole-system correctness require their own evidence.

Official tool references: [Aeneas](https://github.com/AeneasVerif/aeneas),
[Lean](https://lean-lang.org/doc/reference/latest/), and
[Verus](https://github.com/verus-lang/verus).
