# Release manifest matching

`scripts/release/manifest.mjs` encodes and matches exact release metadata entirely in memory. It requires complete, independently trusted expectations. It is not a general parser for downloaded manifests, a release publisher, or an installer. No filesystem, network, extraction, or execution is involved.

## API and trust boundary

The four functions return `{ ok: true, value }` or `{ ok: false, error }`:

```text
encodeManifest(expectations) -> Buffer
parseManifest(bytes, expectations) -> Manifest
encodeChecksums(manifestBytes, expectations) -> Buffer
parseChecksums(bytes, manifestBytes, expectations) -> { entries }
```

The signatures above name the successful values, not a throwing API. Fixed failure codes are `invalid_expectations`, `invalid_manifest`, `invalid_checksums`, and `limit_exceeded`. They omit supplied values, raw exceptions, paths, and content.

The matcher generates canonical JSON from validated expectations, then compares the entire supplied byte sequence. It does not call `JSON.parse` on untrusted bytes. Field order, sorted inventories, compact encoding, ASCII values, and one final LF are part of the format. Duplicate or unknown keys, invalid UTF-8, BOM, escape aliases, alternate numbers, negative zero, extra whitespace, truncation, and trailing content cannot match. The owned serializer does not invoke inherited `toJSON` hooks.

Never derive expectations from the same untrusted manifest and treat equality as authenticity. Source membership must come from an independently governed complete Git inventory; archive lengths and hashes must come from actual, independently established bytes. This module cannot prove those caller facts. It cannot authorize extraction or execution.

## Expectations

The exact input shape is:

```text
{
  version,
  source: { commit, tree, commitTime },
  run: { runId, runAttempt },
  toolchain: { rustChannel, nodeMajor, bunVersion, cargoLockSha256, bunLockSha256 },
  target: {
    triple, os, arch, osFloor, libcFloor, cpuBaseline,
    runnerLabel, runnerImageVersion,
    cCompiler: { name, version }, dynamicDependencies
  },
  cli: { bytes, sha256, files },
  skill: { bytes, sha256, files },
  sourceArchive: { bytes, sha256 },
  sourceFiles
}
```

Each file is exactly `{ path, mode, bytes, sha256 }`. Inventory order is normalized, never membership. Records require plain or null prototypes and enumerable own data properties. Missing, extra, symbol, accessor, and proxy fields are refused. Arrays must be dense ordinary arrays without extra properties. Byte views use intrinsic backing access; shared, resizable, detached, and proxy views are refused. Metadata is deeply copied and frozen. Returned mutable buffers are owned, unpooled, exact-sized allocations without input or sibling-result aliases.

Versions, Rust channel, Bun version, and compiler version use canonical `MAJOR.MINOR.PATCH`, with at most nine digits per component and no leading zeros except zero itself. Node major is 24. Commits and trees are lowercase 40-hex; hashes are lowercase 64-hex. Run ID is a positive decimal string of at most 20 digits, never converted through Number. Run attempt is an integer from 1 through 1,000,000. Sizes are bounded safe integers; negative zero is refused. `commitTime` is an actual UTC `YYYY-MM-DDTHH:mm:ssZ` date from epoch zero through 8,589,934,591 seconds, without fractions, offsets, or leap-second spellings.

## Fixed release profile

Schema version 1 and profile `linux-skill-v1` select repository `hraness/aicharts`, tag `cli-vVERSION`, and workflow `.github/workflows/cli-release.yml` on `refs/heads/main`. The workflow record binds the supplied commit and run/attempt. It does not establish that a workflow ran or an attestation was verified.

The single target requires `x86_64-unknown-linux-gnu`, OS `linux`, architecture `x86_64`, OS floor and runner label `ubuntu-22.04`, libc floor `glibc-2.35`, and CPU baseline `x86-64`. These are release-policy requirements to establish independently, not compatibility facts inferred by this codec.

