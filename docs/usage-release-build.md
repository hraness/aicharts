# BUILD matching

`scripts/release/build.mjs` encodes and validates the exact `BUILD.json` body for the first CLI/skill release profile. It matches independently supplied facts and the external file inventory entirely in memory. It does not inspect an executable, authenticate provenance, read files, publish assets or install software.

## API and independent inputs

```text
encodeBuild(expectations) -> Result<Buffer>
validateBuild(bytes, expectations, expectedFile) -> Result<Build>
```

Results are `{ok:true,value}` or `{ok:false,error}`. Fixed errors are `invalid_expectations`, `invalid_build`, `invalid_inventory` and `limit_exceeded`; they contain no supplied values or exception details.

Expectations have exactly these fields:

```text
{
  kind, version, sourceCommit, sourceTree,
  toolchain: {rustChannel, cargoLockSha256, nodeMajor, cCompiler},
  runner: {label, imageVersion, runId, runAttempt},
  executableSha256
}
```

`kind` is `cli` or `skill`. CLI expectations require the actual selected Rust version, Cargo lock hash, compiler `{name,version}` and final executable hash. Skill expectations require null Rust, Cargo lock, compiler and executable fields. Both record Node major 24 as the packaging runtime; this is not the portable skill helper's minimum supported Node version.

Runner label is exactly `ubuntu-22.04`. Image version, run ID and attempt must come from the actual assembly run. The first profile requires CLI and skill to use the same measured assembly image/run/attempt. The caller must project those facts consistently from the independent release expectations; separate successful codec calls do not establish cross-artifact equality. Different assembly images require a reviewed profile extension.

Versions, lowercase hash lengths, runner-image components and run/attempt limits follow [the manifest scalar policy](usage-release-manifest.md#expectations). Syntactically valid zero-filled hashes are admitted; syntax alone cannot establish that a source object or executable exists. Schema version 1, repository `hraness/aicharts` and CLI target/OS/architecture derive from the fixed profile rather than caller overrides.

`expectedFile` is exactly `{path:"BUILD.json",mode:420,bytes,sha256}`. Its size is a positive integer at most 16,384 and its SHA-256 is independently established from the admitted archive member. Validation checks that inventory before exact body equality. Never derive all expectations from an untrusted BUILD or manifest and treat internal agreement as authenticity.

## Canonical body and ownership

The body has exactly these ordered keys:

```text
schemaVersion,kind,repository,version,sourceCommit,sourceTree,
target,os,arch,toolchain,runner,executableSha256
```

CLI target/OS/architecture are `x86_64-unknown-linux-gnu`, `linux` and `x86_64`; skill uses null for all three. Bytes are compact canonical JSON plus one final LF, capped at 16 KiB. The validator compares a fresh owned encoding of the expectations with the whole supplied body. It does not parse untrusted JSON. Extra/duplicate/missing keys, different order or whitespace, alternate scalar encodings, invalid UTF-8, BOM, truncation and trailing content cannot match.

Metadata inputs require exact plain or null-prototype records with enumerable own data fields. Accessors, symbols, proxies and unusual prototypes are refused. All returned metadata is copied and deeply frozen; encoded buffers are mutable, unpooled and exact-sized. Intrinsic byte-view access accepts fixed Uint8Array/Buffer views and rejects shared, resizable, detached and proxy views without using overridden view getters. The serializer does not invoke inherited `toJSON` callbacks.

Caps bound admitted body copying and encoding. Metadata reflection still depends on the supplied property count. This is not a hostile-runtime sandbox, a constant-memory claim or a proof that supplied release facts are honest.

## Joining the release formats

The [memory-only release assembler](usage-release-assembly.md) owns this join. It establishes the executable and lock hashes from supplied byte snapshots, encodes BUILD, derives independent file inventories, assembles and validates the archives, and generates the manifest and checksums. BUILD intentionally contains no self hash, archive hash, manifest hash or attestation. The assembler still relies on externally established source and build facts.

The joining caller must verify that the CLI BUILD executable hash equals both the independently checked `bin/aicharts` inventory hash and the actual archived executable bytes. It must bind source, version, runner and toolchain values across all artifacts. A valid manifest inventory alone cannot validate a BUILD body; even a non-JSON file can have consistent size/hash metadata.

Run `bun run release:build:check` with the repository's Node.js 24 runtime. Its synthetic tests join the real archive and manifest modules, then reject internally consistent archives with non-JSON BUILD, stale executable identity, swapped CLI/skill kind or a different skill runner. No fixture executable is run. The full repository gate includes this check explicitly.

Complete license contents, qualified Linux toolchain/runtime notices, ELF compatibility, complete source provenance, self-contained installation guides and authenticated immutable publication remain separate release gates. Passing this matcher does not make a distribution ready to install.
