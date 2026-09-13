# Linux CLI qualification report

The nonpublishing `Qualify Linux CLI` workflow joins exact Git source reading, a fresh Linux build, executable checks and a new-directory installation smoke. Its `scripts/release/run-linux.mjs` runner supplies the measured facts to `scripts/release/linux-qualification.mjs`; the latter remains a bounded report validator, not a compiler or authenticator.

This is qualification infrastructure, not an authenticated public release. A workflow definition or a passing local test does not establish that its Linux run passed. Keep public download instructions disabled until the actual run and separate provenance/acquisition gates pass.

## Latest hosted result

The [13 September run 34747553925](https://github.com/hraness/aicharts/actions/runs/34747553925) used PR 210 merge `b2af609f58d3a1b76276120efaac0f9e8e045d5d`, tree `b69a59a73fcb20881cfa5232cf38300dc7cc395c`, on Ubuntu image `20260907.292.1`. Exact source/build checks, ELF/runtime validation and all 14 CLI smokes passed. Notice collection then refused `notices_unknown_native`, reported by the runner as `notices_incomplete`, before archive assembly and installation. There is no successful qualification artifact from this run.

The retained summary does not identify the offending GNU `LOAD` input. The current candidate admits the narrow glibc `libutil.a` compatibility input under existing `libc6-dev` ownership checks and adds fixed native diagnostic categories for the next refusal. It also maps the new pinned HTTPS dependency graph and ring's generated archives/notices. These source changes do not prove which input failed or that the hosted notice gate is repaired. Renew qualification from the next protected-main merge after the complete integration gate passes.

## Run one qualification

Dispatch `.github/workflows/cli-release.yml` on the canonical repository's protected `main`. It has read-only repository permission, no production secrets and no publication job. The workflow checks out its exact event commit, installs the fixed toolchain, and creates a private scratch parent before running:

```text
node scripts/release/run-linux.mjs --repository ABSOLUTE_CHECKOUT --commit EXACT_COMMIT --tree EXACT_TREE --output ABSENT_OUTPUT_CHILD
```

The runner requires the GitHub Ubuntu 22.04 x86-64 environment and matching main/commit/workflow identity. Those environment checks constrain the intended job; they do not make a locally fabricated environment authentic. The output child must not exist, and its parent must already be user-owned mode 0700. The runner never overwrites an installation or removes its scratch files after failure.

The runner and its imported release modules are trusted bootstrap code from the workflow's exact checkout. The Git reader verifies the selected build source, not the already-loaded JavaScript runtime. A standalone call to `runLinuxRelease` does not authenticate its caller, bootstrap code or environment; the report must not be presented as doing so.

Cargo fetches the locked public dependencies into a fresh private cache. Compilation then uses the offline locked source and one release build. No provider logs, personal keys, user ledger or production service are inputs. The source and target directories, compiler cache and synthetic smoke state remain in scratch, outside the archive.

Success retains the assembler's five exact files under `assets/`, `qualification.json` and a bounded `summary.json`. A failed job retains no successful qualification artifact; its bounded summary identifies the failing stage. The workflow uploads only those explicit outputs for seven days, never caches, private build evidence or the entire scratch directory. These public-repository artifacts are temporary test results, not immutable GitHub Releases or installation authority.

An ELF refusal also records a fixed predicate code and bounded observations: recognized system-library names, numeric version requirements, and counts or redaction markers for unsupported values. This summary does not include arbitrary tool output, unknown names, paths or compiler diagnostics. These observations explain a refusal; they do not relax the compatibility policy or establish a successful run.

Native notice refusals can include a source-owned `nativeCategory` for build-script identity/links/paths, generated archives, linker inputs, Rust libraries or system/runtime attribution. Only the fixed category allowlist crosses into the summary; arbitrary package names, paths and tool output remain excluded. The earlier run above predates these categories and cannot be diagnosed more precisely from its summary.

The receipt stays in private staging until archive and installation checks finish. The final create-only receipt and successful job outcome establish completion; the diagnostic summary is not a substitute. Failed scratch may contain partial assets, which the successful-artifact upload step does not select.

## Measured compatibility and attribution

The runner fixes GCC 11, GNU bfd, Rust 1.97.1 and the x86-64 compiler baseline. It checks the actual ELF interpreter, direct dependencies, version requirements, writable/non-executable stack, absence of embedded library search paths, and the available runtime libraries. A native smoke run on the hosted runner does not prove execution on every historical x86-64 processor; the summary states that limitation.

The fixed glibc loader may also be a direct `DT_NEEDED` dependency. glibc's [libc linker script](https://sourceware.org/legacy-ml/libc-alpha/2013-05/msg00231.html) includes the loader through `AS_NEEDED`; [GNU ld](https://sourceware.org/binutils/docs/ld/Options.html) can retain that dependency when it resolves required symbols. The resolved `ld-linux-x86-64.so.2` must match the canonical `/lib64/ld-linux-x86-64.so.2` interpreter, and its requested symbol versions must exist in that exact runtime. The same runtime hash, notices and archive dependency inventory checks apply.

`scripts/release/linux-notices.mjs` joins Cargo's actual compiler-artifact messages with the GNU bfd map and installed runtime libraries. The checked mapping in `distribution/cli/linux-notices.json` binds selected registry package versions, package checksums and original notice hashes. Unknown compiled packages, native inputs or missing notices refuse qualification. The collector includes the bundled SQLite statement, Rust copyright and runtime license material, and the owning Ubuntu packages' notices and referenced common licenses. A hashed Cargo linker output must contain the same bytes as the executable supplied to assembly.

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

## Report contract

The validator accepts only schema `1`, profile `linux-cli-v1`, Rust `1.97.1`, Node 24, the fixed target, and a bounded sorted SONAME list. Reports must be canonical JSON with one final LF. `validateLinuxQualificationReport` re-encodes the normalized facts and refuses byte changes, unsupported profiles, incomplete smoke/notices, invalid identities and oversized input. It returns an owned byte copy and digest; callers must still bind those facts to the exact executable and source bytes before assembly.

Run the focused contract with:

```text
bun run release:linux:qualification:check
```

A passing report alone never enables authentication, enrollment, uploads, background collection, native custody or updates. Qualified immutable publication and authenticated acquisition remain separate gates. The first profile is Linux-only; it makes no macOS or Windows installation claim.
