# Linux CLI qualification report

The nonpublishing `Qualify Linux CLI` workflow joins exact Git source reading, a fresh Linux build, executable checks and a new-directory installation smoke. Its `scripts/release/run-linux.mjs` runner supplies the measured facts to `scripts/release/linux-qualification.mjs`; the latter remains a bounded report validator, not a compiler or authenticator.

This is qualification infrastructure, not an authenticated public release. A workflow definition or a passing local test does not establish that its Linux run passed. Keep public download instructions disabled until the actual run and separate provenance/acquisition gates pass.

## Hosted qualification evidence

The newest dispatch, [24 September 2026 run 36066135869](https://github.com/hraness/aicharts/actions/runs/36066135869), attempt 1, did **not** pass. It ran on `main` at merge `fc95b51b6cd44527d154853cb3404ffeb26dcb39` (PR 422), tree `5690cd353e79f751ae85f2b0b3729abd21586b96`, Ubuntu 22.04 image `20260920.303.1`, GCC 11.4.0, Rust 1.97.1 and Bun 1.3.14. Source, toolchain, `cargo-fetch`, `cargo-metadata`, `cargo-build` and `measure-executable` completed; the `read-link-map` stage then refused `link_map` with `byte_limit`: the complete GNU bfd map measured **33,690,505 bytes** against the then-shared **33,554,432-byte (32 MiB)** bound. ELF checks, notice collection, the 18 smokes, assembly and installation were not reached, and only the diagnostic summary `linux-qualification-summary-fc95b51b6cd44527d154853cb3404ffeb26dcb39-1` (948 bytes, retained until 2026-10-01) exists; no qualification artifact was produced. The source that commit compiles is therefore not Linux-qualified, and a `cli-v*` tag at it would fail closed in the publish workflow.

The repair raises `LINUX_LINK_MAP_MAX_BYTES` in `scripts/release/linux-notices.mjs` to **67,108,864 bytes (64 MiB)**, shared by the runner read and the collector parser as before. The map size is a symbol-count proxy for the linked executable, not a security bound; parsing stays bounded by the same constant, and the 64 MiB executable cap, deadlines and every source, native-library, notice and archive check are unchanged. The boundary tests in `linux-notices.check.mjs` and `run-linux.check.mjs` now cover complete maps above 8 MiB, at the measured 33,690,505 bytes and at exactly 64 MiB, with one byte beyond refused before parsing. That repair is source evidence only; a new dispatch on `main` after it merges must supply the hosted result.

The newest successful qualification remains the [20 September 2026 run 35498763628](https://github.com/hraness/aicharts/actions/runs/35498763628), attempt 1, which passed for source `c6b2b3e665cc82b72ab7d64a6a147624c6d1a783`, tree `7318b86736bf5c4192da303bb7731e330d00d7bd`. It qualified `x86_64-unknown-linux-gnu` on Ubuntu 22.04 image `20260907.292.1`, with GCC 11.4.0 and Rust 1.97.1. Source/build checks, ELF/runtime checks, all 18 smoke invocations, complete notice collection, assembly and the new-directory installation checks passed. The installed executable's two `stats` smokes are included in those 18 invocations.

Independent verification of the downloaded artifacts bound all five assets to the qualification receipt, release manifest, checksums and build records. The source archive contained the exact 1,011 source files. The five assets are the CLI, skill and source archives, `release-manifest.json` and `SHA256SUMS`. Verified byte identities are:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Linux executable | 19,291,016 | `82da56a8d55291d4bb7a341a05728b7f81bc651e8ee26a4eaf9940b6f5ddcbc6` |
| Complete notices | 17,689,035 | `fa6211a57d69a885242aa73055204fdf5051ee71377f6cc2f7144e656f8771b9` |
| Source archive | 4,145,654 | `adc9f6bf4c8999de82c1b7c42fd976242054944d519507e37607cc771b714718` |

The qualification receipt SHA-256 is `82752518f82ce91ab96bdea755401dd41144f456f76417a8c3ddc54420f6c6fb`. This evidence applies to the exact source and artifacts above; later documentation edits are not claimed as their build source. The workflow artifacts are temporary qualification results, with no public release or provenance attestation. The scratch installation checks do not establish a user installation, macOS qualification, live provider acquisition or execution on every historical x86-64 processor.

### Earlier hosted evidence

The [20 September run 35497007643](https://github.com/hraness/aicharts/actions/runs/35497007643), attempt 1, used PR 335 merge `aef0856ad82faa6b9ebf3fef2779cc518cc3c304`, tree `49fc881d9cd10159964b57af39b4cc014ae0e1ce`, on Ubuntu image `20260907.292.1`. The shared linker-map bound passed, followed by ELF and runtime checks (maximum required glibc 2.34, x86-64 baseline ISA) and smokes 1–12. Smoke 13 then failed. Its source still used the old fresh-source upload flags and expected `upload_not_enabled_use_dry_run`; the current enrolled-upload parser rejects those flags with `invalid_option`. The summary identifies the failed smoke, but does not publish its raw stderr. Notice collection, installation and the detailed-report smokes were not reached.

Smoke 13 now invokes the valid `upload --state-dir state --key-file key` form and requires exit 2, empty stdout and the exact Linux refusal `upload_requires_qualified_macos_custody`. It also verifies unchanged synthetic ledger bytes, key bytes and private key permissions. This checks the current platform boundary without accessing real credentials or sending usage, and keeps the total at 18 smoke invocations. Run 35498763628 above passed this corrected check.

The [20 September diagnostic run 35495936110](https://github.com/hraness/aicharts/actions/runs/35495936110), attempt 1, used PR 334 merge `0bc181f99339ee52874d36a73801025eee2a96e6`, tree `e994eec34429637503a00cff18e61b3b75f880c4`, on Ubuntu image `20260907.292.1`. Compilation and the executable read passed. The named `read-link-map` stage then refused `link_map` with `byte_limit`: its exact **32,742,487-byte** size exceeded the runner's **8,388,608-byte** limit. Only the diagnostic summary was retained; ELF checks, notice attribution, installation and the 18 smoke checks were not reached.

That measurement fit within the collector's then-existing **33,554,432-byte (32 MiB)** map bound, so the runner and collector were joined at that shared `LINUX_LINK_MAP_MAX_BYTES`. This admitted the complete map for attribution instead of truncating it, while preserving the 64 MiB executable limit, deadlines and every source, native-library, notice and archive check. Run 36066135869 above later exceeded that 32 MiB bound by 136,073 bytes, which is why the shared constant is now 64 MiB.

The [20 September run 35494506870](https://github.com/hraness/aicharts/actions/runs/35494506870), attempt 1, used PR 332 merge `f9febdfb7e7be1b04f04d7f29f67a41c79033f1b`, tree `b58773ee8cd08043dcc4a2c4460a99f9ab25936f`, on Ubuntu image `20260907.292.1`. Source and fixed-toolchain checks completed, and compilation succeeded. The runner then refused an artifact read with `artifact_invalid`, before ELF inspection, notice collection or the 18 smoke checks. Only its diagnostic summary was retained. That revision did not distinguish the executable read from the linker-map read or report the failed artifact's size, so it establishes neither a size-limit cause nor successful qualification of the new installed `stats` command.

The [13 September run 34786660910](https://github.com/hraness/aicharts/actions/runs/34786660910) used PR 219 merge `7a1df9f4db73e070369ef51f26d4aa3a1083b31e`, tree `c70f7dd920310ea3b4f3badbf8beb114b1589084`, on Ubuntu image `20260907.292.1`. Exact source/build checks, ELF/runtime validation, all 14 CLI smokes, notice collection, assembly and persistence passed. The retained summary reports 16 smoke invocations, a 3,828,896-byte executable and 16,797,664 bytes of notices. This earlier successful receipt does not qualify later provider or detailed-report changes.

The repair raised each bounded `dpkg-query` ownership/version subprocess timeout from five to 30 seconds for cold package databases. The fixed query environment, output cap, overall qualification deadline, diagnostics and all attribution predicates remain unchanged. The preceding [run 34785498690](https://github.com/hraness/aicharts/actions/runs/34785498690) and exact retry [34785695232](https://github.com/hraness/aicharts/actions/runs/34785695232) are retained as the two reproduced `package_query_terminated` refusals that motivated this repair.

The [preceding run 34775435194](https://github.com/hraness/aicharts/actions/runs/34775435194), at PR 214 merge `77d295b0c5b31062ed7edff9795e418afa5d35c1`, reached a successful collector return before the runner rejected its output. Its summary retained neither a collector diagnostic nor an output size. That revision capped successful collector output at 16 MiB despite the collector's 64 MiB ceiling; PR 215 joined those bounds. The intervening failed collector runs did not establish successful assembly; the 13 September receipt above supplies that later evidence. Individual section limits, source attribution, hash verification and archive limits remain enforced.

The [previous run 34763938565](https://github.com/hraness/aicharts/actions/runs/34763938565) stopped earlier with `notices_invalid_input`. Its source repair handles Ubuntu GCC copyright references ending with an unquoted sentence period. The closed common-license basename and punctuation rules below remain in force.

## Run one qualification

Dispatch `.github/workflows/cli-release.yml` on the canonical repository's protected `main`. It has read-only repository permission, no production secrets and no publication job. The workflow checks out its exact event commit, installs the fixed toolchain, and creates a private scratch parent before running:

```text
node scripts/release/run-linux.mjs --repository ABSOLUTE_CHECKOUT --commit EXACT_COMMIT --tree EXACT_TREE --output ABSENT_OUTPUT_CHILD
```

The runner requires the GitHub Ubuntu 22.04 x86-64 environment and matching main/commit/workflow identity. Those environment checks constrain the intended job; they do not make a locally fabricated environment authentic. The output child must not exist, and its parent must already be user-owned mode 0700. The runner never overwrites an installation or removes its scratch files after failure.

The runner and its imported release modules are trusted bootstrap code from the workflow's exact checkout. The Git reader verifies the selected build source, not the already-loaded JavaScript runtime. A standalone call to `runLinuxRelease` does not authenticate its caller, bootstrap code or environment; the report must not be presented as doing so.

Cargo fetches the locked public dependencies into a fresh private cache. Compilation then uses the offline locked source and one release build. No provider logs, personal keys, user ledger or production service are inputs. The source and target directories, compiler cache and synthetic smoke state remain in scratch, outside the archive.

The current runner retains its 16 existing smoke invocations and adds two for
`stats` from the assembled, installed executable. It reuses the synthetic Codex
and Claude inputs inside a fresh explicit home, selects September 10, 2026 with
both date flags, and requires 185 exact reported tokens across two records with
partial breakdown coverage and correct source timestamps. The adjacent empty
day must contain no rows and retain empty sources with unavailable token coverage.
Both checks reject transcript canary output and recheck the unchanged synthetic
stores and installed files. The invocation cap is 18; the shared 60-second smoke
budget is unchanged. Run 35498763628 passed these installed-report checks; their
synthetic inputs do not qualify live provider acquisition.

Success retains the assembler's five exact files under `assets/`, `qualification.json` and a bounded `summary.json`. A failed job retains no successful qualification artifact; its bounded summary identifies the failing stage. The workflow uploads only those explicit outputs for seven days, never caches, private build evidence or the entire scratch directory. These public-repository artifacts are temporary test results, not immutable GitHub Releases or installation authority.

The compiler outputs have separate `measure-executable` and `read-link-map` stages. A failed read records `artifact_read_invalid`, the fixed `executable` or `link_map` kind, and a static reason for the regular-file, byte-limit, executable-mode, identity, short-read, growth or I/O refusal. Its metadata size is exact through 1 GiB and saturates above that bound with `sizeSaturated: true`; unavailable metadata is null. This telemetry is separate from the 64 MiB executable and shared 64 MiB linker-map read limits, and includes no path, artifact content or arbitrary error text.

An ELF refusal also records a fixed predicate code and bounded observations: recognized system-library names, numeric version requirements, and counts or redaction markers for unsupported values. This summary does not include arbitrary tool output, unknown names, paths or compiler diagnostics. These observations explain a refusal; they do not relax the compatibility policy or establish a successful run.

Native notice refusals can include a source-owned `nativeCategory` for build-script identity/links/paths, generated archives, linker inputs, Rust libraries or system/runtime attribution. Only the fixed category allowlist crosses into the summary; arbitrary package names, paths and tool output remain excluded. `unknown_load` can include an unrecognized object inside the Cargo target directory; it does not establish that the input came from an external path.

System notice refusals can include a fixed `systemCategory` identifying package-query failure, process termination or output limit; unresolved ownership or invalid package metadata; copyright path/read checks or missing GCC runtime exception; malformed common-license reference prefix, delimiter or name; or common-license path/read checks. A terminated query is an observation, not proof of why the process stopped. Equivalent aliases still receive the same bounded lookup attempts; an earlier query failure is reported only if no alias establishes the required owner. Raw paths, package identities, exception messages and subprocess output are absent. Source-change and other existing failure codes retain their meaning.

The runner checks successful collector output before assembly. A refusal records `notices_output_invalid` with one fixed reason: `wrong_type`, `empty`, `byte_limit` or `hash_mismatch`. Its byte count saturates at 64 MiB plus one, or is null when the value is not a Buffer. Notice contents, supplied hashes and paths are absent from this diagnostic.

The receipt stays in private staging until archive and installation checks finish. The final create-only receipt and successful job outcome establish completion; the diagnostic summary is not a substitute. Failed scratch may contain partial assets, which the successful-artifact upload step does not select.

## Measured compatibility and attribution

The runner fixes GCC 11, GNU bfd, Rust 1.97.1 and the x86-64 compiler baseline. It checks the actual ELF interpreter, direct dependencies, version requirements, writable/non-executable stack, absence of embedded library search paths, and the available runtime libraries. A native smoke run on the hosted runner does not prove execution on every historical x86-64 processor; the summary states that limitation.

The fixed glibc loader may also be a direct `DT_NEEDED` dependency. glibc's [libc linker script](https://sourceware.org/legacy-ml/libc-alpha/2013-05/msg00231.html) includes the loader through `AS_NEEDED`; [GNU ld](https://sourceware.org/binutils/docs/ld/Options.html) can retain that dependency when it resolves required symbols. The resolved `ld-linux-x86-64.so.2` must match the canonical `/lib64/ld-linux-x86-64.so.2` interpreter, and its requested symbol versions must exist in that exact runtime. The same runtime hash, notices and archive dependency inventory checks apply.

`scripts/release/linux-notices.mjs` joins Cargo's actual compiler-artifact messages with the GNU bfd map and installed runtime libraries. The checked mapping in `distribution/cli/linux-notices.json` binds selected registry package versions, package checksums and original notice hashes. Unknown compiled packages, native inputs or missing notices refuse qualification. The collector includes the bundled SQLite statement, Rust copyright and runtime license material, and the owning Ubuntu packages' notices and referenced common licenses. A hashed Cargo linker output must contain the same bytes as the executable supplied to assembly.

Retained sections are capped at 16 MiB each and 48 MiB combined. The collector and runner share a 64 MiB bound for the final formatted notice bundle. The runner verifies the complete buffer's SHA-256 before assembly, whose independent archive limits still apply. Notices are never truncated to fit a size limit.

Pinned Rust's [linker implementation](https://github.com/rust-lang/rust/blob/8bab26f4f68e0e26f0bb7960be334d5b520ea452/compiler/rustc_codegen_ssa/src/back/link.rs) creates its temporary directory under `output.parent()` and writes `symbols.o` there. Its pinned `tempfile` 3.23.0 builder appends six ASCII alphanumeric characters to `rustc`. The collector therefore accepts only `rustc[A-Za-z0-9]{6}/symbols.o` directly beneath the measured GNU `OUTPUT` parent, preserving the original normalized spelling. Other output directories, extra path depth, dot-segment aliases, hidden directories and unknown objects remain refused. The former scratch-root exception is removed.

The HTTPS dependency addition pins `ureq` 3.4.1 with Rustls only and `log` 0.4.34 with all-profile macro suppression; the [native transport contract](usage-admission-v1.md#native-https-transport) records the privacy reason and canary. Attribution now recognizes only the exact native providers `libsqlite3-sys` 0.38.2 and `ring` 0.17.14, their required links and bounded Cargo output paths. Both ring archives are required, including its test archive emitted by ordinary library builds. Generated inputs must be canonical regular ordinary `ar` files, capped at 32 MiB each and 64 MiB together; thin archives and unrecognized generated loads refuse. Ring's root license and both nested `src/polyfill/once_cell` license texts remain hash-pinned. The added `libutil.a` name still requires canonical system resolution and `libc6-dev` package attribution; it does not admit arbitrary static libraries.

The package checksum is the SHA-256 of the matching cached `.crate` archive under `registry/cache`, using the same registry directory and package/version as the compiled source under `registry/src`. [Cargo's cache layout](https://doc.rust-lang.org/cargo/guide/cargo-home.html) and [registry checksum contract](https://doc.rust-lang.org/cargo/reference/registry-index.html) define those inputs. `.cargo-checksum.json` belongs to [vendored directory sources](https://doc.rust-lang.org/cargo/reference/source-replacement.html#directory-sources); ordinary registry downloads need not contain it. The collector requires canonical cache paths, regular no-follow reads, at most 8 MiB per archive and 64 MiB total, and the pinned archive and notice-file hashes. It does not decompress the archive or replace the clean, locked Cargo build with a source audit.

This is a checked attribution policy, not a general license scanner or legal certification. The mapping may contain packages not built for this target; only the actual build selects application dependencies. Some retained toolchain and build-time notices are deliberately broader than the linked binary. A compiler, lockfile or target change needs renewed qualification and any corresponding reviewed mapping update.

For Rust 1.97.1, require both installed copyright reports and the complete installed REUSE license directory, including the MIT, Apache-2.0 and Unicode-3.0 texts. The [distribution recipe](https://github.com/rust-lang/rust/blob/1.97.1/src/bootstrap/src/core/build_steps/dist.rs) installs these under `share/doc/rust`. The legacy `COPYRIGHT`, `LICENSE-MIT` and `LICENSE-APACHE` files belong to the archive's [non-installed overlay](https://github.com/rust-lang/rust/blob/1.97.1/src/bootstrap/src/utils/tarball.rs), not its installed component; the collector does not require them from the sysroot. Selected standard-library source notices and native package attribution remain mandatory.

Run the focused source checks with:

```text
bun run release:linux:notices:check
bun run release:linux:runner:check
bun test scripts/release/workflow.test.ts
```

These synthetic and local process tests do not impersonate a GitHub run or establish the Ubuntu package layout. The real main-only workflow supplies that evidence.

The common-license reference parser admits only the 17 basenames shipped by Ubuntu Jammy's [base-files package](https://packages.ubuntu.com/jammy/amd64/base-files/filelist). It preserves version dots such as `LGPL-2.1`. An unquoted reference may end with one sentence period immediately before ASCII whitespace or end of input; a quoted reference requires its matching closing delimiter. Empty or unknown names, doubled periods, path/query/encoded suffixes and a period inside quoted text are refused before that package's common-license lookup. Every admitted path still requires canonical resolution inside `/usr/share/common-licenses` and a bounded regular-file read.

## Report contract

The validator accepts only schema `1`, profile `linux-cli-v1`, Rust `1.97.1`, Node 24, the fixed target, and a bounded sorted SONAME list. Reports must be canonical JSON with one final LF. `validateLinuxQualificationReport` re-encodes the normalized facts and refuses byte changes, unsupported profiles, incomplete smoke/notices, invalid identities and oversized input. It returns an owned byte copy and digest; callers must still bind those facts to the exact executable and source bytes before assembly.

Run the focused contract with:

```text
bun run release:linux:qualification:check
```

A passing report alone never enables authentication, enrollment, uploads, background collection, native custody or updates. Qualified immutable publication and authenticated acquisition remain separate gates. The first profile is Linux-only; it makes no macOS or Windows installation claim.