`runnerImageVersion` has one through four canonical decimal components and at most 48 bytes. Compiler name is `gcc` or `clang`, never a free-form banner. `dynamicDependencies` is a sorted, distinct array of 1–16 ASCII single-component SONAME-shaped names, each at most 128 bytes, without case-fold collisions. It is metadata, not an ELF inspection.

The fixed disabled-capability list is `authentication`, `enrollment`, `upload`, `backgroundCollection`, `nativeCustody`, and `autoUpdate`. This describes the intended distribution scope, not a sandbox guarantee. No current release workflow, artifact, or installation is implied by the profile.

## Assets and limits

Exactly three assets are emitted, sorted by name. Each is `{ name, kind, target, bytes, expandedBytes, sha256, root, files }`. CLI target is the fixed triple; skill and source targets are null.

| Asset | Root | Compressed cap | Expanded cap | File cap |
| --- | --- | ---: | ---: | ---: |
| `aicharts-V-x86_64-unknown-linux-gnu.tar.gz` | Name without `.tar.gz` | 64 MiB | 128 MiB | 16 |
| `aicharts-skill-V.tar.gz` | `aicharts` | 1 MiB | 4 MiB | 16 |
| `aicharts-source-V.tar.gz` | Name without `.tar.gz` | 32 MiB | 64 MiB | 2,048 |

The CLI inventory has exactly seven files: `bin/aicharts`, `BUILD.json`, `LICENSE`, `NOTICE.md`, `THIRD_PARTY_LICENSES.txt`, `docs/usage-install.md`, and `docs/usage-local.md`. Only the executable is `0o755`; the rest are `0o644`.

The skill inventory has exactly nine files: `SKILL.md`, `agents/openai.yaml`, `references/benchmarks.md`, `references/local-usage.md`, `scripts/atlas.mjs`, `scripts/atlas.check.mjs`, `BUILD.json`, `LICENSE`, and `NOTICE.md`. All are `0o644`.

Source inventory preserves supplied `0o644` or `0o755` modes and may contain empty files. No unsupported source file is silently excluded. Paths follow the restricted ASCII and representable USTAR name/prefix rules in [Release archive bytes](usage-release-archives.md), including the 256-byte full-path ceiling and collision checks.

Every compressed asset is at least 20 bytes. Derived expanded size includes all root, directory, and file headers, padded bodies, and exactly two terminal zero blocks. It must fit the asset cap, at most 8,192 entries, and a 4,096:1 expansion ratio. The module computes layout from the inventory but does not itself read, hash, or validate archive contents.

Manifest input is capped at 1 MiB and checksums at 4 KiB before copying or matching. Synchronous operations use multiple bounded buffers, not constant memory. Metadata reflection still takes work proportional to supplied own-property counts before rejection; upstream callers must bound metadata shape. This is not a hostile-JavaScript execution sandbox.

## Checksums and remaining release gates

`SHA256SUMS` covers the three archives and `release-manifest.json`, sorted by basename. Each line is a lowercase digest, two spaces, the exact basename, and LF. The manifest digest includes its final LF. Neither checksums nor attestations hash themselves.

`BUILD.json` inventory entries are mandatory, `0o644`, at most 16 KiB, and independently hashed. Their bodies are not inputs and are not parsed. Even a non-JSON body can have matching metadata. Separate gates must validate BUILD contents and executable bindings, licenses, self-contained guides, complete source-copy provenance, compatibility, immutable assets, and authenticated release attestations.

The separate [BUILD matcher](usage-release-build.md) checks canonical body contents against independent expectations and the admitted file inventory. The joining caller still owns actual executable-byte binding and consistent source/runner facts; the manifest matcher does not invoke that check automatically.

## Verification

Run `bun run release:manifest:check` with the repository's Node.js 24 runtime. The complete repository gate invokes it explicitly. Keep `manifest.check.mjs` outside Bun's broad test discovery. Synthetic tests cover exact encodings, invalid shapes, size and path boundaries, output ownership, checksum binding, and layout parity with real in-memory archives. Passing tests establish only these codec properties on the tested runtime, not a release-ready distribution.
