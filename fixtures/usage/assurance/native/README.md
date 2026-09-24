# Native assurance counterexamples

These synthetic fixtures preserve F01, F05–F08 from the audit of commit
`a5bec6415ce640a61495db57bc9c2ce83fb83021`. The replay was built at
`696400da880d78e9a8b5ffd2b4265ea93c4948ce`; only release-radar data changed
between those commits. The corpus contains no real usage, identifiers or
credentials. The fixture key is 32 public bytes of ASCII `Q`.

Run the data and receipt checks from any checkout location:

```sh
python3 scripts/assurance-native-baseline.py
```

This default reads checked fixtures and subject hashes. It does not execute a
binary, compile Rust, access a provider, or create product state. A changed
current source is reported as drift; the retained baseline receipt must still
match the manifest. Hashes cover the named subject files and root Cargo inputs,
not every build input or an attestation of a supplied executable.

To replay all five findings, explicitly supply a trusted local CLI, compiler and
existing matching dependency directory. Build through the applicable repository
and host procedures first; the runner never builds Cargo dependencies or fetches
anything. For the retained audit target, the command is:

```sh
python3 scripts/assurance-native-baseline.py \
  --cli target/assurance-baseline/aicharts \
  --subject-root target/assurance-baseline/source \
  --cursor-rustc "$(command -v rustc)" \
  --rust-deps target/trusted-path-audit/debug/deps \
  --expect baseline
```

The ignored `target/assurance-baseline/` directory retains the CLI, ten critical
source snapshots and a receipt with their hashes. These snapshots are not a
complete standalone workspace. `baseline-receipt.json` is the checked evidence
from the audit replay; it contains relative artifact names and normalized
observations. Compiled artifacts are local evidence, not committed binaries.
If that target is absent, build the baseline commit in an isolated checkout,
then supply its CLI and source root. Preserve a new source/build receipt.

Each execution creates an owner-only disposable directory. It supplies every
source, key and state path explicitly, omits ambient home/credential/proxy
variables, and deletes the directory on completion. No enrollment, refresh,
upload, install or update command is invoked. The oversized source is a sparse
256 MiB + 1 byte file with a valid Claude prefix; its small-source control must
measure 15 tokens before the size-bound case can qualify.

Execution requires POSIX with ordinary child ownership. Combined subprocess
output is capped while streaming, and deadline/output refusals kill the fresh
owned process group before reaping its leader. F06 rejects every size other
than its exact frozen integer before creating files.

| Finding | Baseline observation | Exact repair target |
| --- | --- | --- |
| F01 | Two distinct known Claude owners commit; descending source-ID arrival makes reopen fail. Ascending arrival reopens. | Reject the second owner with `ledger_measurement_conflict` in both orders; retain revision 1, one source/association and 15 tokens, then reopen successfully. |
| F05 | Identical Codex bytes yield 13 tokens with recent mtime and zero with old mtime. | Both scans retain the same one-record, 13-token population. |
| F06 | An oversized selected source exits 0 with zero sources, zero skipped and no size diagnostic. | Refuse with `source_byte_limit`; retain a reopenable empty ledger. |
| F07 | Fetching Monday 15:00 onward deletes cached Monday 09:00 while replacing the whole represented day. | Retain all three original timestamps through the composed range and merge behavior. |
| F08 | `devin_totals_mismatch` appears in ephemeral measurement but disappears during collect/reopen. | Preserve the exact warning set and 13 tokens through both boundaries. |

F01 sorts the synthetic source HMACs at runtime, so random temporary paths do
not affect the tested order. Its repair policy permits unknown-to-known
enrichment; distinct known owners need rejection unless a separate, explicitly
authorized and versioned migration establishes reassignment. This corpus tests
the known-owner conflict; general enrichment, permutation, wave and migration
laws remain Phase 1A obligations. Existing damaged ledgers must be preserved;
this runner never repairs or resets them.

F07 compiles unchanged `integer`, `cents`, `text`, `day`, `project`,
`latest_event_ms`, `merge`, constants and the range-start expression extracted
from the selected source root. The checked Rust wrapper simulates a provider
returning all synthetic events in the requested interval. Evidence includes
the extracted-source and linked-library hashes. This tests the local functions
and range composition; it does not exercise authenticated acquisition, paging,
credentials or actual provider completeness. The extraction fails if the seam
changes; review and update it with the production refactor instead of keeping
a stale implementation copy.

`autosubmit-descendant-trace.json` preserves F14 as a source trace only. It is
not executed, and no descendant-settlement claim has passed native qualification.

Use `--cases F01,F05,F06,F08` for native CLI cases without the Cursor compiler.
Use `--cases F07` with the compiler and dependency options for Cursor alone.
After repairs, point at the current source/build and use `--expect repaired`.
The exact predicates live in `manifest.json`; changing a diagnostic or repair
policy requires a deliberate reviewed expectation change.

| Exit | Meaning |
| --- | --- |
| 0 | Default corpus validation, or every selected result matches `--expect`. With `baseline`, this means the defects reproduced. |
| 1 | Unexpected behavior or harness error; it is never counted as a repair. |
| 2 | Invalid command-line arguments. |
| 3 | Results match known baseline or repaired behavior, but at least one differs from `--expect`. This includes mixed progress. |

The JSON receipt retains per-finding classifications. A green baseline replay
is counterexample evidence, not an assurance claim that the product is correct.

Run the small harness checks with:

```sh
python3 -B -m unittest discover -s fixtures/usage/assurance/native -p 'test_*.py'
```
