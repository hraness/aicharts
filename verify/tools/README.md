# Reproducible formal tools

From the repository root, install frozen Bun dependencies and provision the
formal tools:

```sh
bun install --frozen-lockfile
bun scripts/assurance-tools.ts
```

The supported hosts are macOS arm64 and Linux x64. Provisioning requires Bun,
Python 3.12 or later with `tarfile.data_filter`, curl, Git, zstd and rustup on
`PATH`. CI uses Ubuntu 24.04. The installer uses official release archives and
dated Rust manifests from `manifest.json`; their SHA-256 digests must match
before extraction or use. Downloads, archive expansion, subprocess duration and
output are bounded. Archives with traversal, escaping links, special files or
duplicate entries refuse installation.

Tools, archive caches, the two Rust toolchains and Mathlib caches stay under
`target/assurance-tools`. Rustup receives a task-local `RUSTUP_HOME` and
`CARGO_HOME`; it does not change the user's default toolchain or shell settings.
Installed Rust component versions and artifact digests must match the exact
dated manifest. Kani's `toolchain` symlink must point to that local installation.
The proof runners separately check executable hashes from their own tool pins.

The Aeneas release supplies the backend and its dependency lock. Provisioning
fetches the exact nine Git commits recorded in that lock, verifies clean source
checkouts, and uses the pinned Lake executable's supported cache and build
commands. The backend lock must remain byte-for-byte unchanged. Moving branches
in upstream package metadata are never resolved by this installer. Cached Lean
objects, the release's backend objects, installed runtime libraries and the host
remain part of the trusted tool environment; archive and executable hashes are
not a proof of the whole operating system.

Inspect an existing installation without network access:

```sh
bun scripts/assurance-tools.ts --verify --offline
```

`--offline` can also extract already cached archives, but it refuses missing
Rust toolchains, package checkouts or compiled Lean dependencies. The installer
never overwrites an existing installation to repair drift: it refuses and names
the mismatched input. Review the exact failed artifact before replacing it.

Each attempt retains a provisioning receipt and bounded command logs under
`target/assurance/tools/run-*`. A successful receipt establishes tool preparation.
Run the separate required proof gates to obtain model and production evidence:

```sh
bun run usage:formal:tla
bun run usage:formal:kani
bun run usage:formal:theorems
```

CI's required Formal verification job runs these gates and uploads receipts and
diagnostics even after failure. Check and Menubar remain independently required.
Linux artifacts are pinned, but the first Linux execution remains a separate
qualification: unexpected unreachable Kani checks fail until their exact
locations, source hashes and justification have been independently reviewed.
The macOS allowlist is not inherited by Linux.
