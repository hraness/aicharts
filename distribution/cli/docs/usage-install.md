# Run the Linux CLI

AI Charts provides local `stats` reports across its pinned parser roster and legacy usage collection for Codex, Claude Code, and Devin ATIF exports. Its separate `turns` command reports observed Codex daily runtime and partial token and requested-call subtotals. The foreground `daemon` command can repeat the legacy collector, but it never uploads or installs an OS service. This Linux profile does not provide account sign-in, enrollment, native credential storage, a tray application, or automatic updates.

Publication status: this is a first-release guide draft. No CLI release or authenticated download and verification procedure is available from this guide. Do not treat an archive, its checksums, or this guide alone as a verified release.

## Requirements

The planned first artifact targets Linux on an x86-64 CPU with GNU libc, using Ubuntu 22.04 and glibc 2.35 as the compatibility floor. The release builder must qualify that floor and list the executable’s dynamic dependencies before publication. This profile does not cover macOS, Windows, ARM, or Alpine/musl packages.

Use a private local filesystem for keys and optional ledger state. Do not put them in the extracted software directory, a network share, or a cloud-synchronized folder. The prebuilt CLI is designed to run without Cargo, Rust, Node.js, a browser, or a provider API key; it still needs its qualified system libraries.

## Verify before running

Wait for release-specific instructions that bind the exact source commit, release tag, workflow identity, archive hash, and file inventory. Matching a download to a checksum supplied by the same untrusted source is not authentication. `BUILD.json` describes build inputs; it does not authenticate itself or prove that an executable was built from the named source.

After that verification, extract the admitted archive into a new user-owned directory without elevated privileges or overwriting an existing installation. Its root must contain exactly:

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
