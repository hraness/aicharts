# Claim inventory

This inventory lists every sentence in `README.md` and `docs/usage-*.md` that asserts positive support, qualification, live, production or platform status, with the evidence that backs it. It exists so that a support claim cannot be added or widened silently: `bun run usage:claims:check` (`scripts/assurance-claims.ts`) fails when a document contains a claim sentence without a registered phrase, when a registered phrase no longer appears in its document, or when an `evidenced` or `historical` row cites no date. Sentence detection is a bounded regular-expression heuristic over prose outside code fences and tables; it is deliberately over-inclusive, and a matched sentence that merely mentions a status word still gets a row so the reader can see its evidence class.

## Reading a row

- **Claim** is a verbatim phrase from the sentence, after whitespace normalization. Editing that sentence requires editing the row.
- **Location** is the repository-relative document.
- **Evidence** names the dated receipt, run, deployment, PR or inspection, or the source check that establishes the statement.
- **Status** is one of:
  - `evidenced`: current dated evidence for the exact artifact or deployment named.
  - `historical`: dated evidence for an earlier tree, deployment or account state; it does not prove the current tree.
  - `source-only`: established by checked source and tests; no live, hosted or provider evidence.
  - `unqualified`: a requirement, procedure or pointer whose live outcome has no retained receipt.
  - `unsupported`: no implementation or evidence.

Dated evidence is evidence for its own commit at its own time. Rerun the named command for the commit under discussion instead of reusing a receipt.

## Platform and provider summary

| Surface | State on 2026-09-24 |
| --- | --- |
| Linux x86-64 CLI | Qualified once by run 35498763628 for `c6b2b3e665cc82b72ab7d64a6a147624c6d1a783` on 2026-09-20; the newest attempt, run 36066135869 for `fc95b51b6cd44527d154853cb3404ffeb26dcb39`, failed at `read-link-map` and produced no artifact. No release or tag exists; `.github/workflows/cli-publish.yml` is implemented and unexecuted. |
| macOS | Source-only for the CLI and companion. One real enrollment and one accepted native upload were recorded on 2026-09-16; on 2026-09-19 the retained CLI returned `attempt_recovery_required`. No notarized or publicly distributed macOS build exists; it needs Apple credentials held by the owner. |
| Windows | Unsupported. No build, qualification or documentation claim. |
| Next.js site (`aicharts.io`) | Exact-deployment health verified for `fc95b51` at 2026-09-24T22:33:45Z and for `1cf93bd` at 22:53:14Z by `bun run usage:deployment:verify`; usage routes remain fenced by the recorded flags. |
| Cloudflare Worker | Last deployment `4c2b0b07-5838-468d-8161-2b27a84cab46` on 2026-09-21; the merged `fc95b51` Worker source is not deployed pending a schema-13-aware recovery artifact. |
| Codex, Claude Code, Devin | Authenticated dashboard readback across these three on 2026-09-21 (historical); local parsing is source-only. |
| Cursor, Trae, Warp, Hindsight, Antigravity, MiniMax Code, the Tokscale registry sources | Implemented and tested against synthetic inputs; no live provider qualification. |
| Hraness Accounts sign-in, pairing, private reads | Production flag names present on 2026-09-19 and 2026-09-24; signed-in readback recorded 2026-09-21 (historical); no current-tree live qualification. |
| Public leaderboard, contributions (`/v3`) | Flags absent in production; not live. |

## Inventory

