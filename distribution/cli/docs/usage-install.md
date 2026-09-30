# Run the Linux CLI

AI Charts provides local `stats` reports across its pinned parser roster and legacy usage collection for Codex, Claude Code, and Devin ATIF exports. Its separate `turns` command reports observed Codex daily runtime and partial token and requested-call subtotals. The foreground `daemon` command can repeat the legacy collector, but it never uploads or installs an OS service. This Linux profile does not provide account sign-in, enrollment, native credential storage, a tray application, or automatic updates.

The published Linux release is [cli-v0.2.0](https://github.com/hraness/aicharts/releases/tag/cli-v0.2.0), built from commit `525b9f3a54e3264e4b3050522527985a13ebfad0`. Its [Linux build and installation checks](https://github.com/hraness/aicharts/actions/runs/36605822635) and [publication with GitHub build attestations](https://github.com/hraness/aicharts/actions/runs/36606325096) passed on 29 September 2026. The download commands below verify the checksums and the publishing workflow before extracting the CLI.

## Requirements

The release targets Linux on an x86-64 CPU with GNU libc, using Ubuntu 22.04 and glibc 2.35 as the compatibility floor. Its dynamic dependencies are `ld-linux-x86-64.so.2`, `libc.so.6`, `libgcc_s.so.1`, and `libm.so.6`, recorded in the release's `qualification.json`. This profile does not cover macOS, Windows, ARM, or Alpine/musl packages. On a Mac, [build from source](https://github.com/hraness/aicharts/blob/main/docs/usage-local.md#build-and-run). Windows installation and credential storage have not been tested for release.

Use a private local filesystem for keys and optional ledger state. Do not put them in the extracted software directory, a network share, or a cloud-synchronized folder. The prebuilt CLI is designed to run without Cargo, Rust, Node.js, a browser, or a provider API key; it still needs its qualified system libraries.

Install the [GitHub CLI](https://cli.github.com/) for downloading and verifying the release. The following commands also use `sha256sum` and `tar`.

## Verify before running

Download into a new directory. `mkdir` and `gh release download` refuse to overwrite an existing installation or download. The command checks all four files in `SHA256SUMS`, verifies each archive and the manifest against the publishing workflow, and extracts only if every check passes:

```sh
aicharts_version=0.2.0
mkdir "aicharts-cli-v${aicharts_version}" && (
  cd "aicharts-cli-v${aicharts_version}" &&
  gh release download "cli-v${aicharts_version}" --repo hraness/aicharts &&
  sha256sum --check --strict SHA256SUMS &&
  for asset in *.tar.gz release-manifest.json; do
    gh attestation verify "$asset" --repo hraness/aicharts \
      --signer-workflow hraness/aicharts/.github/workflows/cli-publish.yml \
      --deny-self-hosted-runners || exit
  done &&
  tar -xzf "aicharts-${aicharts_version}-x86_64-unknown-linux-gnu.tar.gz"
)
```

Stop if the command fails. Matching a download to a checksum supplied by the same untrusted source is not authentication. The attestations bind the downloaded bytes to the publishing workflow; `release-manifest.json` records the release tag, source commit, file inventory, and build run. `BUILD.json` describes build inputs; it does not authenticate itself or prove that an executable was built from the named source.

The archive creates its own directory inside your new download directory without elevated privileges. After the command succeeds, enter it:

```sh
cd "aicharts-cli-v${aicharts_version}/aicharts-${aicharts_version}-x86_64-unknown-linux-gnu"
```

Its root must contain exactly:

```text
bin/aicharts
BUILD.json
LICENSE
NOTICE.md
THIRD_PARTY_LICENSES.txt
docs/usage-install.md
docs/usage-local.md
```

Only `bin/aicharts` is executable. Keep the guides and notices with it. No installer or shell startup modification is required to invoke the binary by path.

To use `aicharts` by name in this terminal, add this installation to the current shell's path:

```sh
export PATH="$PWD/bin:$PATH"
```

From the verified archive root, check the available commands:

```sh
./bin/aicharts --help
./bin/aicharts --version
./bin/aicharts --version --json
```

The version result is self-reported compiler metadata. It contains `sourceCommit: null` and `provenance: "unverified"`; it cannot replace release verification. These commands do not read keys, provider logs, or a ledger.

## Create a detailed local report

After release verification, list the supported clients or read selected sources under your absolute home directory:

```sh
./bin/aicharts stats --list-clients
./bin/aicharts stats --home "$HOME" --client codex --client claude --json
```

`stats` needs no namespace key. The default period is the last 30 UTC days, including today. Its JSON report includes client/model aggregates, disjoint token buckets, known costs, and coverage. Reported charges and estimates stay separate; unknown values remain unknown. Parser support describes known local formats, not live qualification of every application version or account.

The command discovers existing logs, exports, or acquired caches under the selected home. It does not refresh provider data or upload a report. It uses private temporary source captures for consistent reads; normal success and handled failures remove them. Source content is excluded from the numeric report. A failed scan remains incomplete and must not be treated as zero usage.

For file-key collection, turn observations, and the v1 numeric ledger, continue with [Legacy local usage](usage-local.md). That guide's model/pricing and source-copying limitations apply to those legacy commands. The separately distributed AI Charts skill is optional and does not install the CLI. Its benchmark helper needs its own documented Node.js runtime and makes anonymous public benchmark requests; the CLI commands described here make no network requests.
