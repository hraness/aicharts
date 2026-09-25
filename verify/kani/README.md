# Production metric kernels

The harnesses in `crates/aicharts-metrics/src/proofs.rs` call the production
functions. They do not replace arithmetic or ownership with verification stubs.
Kani checks the stated finite scalar and container domains; the theorem lane
owns the separate unbounded finite-history argument.

The required Kani inventory contains twenty harnesses and fifty-three covers.
`harnesses.json` names the production functions each harness exercises, and
`scripts/assurance-kani.test.ts` requires every `pub fn` in the crate (outside
`proofs.rs` and `tests.rs`) to be named by a harness or by a theorem
replacement, so a new kernel function cannot ship without a proof obligation.
The full-u128 unit-rate pricing obligation is discharged by the separate required
Lean route against freshly extracted production code. That theorem quantifies
every u128 token count, proves termination, and includes constructive success,
offset-overflow, and profile-limit witnesses. A production half-up-offset mutant
must fail the unchanged terminal pricing theorem. The obligation transfer is
recorded in `harnesses.json`; it does not lower a production scalar bound or
disable a safety check. The Kani gate binds each replacement to a theorem
receipt under `target/assurance/theorems/` whose recorded kernel hashes equal
the exact bytes being verified, whose theorem, witnesses and required negative
control all passed, and refuses with the reason for every candidate receipt
when none binds; the theorem gate therefore runs before the Kani gate.

The retired Kani pricing harness hit the solver deadline under CaDiCaL, Z3,
Kissat, quotient/remainder parameterization, interval characterization, and
path-wise execution. Those bounded timeouts provide no proof evidence. The
replacement Lean route passed its maintained proof and mutation gate before the
Kani inventory changed. The maintained Lean route also proves general pricing
for all five arbitrary u128 token amounts and optional u128 rates, with exact
first refusal, termination and the once-rounded success formula. Its additional
non-unit multiplication mutant must fail the unchanged general body theorem.

The production stage runs every harness under a 300-second CBMC budget, which
the bounded rounded-ratio harness needs (about 100 CPU seconds on the pinned
macOS toolchain); every mutant runs under the original 90-second harness budget
and a 180-second process cap. `toolchain.json` pins both budgets.

Prepare the [pinned tools](../tools/README.md), then run the required Kani
0.68.0 / CBMC 6.11.0 gate with all default checks:

```sh
bun run usage:formal:kani
```

The integrator's required runner records source, manifest, lockfile and tool
hashes and validates the complete JSON result. It invokes the official task-local
`kani-driver kani` directly, using its exact dated Rust toolchain. A timeout, compiler/instrumenter
failure, missing harness, unknown result, failed default check or unsatisfied
cover is not a proof pass. Every listed harness must execute and its covers must
be satisfied. Unreachable rejection assertions are expected only when an earlier
validated invariant makes their branch impossible; they cannot replace a
reachable positive/rejection cover.

`harnesses.json` is the maintained exact harness set, including quantified
domains and the required cover descriptions and counts. Adding or removing a
proof obligation requires reviewing this manifest with its source change.

Do not use `--output-format old` as evidence with the pinned installation. A
90-second diagnostic timed out inside CBMC but that mode returned exit zero and
reported one successful harness without a completed CBMC result. The required
structured JSON, including every check and cover, is the admission boundary;
an exit code or printed harness summary alone is insufficient.

