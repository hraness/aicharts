# Release assembly

`scripts/release/assemble.mjs` joins the [archive](usage-release-archives.md), [BUILD](usage-release-build.md), and [manifest/checksum](usage-release-manifest.md) formats into five owned byte buffers. It has no filesystem, process, environment, network, installation or publication interface. Supplied facts must be established independently before use.

## Input contract

`assembleLinuxRelease(input)` accepts exactly:

```text
{
  version,
  source: {commit, tree, commitTime},
  run: {runId, runAttempt},
  toolchain: {rustChannel, nodeMajor, bunVersion},
  target: {
    triple, os, arch, osFloor, libcFloor, cpuBaseline,
    runnerLabel, runnerImageVersion,
    cCompiler: {name, version}, dynamicDependencies
  },
  sourceFiles: [{path, mode, bytes}],
  executableBytes,
  thirdPartyLicenseBytes
}
```

The profile fixes Rust `1.97.1`, packaging Node major 24, target `x86_64-unknown-linux-gnu`, OS `linux`, architecture `x86_64`, Ubuntu `22.04`, glibc `2.35` and CPU baseline `x86-64`. Runner label is `ubuntu-22.04`; its image version, run and compiler facts must describe the actual build and assembly. A runner label alone does not prove compatibility. Dynamic dependencies are a sorted, distinct, nonempty list of one through 16 SONAMEs. A static executable needs a separately reviewed profile.

Versions, UTC commit time and identity fields follow the manifest's scalar rules. The source must include the root Cargo and Bun locks, workspace and CLI Cargo manifests, Rust toolchain, LICENSE, NOTICE and all mapped distribution/skill files. Mandatory source members have mode 0644; other regular source members may have mode 0644 or 0755. Every supplied file is preserved in the source archive. Unsupported paths, links, modes, duplicate names and case-fold or file/parent collisions are refused.

The separate [exact Git source reader](usage-release-source.md) supplies exhaustive membership of the selected local Git tree, including nonmandatory files, after raw-object and full-graph checks. Assembly itself cannot detect an omitted arbitrary file or prove that supplied bytes belong to a claimed commit. Neither module authenticates source provenance, and assembly does not parse the source manifests to verify the inherited Cargo version. The executable and complete third-party notice buffers must be nonempty, but nonempty bytes do not prove an executable or sufficient license coverage.

## Fixed payloads

The CLI archive contains exactly seven files:

| Member | Input |
| --- | --- |
| `bin/aicharts` | Final executable bytes, mode 0755 |
| `BUILD.json` | Generated CLI BUILD |
| `LICENSE` | Source `LICENSE` |
| `NOTICE.md` | Source `distribution/NOTICE.md` |
| `THIRD_PARTY_LICENSES.txt` | Independently qualified notice bytes |
| `docs/usage-install.md` | Source `distribution/cli/docs/usage-install.md` |
| `docs/usage-local.md` | Source `distribution/cli/docs/usage-local.md` |

All other CLI members use mode 0644. The nine-file skill archive contains generated BUILD, the same LICENSE/distribution NOTICE, and the six existing files under `skills/aicharts/`, all mode 0644. Neither archive acquires extra files from the source inventory. The exhaustive source archive retains the website NOTICE at its original path; the distribution NOTICE does not replace it.

## Byte flow and limits

Before copying bodies, assembly checks source count, intrinsic byte lengths, aggregate body limits, paths and mapped modes. It then snapshots the bytes, derives lock and executable hashes, generates both BUILD bodies from one fact set, and checks all exact padded archive layouts before compression. No placeholder hashes or guessed BUILD lengths are used.

Each archive is validated against an inventory derived from the pre-archive snapshots. Both archived BUILD bodies are checked again, and the archived executable must match the CLI BUILD and inventory. The generated manifest and four-subject checksums are then matched against those independently derived facts.

| Archive | Compressed cap | Expanded cap |
| --- | --- | --- |
| CLI | 64 MiB | 128 MiB |
| Skill | 1 MiB | 4 MiB |
| Source | 32 MiB | 64 MiB |

Source count is at most 2,048 regular files. Each archive permits at most 8,192 entries, including directories, and an expansion ratio at most 4,096. BUILD is at most 16 KiB, the manifest 1 MiB, and checksums 4 KiB. Archive timestamps use the checked commit time. These are payload limits, not a peak-memory guarantee. Metadata reflection remains proportional to supplied property count; this is not a hostile-runtime sandbox.

## Results and qualification

Success is `{ok:true,value:{files}}`, with five ASCII-name-sorted `{name,bytes,sha256}` records: CLI, skill and source `.tar.gz` files, `release-manifest.json`, and `SHA256SUMS`. Metadata is frozen. Each byte buffer is exact-sized and unpooled, independent of input buffers, sibling outputs and later calls. Its contents remain mutable; the publisher must preserve custody or rehash before use. Hash agreement is not authenticity.

Failure is `{ok:false,error}` with a fixed `invalid_input`, `invalid_source`, `invalid_binding`, `limit_exceeded` or `assembly_failed` code. No partial assets, source values or exception text are returned.

Run `bun run release:assemble:check` under Node.js 24. The synthetic join tests exercise the actual codecs, complete inventories, ownership, derived bindings and refusal limits without running an executable. The repository's full gate includes this check.

Exact local Git membership is supplied through the separate source-reader boundary. Authenticated source selection, Linux ELF/runtime compatibility, complete notices, authenticated immutable acquisition and safe installation remain separate release requirements. The distribution guides retain draft status until that acquisition procedure exists. Assembly does not enable authentication, enrollment, uploads, background collection, native credential custody or automatic updates.