| Claim | Location | Evidence | Status |
| --- | --- | --- | --- |
| works only while the site's account service is enabled | README.md | Activation runbook: production flag names inspected 2026-09-19 and 2026-09-24; enrollment recorded 2026-09-16, `attempt_recovery_required` on 2026-09-19 | historical |
| record dated production evidence, the exact-deployment health check | README.md | `target/assurance/deployment/receipt.json` for `fc95b51` at 2026-09-24T22:33:45Z | evidenced |
| optional paid development support after useful completed reads | README.md | `bun run skill:check` (support protocol tests) | source-only |
| for the local machine-readable handoff | README.md | `bun run skill:check` | source-only |
| Set `HRANESS_SUPPORT_AUDIENCE=off` for a delegated child | README.md | `bun run skill:check` | source-only |
| PostHog is initialized only in production on the canonical AI Charts domains | README.md | `lib/analytics` tests in `bun run test`; `docs/analytics-instrumentation.md` | source-only |
| PostHog measures acquisition and qualified engagement | README.md | `docs/seo-strategy.md` measurement contract; no retained analytics receipt | unqualified |
| The production site is deployed from `main` with Vercel | README.md | GitHub deployments 6647776777 (`fc95b51`) and 6649782774 (`1cf93bd`), 2026-09-24 | evidenced |
| each returned HTTP 200 with `X-Hraness-Delivery-Proof: | docs/usage-activation.md | Verifier receipt 2026-09-24T22:33:45Z, `dpl_3TA2bNgxfeQzY7Cf67XF6scjyUrm` | evidenced |
| The Cloudflare Worker was **not** redeployed for that merge | docs/usage-activation.md | Integrator inspection 2026-09-24: last Worker deployment unchanged from 2026-09-21 | evidenced |
| the same verifier passed for the next merge | docs/usage-activation.md | Verifier receipt 2026-09-24T22:53:14Z, `dpl_GGMYJjAUtEN13g7UyqWB3JKoCdhH` | evidenced |
| deployed to both production services after the complete source gate | docs/usage-activation.md | PR 349, `dpl_HRUt74pjFKM4bQe6DNkbr7E86TqX`, Worker `4c2b0b07-5838-468d-8161-2b27a84cab46`, 2026-09-21 | historical |
| Its worker, authentication, enrollment, pairing, admission and private-read flags were enabled | docs/usage-activation.md | Production inspection 2026-09-19 of Worker version `36447868-30b8-4cb4-8bcd-cb9fd6913946` | historical |
| production deployment identity checks remain authoritative | docs/usage-activation.md | `lib/usage/auth-server.ts` tests in `bun run test` | source-only |
| In a production deployment, set only `AICHARTS_USAGE_AUTH_ENABLED=1` | docs/usage-activation.md | Procedure step; no retained receipt for the minimal live Accounts qualification | unqualified |
| Keep its job and data intact while the replacement is being qualified | docs/usage-activation.md | Cutover procedure; no cutover has been performed | unqualified |
| physical reclamation requires qualified recovery, current authority controls and closed references | docs/usage-assurance.md | Requirement statement; no recovery qualification receipt | unqualified |
| the Worker that would serve these endpoints had not been redeployed | docs/usage-assurance.md | Integrator inspection and names-only Vercel environment read, 2026-09-24 | evidenced |
| production activation remain separate qualification requirements | docs/usage-assurance.md | Separation statement | unqualified |
| live enrollment, transport qualification, rollback fencing and V3 activation remain separate obligations | docs/usage-assurance.md | Separation statement | unqualified |
| If all slots remain live, publication waits | docs/usage-assurance.md | `bun run usage:worker:check` | source-only |
| still need separate recovery and live qualification | docs/usage-assurance.md | Separation statement | unqualified |
| supports a resumable, whole-index diagnostic for fresh V3 accounts | docs/usage-assurance.md | `bun run usage:worker:check` | source-only |
| physical reclamation and production recovery still require separate qualification | docs/usage-assurance.md | Separation statement | unqualified |
| once the delegated path is verified | docs/usage-autosubmit.md | Operator procedure; no scheduled-cycle receipt | unqualified |
| Use a stable signed collector path qualified against the retained enrollment | docs/usage-autosubmit.md | Operator procedure (`bun run custody:signing`); no retained receipt | unqualified |
| Each live integration still needs qualification with the selected account and application version | docs/usage-details.md | Limitation statement | unqualified |
| Product authorization uses a live-verified server account session | docs/usage-identity.md | Signed-in dashboard readback 2026-09-21 (activation runbook); SDK tests in `bun run test` | historical |
| A planned, time-bounded production qualification can temporarily enable it | docs/usage-identity.md | Procedure; no retained receipt | unqualified |
| The default pairing resolver is installed behind the separate disabled pairing fence | docs/usage-identity.md | Source; pairing flag name present 2026-09-24, live pairing unqualified | unqualified |
| The Next.js production build enforces the server-only boundary | docs/usage-identity.md | CI run 36055796464 Check on `fc95b51`, 2026-09-24 | evidenced |
| The nonpublishing `Qualify Linux CLI` workflow joins exact Git source reading, a fresh Linux build | docs/usage-linux-qualification.md | Run 35498763628, 2026-09-20 | evidenced |
| did **not** pass | docs/usage-linux-qualification.md | Run 36066135869 summary artifact, 2026-09-24 | evidenced |
| It qualified `x86_64-unknown-linux-gnu` on Ubuntu 22.04 image `20260907.292.1` | docs/usage-linux-qualification.md | Run 35498763628 for `c6b2b3e6`, 2026-09-20; not the current tree | historical |
| On macOS, `enroll` pairs an installation with an AI Charts account | docs/usage-local.md | Enrollment record 2026-09-16; `attempt_recovery_required` 2026-09-19 | historical |
| For live logs and an already | docs/usage-local.md | `cargo test --workspace --locked` | source-only |
| qualified observed subtotals, and fixed diagnostics | docs/usage-local.md | `cargo test --workspace --locked` | source-only |
| Inspection and export support the same 512 MiB database bound as the writer | docs/usage-local.md | `cargo test --workspace --locked` | source-only |
| Local real-RPC composition passes with synthetic authority | docs/usage-pairing-transport.md | `bun run usage:worker:check` | source-only |
| for a proposed Linux CLI, skill, and source distribution | docs/usage-release-archives.md | `bun run release:manifest:check`; no release exists | source-only |
| Linux ELF/runtime compatibility, complete notices, authenticated immutable acquisition and safe installation remain separate release requirements | docs/usage-release-assembly.md | Separation statement; Linux evidence is run 35498763628 (2026-09-20) | unqualified |
| qualified Linux toolchain/runtime notices, ELF compatibility, complete source provenance | docs/usage-release-build.md | Separation statement; Linux evidence is run 35498763628 (2026-09-20) | unqualified |
| turns one retained, nonpublishing Linux qualification into an immutable GitHub Release | docs/usage-release-publish.md | `bun run release:publish:check`; workflow unexecuted | source-only |
| It is intended as the canonical distribution path for the Linux CLI profile | docs/usage-release-publish.md | No `cli-v*` tag or release exists | unqualified |
| selects the newest successful `workflow_dispatch` run of "Qualify Linux CLI" on `main` | docs/usage-release-publish.md | `scripts/release/publish-workflow.test.ts` | source-only |
| requires `qualified`, `smoke.passed` and `notices.complete` to be true | docs/usage-release-publish.md | `scripts/release/verify-publication.check.mjs` | source-only |
| produced a passing receipt binding the four checksummed assets | docs/usage-release-publish.md | Local verifier run 2026-09-24 against artifact `linux-qualification-c6b2b3e665cc82b72ab7d64a6a147624c6d1a783-1` | evidenced |
| supports an existing normal SHA-1 checkout | docs/usage-release-source.md | `bun run release:source:check` | source-only |
| A shallow normal checkout is supported | docs/usage-release-source.md | `bun run release:source:check` | source-only |
| tracks live sign-in, native upload, private query and recovery qualification | docs/usage-sessions.md | Pointer to the activation runbook | unqualified |
| The macOS `aicharts enroll --state-dir /absolute/private/installation` command joins | docs/usage-terminal-enrollment.md | Enrollment record 2026-09-16; `attempt_recovery_required` 2026-09-19; `cargo test` sequencing tests | historical |
| Test-only roots, loopback routing and clocks are unavailable in production builds | docs/usage-terminal-enrollment.md | `cargo test --workspace --locked` (cfg-gated tests) | source-only |
| `log` macro suppression remains enabled | docs/usage-terminal-enrollment.md | Compile-time assertion in `cargo build --locked` | source-only |
| these are separate from the live Accounts, deployed edge-framing, signed CLI | docs/usage-terminal-enrollment.md | Separation statement | unqualified |
| Only explicit root starts with qualified timing | docs/usage-turns.md | `bun run test` (`lib/usage` turn tests) | source-only |
| when at least one turn has qualified runtime | docs/usage-turns.md | `bun run test` (`lib/usage` turn tests) | source-only |
| calculates elapsed runtime from qualified boundary timestamps | docs/usage-turns.md | `bun run test` (`lib/usage` turn tests) | source-only |
| owns the dated deployment inventory and cutover evidence | docs/usage-worker.md | Activation runbook entries dated 2026-09-19, 2026-09-21 and 2026-09-24 | evidenced |
| The production auth server connects its narrow transport through `createVercelPairingTransport` | docs/usage-worker.md | `bun run test`; live pairing unqualified | source-only |
| connect these methods to the server transport; live qualification remains separate | docs/usage-worker.md | Separation statement | unqualified |
| Its live qualification and operational activation remain separate acceptance steps | docs/usage-worker.md | Separation statement | unqualified |
| creates one immutable reservation only for a live, terminal-confirmed intent | docs/usage-worker.md | `bun run usage:worker:check` | source-only |
| can be reconciled by the same still-live reservation | docs/usage-worker.md | `bun run usage:worker:check` | source-only |
| composes the existing production-workload verifier | docs/usage-worker.md | Signed-in `/api/usage/days` readback 2026-09-21 (activation runbook) | historical |
| records observed production configuration separately from source defaults | docs/usage-worker.md | Activation runbook entries dated 2026-09-19 and 2026-09-24 | evidenced |
| the native upload transport is implemented, while production binding and live upload qualification remain separate activation checks | docs/usage-worker.md | One accepted native upload 2026-09-16 (historical); no current-tree upload | historical |
| The production router fences it with the private-read qualification | docs/usage-worker.md | Flag names present in production 2026-09-19 and 2026-09-24; `bun run test` | historical |

## Corrections made while building the inventory

- `README.md` said the identity design and activation runbook "list what is live in production today"; the runbook records dated evidence and the alias moves with every merge, so the sentence now points to the dated evidence, the verifier and this inventory.
- `docs/usage-release-publish.md` called the publish workflow "the canonical distribution path"; no tag or release exists, so it is now "intended as" that path with the unexecuted state stated.
- `docs/usage-linux-qualification.md` and `docs/usage-release-source.md` described the 32 MiB linker-map bound as current; run 36066135869 exceeded it and the shared bound is now 64 MiB.

## Adding or changing a claim

Write the sentence, run `bun run usage:claims:check`, and add the reported sentence's distinctive phrase as a row with its evidence and status. Prefer changing a sentence to state its evidence class over registering an overclaim. Do not delete evidence to satisfy the check.