| Kernel evidence | Quantified domain and boundary |
| --- | --- |
| Checked addition and bounded addition | All pairs of u128, with a separate 129-bit oracle built from 64-bit limbs. The bound is also arbitrary u128. |
| Decimal admission and replacement | Full u128 values; existing 24-digit profile limit; underflow and overflow refuse. Prior-contribution membership remains a caller obligation. |
| Six-bucket sum | Six arbitrary u64 values accumulated in u128, compared with an independent wider-integer expression. General u128 folding composes checked addition; this finite harness is not an arbitrary-length proof. |
| Wire total | Six arbitrary u64 counters; production 10^12 per-counter bound, reasoning subset validation, and exact sum of the five disjoint categories. |
| Output and cache partitions | Full u128 quantities; unknown reasoning stays unknown, known subsets must fit inclusive output, and known TTL parts must equal the retained write total. |
| Profile conversions | All six u64 wire values and five u128 detailed values, with unchanged production admission limits; explicit refusal when conversion would invent evidence. |
| Owner and dominance predicates | Two full sixteen-byte IDs plus enrichment policy; six full u64 component pairs. Context identity is checked by the caller before owner merge. No associative occurrence-merge claim. |
| Exact rational construction | Full u128 numerator and denominator; denominator zero refuses. |
| Rounded ratio | Bounded: every exact u8 quotient, nonzero u8 denominator and u8 remainder below it, reconstructed into the numerator so the reference needs no division, with one symbolic rounding rule per execution. Floor, ceiling and the exact half-up law (`2r >= d`) are checked against the production u128 division. Wider u16/u8 and u32/u16 operand domains exceeded a 900-second CaDiCaL budget without a counterexample, and a timeout is not evidence, so production-width rounding is not qualified by this harness; the pinned Charon cannot select the inherent method for the Lean route without a production wrapper. |
| Evidence merge and disjoint output | Two full `EvidenceTotals` (sixteen arbitrary u128 components): every component is added exactly, any overflow refuses the whole merge, and the merge is symmetric. `InclusiveOutput::from_disjoint` takes arbitrary u128 visible and reasoning quantities; the total is their exact sum or an overflow refusal and the disjoint split round-trips through the inclusive constructor. |
| Pricing | Kani checks five full u128 token amounts with all rates absent. The required Lean route proves exact five-bucket pricing for arbitrary u128 tokens and optional u128 rates, including zero skips, the first refusal and per-record half-up. Tariff parsing and source validity remain external. |
| Evidence and matching | Full u128 value against eight arbitrary u128 prior totals and counts with a symbolic basis (reported, derived or estimated); the observed basis component and count move, the other components and the unknown/unsupported counters do not, and unknown/unsupported observations differ from a known zero. Matching takes two full sixteen-byte population IDs, u16 unit/grain, two u128 values, symbolic bases and known flags; only equal populations with two known values match, and the pair retains both bases. Population authenticity and enumeration completeness are external evidence. |
| Addition association | Three arbitrary u128 values; both parenthesizations produce the same exact sum or overflow refusal. This does not change the separate nonassociative occurrence-revision operation. |

No harness assumes a smaller token or profile limit. Named fixed pricing rates
are explicit proof partitions, not changes to production admission. Provider
truth, source identity, population selection, Rust/Kani compilation and the
solver remain outside the mathematical facts established by these harnesses.

The Lean pricing specifications use natural-number arithmetic for products,
accumulation, the half-up offset, floor quotient, and profile admission. Charon/Aeneas translation and
built-in models, Lean's kernel, and the allowed logical axioms remain in its
trusted boundary; it does not independently verify generated machine division
instructions. The exact theorem, witness, tool, source and mutation inventories
are maintained by the required theorem runner.

`mutations.json` defines thirteen changes to production function bodies:
wrapping addition, owner replacement, the decimal limit, bounded-add slack,
replacement underflow, two wire-total guards, the cache TTL partition, dominance
conflicts, evidence counting, matching identity, zero-denominator admission and
zero-rate pricing. In isolated copies, each must fail its named unchanged
assertion, and each mutant process has a 180-second budget. The mutation runner
must reject a stale source match, the wrong failure, a timeout, an unsupported
construct or an infrastructure error; a nonzero exit alone is insufficient.

The harnesses avoid `Result::unwrap()` in successful branches. On the pinned
macOS Kani toolchain it pulled unsupported panic-formatting code into
goto-instrument's sanity pass. Explicit result assertions preserve the same
obligation without disabling a check or changing the production function.

Unreachable assertions inside the workspace are admitted only from the reviewed
list in `toolchain.json`, each bound to the SHA-256 of the exact source file
that contains it, so a harness or kernel edit must be re-reviewed before the
exception applies again. Unreachable assertions inside the standard library or
`kani_core` are admitted only from a platform-specific reviewed list in the
same file, bound to the SHA-256 of the exact bundled rlib that contains them.
macOS and Linux keep
separate lists; neither inherits the other's exceptions. The Linux list was
reviewed from the first ubuntu-24.04 CI execution receipt and contains the same
thirteen entries as macOS (panic formatting in `core::fmt` and pointer-offset
arithmetic in `kani_core`), each bound to the Linux bundle's own rlib.
