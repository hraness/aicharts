# Release archive bytes

`scripts/release/archive.mjs` builds and validates a restricted tar/gzip format entirely in memory. It does not read files, extract an archive, execute a payload, install software, or authenticate a release. Release packaging and installation still need separate callers and qualification.

## API

`buildArchive({ root, mtime, files, caps })` returns `{ ok: true, value: Buffer }` or `{ ok: false, error }`. Each file is exactly `{ path, mode, bytes }`, where `path` is relative to the root, `mode` is `0o644` or `0o755`, and `bytes` is a `Uint8Array` or `Buffer`. Parent directories are derived.

`validateArchive(bytes, { root, mtime, files, caps })` returns the same failure shape or `{ ok: true, value: { root, mtime, files } }`. The independent inventory uses `{ path, mode, bytes, sha256 }`: `bytes` is the expected integer length and `sha256` is exactly 64 lowercase hexadecimal characters. Successful files contain `{ path, mode, sha256, bytes: Buffer }` in path order. No files are returned unless every member passes.

Obtain the inventory and limits independently of the untrusted archive. Comparing an archive with its own untrusted manifest does not establish authenticity. This module does not verify signatures, attestations, provenance, licenses, or executable behavior.

[Release manifest matching](usage-release-manifest.md) defines a separate exact metadata and checksum format for a proposed Linux CLI, skill, and source distribution. Neither module authenticates the other; callers still need independently trusted expectations.

Records must have exactly the documented enumerable own data fields and a plain or null prototype. Arrays must be dense ordinary arrays. Proxies, accessors on records or arrays, and extra keys are refused. Genuine byte views use intrinsic backing-buffer access; their own decorations are ignored. Shared, resizable, and detached buffers are refused. Returned metadata is frozen. Returned file buffers are mutable, owned, exact-sized allocations without input, sibling-file, or sibling-call aliases.

Failures expose only `invalid_input`, `invalid_caps`, `invalid_path`, `invalid_inventory`, `limit_exceeded`, `invalid_gzip`, `invalid_tar`, or `content_mismatch`. These codes omit raw exceptions and content; they are not a forensic diagnosis.

## Caller limits

`caps` requires all six fields below as positive safe integers. Callers should select the smallest suitable limits.

| Field | Maximum |
| --- | ---: |
| `maxCompressedBytes` | 67,108,864 |
| `maxExpandedBytes` | 134,217,728 |
| `maxFileBytes` | 134,217,728, no greater than `maxExpandedBytes` |
| `maxFiles` | 2,048 |
| `maxEntries` | 8,192, no less than `maxFiles` |
| `maxExpansionRatio` | 4,096 |

An inventory needs at least one regular file; files may be empty. Expanded size includes the root and every derived-directory header, every regular-file header, each 512-byte-padded file body, and exactly 1,024 terminal zero bytes. The validator derives the exact expanded size from the inventory and uses it as the native inflation limit. It also enforces the expansion ratio against the complete compressed length and requires the inflater to consume every payload byte.

Path, size, and layout checks run before payload copies or tar allocation. Compression output is capped. Processing is synchronous and uses several buffers proportional to the expanded limit. It is not streaming, constant-memory processing, or a hostile-JavaScript sandbox. Metadata reflection takes work proportional to supplied property counts before rejecting extra fields; bound independently supplied metadata at its own input boundary. Service-level timeouts and isolation remain the caller's responsibility.

## Canonical format

The format permits only POSIX USTAR regular files and derived directories. Roots have one component. Paths use ASCII letters, digits, `.`, `_`, `@`, `+`, `(`, `)`, `[`, `]`, and `-`. Empty components, `.` and `..`, trailing dots, Windows device names, absolute paths, whitespace, Unicode, backslashes, and colons are refused. Duplicate paths, case-fold collisions, and file/directory collisions are refused.

The full path must fit the USTAR 100-byte name and 155-byte prefix fields using the rightmost valid slash split. The maximum is 256 ASCII bytes; not every path of that length is representable. There is no PAX or GNU fallback.

Entries sort by full path. Directory mode is `0o755`; file modes are `0o644` or `0o755`. Ownership IDs are zero; owner names, link names, device fields, and padding are empty. `mtime` is supplied explicitly as integer seconds from zero through 8,589,934,591. The builder reads no clock, environment, or Git state. The validator compares complete canonical headers, contents, and padding against the independent inventory.

Gzip has a fixed header, one member, checked CRC32 and size, and no filename, comment, or extra fields. Truncation, trailing bytes, and concatenated streams are refused. Equivalent complete deflate encodings can validate; recompression is not the validity test. Repeated builder inputs produce identical bytes on a qualified Node/zlib runtime, without a claim of byte identity across arbitrary runtime versions or reproducible Rust builds.

## Verification

With the repository's Node.js 24 runtime installed, run:

```sh
bun run release:archive:check
```

The required repository gate invokes this command explicitly with Node. Keep the test filename `archive.check.mjs` outside Bun's broad test discovery. The corpus includes independent header and CRC checks, consumed-input behavior, unsafe names and types, truncation, inflation limits, backing-buffer ownership, and seeded round-trip and invalid-input properties. Passing it qualifies the tested runtime behavior, not an installable or authenticated release.
