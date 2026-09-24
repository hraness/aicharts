# Production metric kernels

The harnesses in `crates/aicharts-metrics/src/proofs.rs` call the production
functions. They do not replace arithmetic or ownership with verification stubs.
Kani checks the stated finite scalar and container domains; the theorem lane
owns the separate unbounded finite-history argument.

The required Kani inventory contains seventeen harnesses and forty-four covers.
The full-u128 unit-rate pricing obligation is discharged by the separate required
Lean route against freshly extracted production code. That theorem quantifies
every u128 token count, proves termination, and includes constructive success,
offset-overflow, and profile-limit witnesses. A production half-up-offset mutant
must fail the unchanged terminal pricing theorem. The obligation transfer is
recorded in `harnesses.json`; it does not lower a production scalar bound or
disable a safety check.

The retired Kani pricing harness hit the solver deadline under CaDiCaL, Z3,
Kissat, quotient/remainder parameterization, interval characterization, and
path-wise execution. Those bounded timeouts provide no proof evidence. The
replacement Lean route passed its maintained proof and mutation gate before the
Kani inventory changed. The maintained Lean route also proves general pricing
for all five arbitrary u128 token amounts and optional u128 rates, with exact
first refusal, termination and the once-rounded success formula. Its additional
non-unit multiplication mutant must fail the unchanged general body theorem.

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
| Exact rational construction | Full u128 numerator and denominator; denominator zero refuses. General rounding has ordinary reference/boundary tests; this construction harness does not qualify arbitrary-denominator rounding. |
| Pricing | Kani checks five full u128 token amounts with all rates absent. The required Lean route proves exact five-bucket pricing for arbitrary u128 tokens and optional u128 rates, including zero skips, the first refusal and per-record half-up. Tariff parsing and source validity remain external. |
| Evidence and matching | Full u128 reported total/count/value; full sixteen-byte population IDs and u16 unit/grain; unknown/unsupported differ from known zero. Population authenticity and enumeration completeness are external evidence. |
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

`mutations.json` defines two changes to production function bodies. In isolated
copies, each must fail its named unchanged assertion. The mutation runner must
reject a stale source match, the wrong failure, a timeout, an unsupported
construct or an infrastructure error; a nonzero exit alone is insufficient.

The harnesses avoid `Result::unwrap()` in successful branches. On the pinned
macOS Kani toolchain it pulled unsupported panic-formatting code into
goto-instrument's sanity pass. Explicit result assertions preserve the same
obligation without disabling a check or changing the production function.

Unreachable assertions inside the standard library or `kani_core` are admitted
only from a platform-specific reviewed list in `toolchain.json`, bound to the
SHA-256 of the exact bundled rlib that contains them. macOS and Linux keep
separate lists; neither inherits the other's exceptions. The Linux list was
reviewed from the first ubuntu-24.04 CI execution receipt and contains the same
thirteen entries as macOS (panic formatting in `core::fmt` and pointer-offset
arithmetic in `kani_core`), each bound to the Linux bundle's own rlib.
