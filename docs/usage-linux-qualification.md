# Linux CLI qualification report

`scripts/release/linux-qualification.mjs` validates the bounded report emitted by a future nonpublishing Linux runner. The contract is intentionally narrower than a release: it records one measured `x86_64-unknown-linux-gnu` build on Ubuntu 22.04, the exact source/toolchain identities, native dynamic dependencies, source-free smoke status and complete notice bytes. It does not build or execute a binary, authenticate a GitHub run, sign an artifact, publish a release, or enable the CLI.

The validator accepts only schema `1`, profile `linux-cli-v1`, Rust `1.97.1`, Node 24, the fixed target, and a bounded sorted SONAME list. Reports must be canonical JSON with one final LF. `validateLinuxQualificationReport` re-encodes the normalized facts and refuses byte changes, unsupported profiles, incomplete smoke/notices, invalid identities and oversized input. It returns an owned byte copy and digest; callers must still bind those facts to the exact executable and source bytes before assembly.

Run the focused contract with:

```text
bun run release:linux:qualification:check
```

This is source-level admission evidence only. A later runner must separately prove the actual compiler/linker invocation, ELF/runtime checks, smoke fixtures, notice mapping and exact release assembly, then preserve the report as private qualification evidence. A passing report alone never enables authentication, enrollment, uploads, background collection, native custody or updates.
