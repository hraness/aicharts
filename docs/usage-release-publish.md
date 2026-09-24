# Immutable Linux CLI publication

`.github/workflows/cli-publish.yml` turns one retained, nonpublishing Linux qualification into an immutable GitHub Release with OIDC build provenance. It is intended as the canonical distribution path for the Linux CLI profile: a reader would download the archive from the release, check its digest against `SHA256SUMS` and the manifest, and verify the attestation with `gh`. No package registry mirror exists, and none is required. No release has been published yet.

The workflow is implemented and unexecuted. As of 2026-09-24 the repository has no `cli-v*` tag and no release, so the path below has been validated only by the checked tests and a local run of the verifier against the retained artifact of qualification run 35498763628 (recorded under Validation). Publication of a real release is an owner-initiated act: pushing a tag. The newest `main` qualification attempt, run 36066135869 at `fc95b51b6cd44527d154853cb3404ffeb26dcb39`, failed at `read-link-map` ([details](usage-linux-qualification.md#hosted-qualification-evidence)), so a tag at that commit or any later one would fail closed until a successful qualification of the exact tagged commit exists.

## What triggers it

Pushing an annotated or lightweight tag matching `cli-vMAJOR.MINOR.PATCH`, or a manual dispatch naming such a tag that already exists. The tag's commit must be `main` or an ancestor of `main` (the GitHub compare status is `identical` or `behind`), the workspace `Cargo.toml` version at that commit must equal the tag version, and no release for the tag may already exist. The job runs only on `hraness/aicharts`, holds `contents: write`, `id-token: write` and `attestations: write` at job scope, uses no repository secret, no environment and no approval gate, and serializes by tag with `concurrency`.

## Why it republishes instead of rebuilding

The qualification runner (`scripts/release/run-linux.mjs`) admits only the identity `hraness/aicharts/.github/workflows/cli-release.yml@refs/heads/main`, so a tag-triggered workflow cannot rebuild or re-smoke the executable without a reviewed change to that policy. Instead the publish workflow selects the newest successful `workflow_dispatch` run of "Qualify Linux CLI" on `main` for the exact tagged commit, downloads its `linux-qualification-<commit>-<attempt>` artifact, and republishes those bytes unchanged. The qualification artifact is retained for seven days. A tag whose commit has no successful qualification inside that window fails closed with `publish_qualification_missing`; dispatch "Qualify Linux CLI" on `main` for that commit and rerun the publish workflow for the same tag.

## What is verified before and after publication

Before publication, `scripts/release/verify-publication.mjs` reads the downloaded artifact with fixed byte caps and refuses any extra, missing, oversized or symlinked member. It validates `qualification.json` through the qualification schema and requires `qualified`, `smoke.passed` and `notices.complete` to be true, the version to equal the tag version, and the source commit, run ID and run attempt to equal the values the workflow resolved independently. It parses `release-manifest.json` and requires the `linux-skill-v1` profile, the repository, tag, version, commit, tree, workflow path, `refs/heads/main` source ref and the same run ID and attempt. It recomputes SHA-256 for the three archives and the manifest, compares them with the manifest's asset entries and with `SHA256SUMS` (exactly four sorted entries), and writes a bounded `publication.json` receipt. `sha256sum --check --strict` runs on the same directory as an independent check. The verifier does not build, sign or publish; its receipt records the binding, not provenance.

The release carries seven assets: the CLI archive, the skill archive, the source archive, `release-manifest.json`, `SHA256SUMS`, `qualification.json` and `publication.json`. It is created with `--verify-tag` and `--latest=false`. `actions/attest-build-provenance` then signs a SLSA provenance statement for every subject listed in `SHA256SUMS` using the workflow's OIDC identity. After publication the workflow downloads the release with `gh release download`, checks `SHA256SUMS`, byte-compares every asset with the staged copy, and runs `gh attestation verify` for the three archives and the manifest, requiring the signer workflow `hraness/aicharts/.github/workflows/cli-publish.yml` and denying self-hosted runners. A failure after `gh release create` leaves the release in place with a failed run; the owner must delete that release by hand before rerunning, because the workflow refuses an existing release.

## Verifying a published release

```sh
gh release download cli-v0.1.0 --repo hraness/aicharts --dir aicharts-cli-v0.1.0
cd aicharts-cli-v0.1.0
sha256sum --check --strict SHA256SUMS
gh attestation verify aicharts-0.1.0-x86_64-unknown-linux-gnu.tar.gz --repo hraness/aicharts \
  --signer-workflow hraness/aicharts/.github/workflows/cli-publish.yml --deny-self-hosted-runners
```

Repeat the `gh attestation verify` line for the skill archive, the source archive and `release-manifest.json`. The attestation proves that the named workflow on `hraness/aicharts` published those exact bytes; the manifest's `workflow.runId` and `qualification.json` identify the `main` run that built and smoke-tested them. Neither proves the Rust toolchain or the runner image beyond what `qualification.json` records.

## Validation

`bun run release:publish:check` syntax-checks and tests the verifier (`scripts/release/verify-publication.check.mjs`: synthetic artifacts covering extra, missing, symlinked and oversized members; unqualified, drifted and rebound receipts; manifest, digest and checksum-file corruption; command-line receipt behavior) and parses the workflow (`scripts/release/publish-workflow.test.ts`: triggers, permissions, pinned action SHAs, the resolve/select/verify/publish/attest/verify step contract). The verifier was also run locally on 2026-09-24 against the retained artifact `linux-qualification-c6b2b3e665cc82b72ab7d64a6a147624c6d1a783-1` of run 35498763628 (commit `c6b2b3e665cc82b72ab7d64a6a147624c6d1a783`, tag `cli-v0.1.0`, run attempt 1) and produced a passing receipt binding the four checksummed assets: CLI archive 7,110,155 bytes `317b3dd95f269d9e991e608062d8dec67324e4f042e76ad9794046735a66e905`, skill archive 28,408 bytes `0fe1bf2215ea1e95defee6b7d584ec87aa913906ba9c787c4146626be9d312df`, source archive 4,145,654 bytes `adc9f6bf4c8999de82c1b7c42fd976242054944d519507e37607cc771b714718` and manifest 154,311 bytes `4f76262a8a704cfd1861f482d4be406f889ded45a291c735136430d1c5ed908d`; `sha256sum --check --strict SHA256SUMS` passed on the same directory. The pinned `actions/attest-build-provenance` commit `4d101475d8b20a2381f78447822ac1eab6504dd8` was confirmed to be the `v4.2.2` tag. That artifact expires on 2026-09-27; the receipt is local evidence for the verifier, not a publication.

## Open owner items

- Turn on the repository setting that makes releases immutable (GitHub "immutable releases"), so a published release's assets and tag cannot change after creation. The workflow refuses to overwrite an existing release, but only the repository setting binds the GitHub API.
- A macOS notarized release remains unimplemented. It needs an Apple Developer identity, a Developer ID certificate and notarization credentials held by the owner; the macOS companion is documented in `docs/usage-companion.md` and is not distributed by this path.
- The first real tag. Nothing in the repository creates tags, and no release exists. The publish workflow, the release notes format and the attestation verification steps are unexecuted until an owner pushes `cli-v0.1.0` after a successful qualification of that commit on `main`.
- Rebuilding inside the publish workflow, if ever wanted, requires a reviewed extension of the runner's identity policy in `scripts/release/run-linux.mjs` and its tests; the current design deliberately keeps building on `main` only.
