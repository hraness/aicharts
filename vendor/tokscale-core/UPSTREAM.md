# Tokscale parser source provenance

This private, unpublished Rust crate is derived from [junhoyeo/tokscale commit d8fd670a46857e5290e71b10245dc522a344fc17](https://github.com/junhoyeo/tokscale/commit/d8fd670a46857e5290e71b10245dc522a344fc17), committed 2026-09-18, upstream workspace version 4.17.0. Source was obtained from the official GitHub repository on 2026-09-19. The root LICENSE preserves the MIT copyright and permission notice. UPSTREAM-SHA256SUMS records the original bytes of every copied Rust source file before local changes.

Only the core library source and synthetic parser fixtures are included. No upstream CLI binary, provider credentials, hosted submit service, or user data is included. This is a private implementation dependency, not an endorsed or independently published Tokscale distribution.

AI Charts changes:

- A standalone unpublished manifest unifies rusqlite with the owning workspace at 0.40.2, enables bounded SQLite query hooks/limits, and disables tracing output that could disclose private source paths. Upstream network-related dependencies remain compiled because the original core includes pricing/report APIs; the HTTP constructor is disabled in this private build.
- `offline::collect`, `offline::collect_profile`, and `offline::collect_since` are the admitted entry points. Exclusive source profiles support all 53 primary clients, the disjoint native Synthetic store and the overlapping 9Router selector. Profiles require explicit usage-store directories, including companion stores or their common application directory; even a broader approved home cannot authorize reads outside the selected profile. Dedicated SQLite and shared parser lanes retain upstream ownership and deduplication. Multiple copies of a single authoritative Kilo, Goose, Kiro, ZCode or Copilot database refuse with `import_profile_store_ambiguous`, rather than guessing at account ownership. Every import requires an explicit client and approved roots, disables environment discovery, passes no pricing service, uses only in-memory source cache, and pins day buckets to UTC. It is synchronous and uses a bounded parser worker pool.
- `offline_io` provides a serialized audit shared by Rayon workers: admitted regular-file reads, no symlinks/special files, byte/file/entry/row/depth ceilings, cooperative time limits, source stability checks, static failure reasons, and read/syntax/SQL/decompression diagnostics. JSONL/NDJSON input uses private temporary immutable file captures. Supported macOS filesystems use descriptor-bound copy-on-write clones; exact unchanged inode/ctime/mtime/size verifies stable sources without rereading their contents, while changed sources require complete-prefix SHA-256 comparison. Other filesystems copy with a 2 GiB free-space reserve; appends can wait for the next scan, unfinished tail lines are counted in the receipt, and rewrites/shrink/replacement fail. Captures are closed between reads and removed at completion. Directory additions do not invalidate the already captured inventory. It is an application boundary, not an OS sandbox.
- The offline generic and Codex paths skip discarded cache construction, message clones and source fingerprints. Devin Desktop shares one metadata lookup per import. SIMD syntax validation constructs one complete tape before typed deserialization, so a schema mismatch cannot hide malformed trailing data. Streamed logs admit up to 2 GiB and bounded 64 MiB lines (real archived Codex records reached 31.4 MB during qualification); whole-file materialization remains 256 MiB.
- `collect_since` bounds file enumeration for the transcript-log clients (Codex, Claude Code): a source file last modified before the report's lower bound cannot hold a record inside the window, since a record's timestamp never exceeds the mtime of the file carrying it. The serialized audit applies the bound at walk admission — directories still descend, so a file written inside the window under an older directory is still found — and only for single-client contexts; multi-source ownership contexts (Devin CLI/Desktop, OpenClaw/Codex) keep complete scans because their identity lanes need every historical file. Counter-style clients keep full scans as well, since a delta baseline can live in an older file.
- SQLite connections are read-only/query-only with a short busy timeout, size limit and progress deadline. The per-source progress deadline and the overall audit deadline scale with admitted SQLite source bytes (32 MiB/s floor, 60 s minimum, 600 s per-source cap, 1800 s absolute audit ceiling), because an unindexed timestamp column forces a leaf-page scan whose cost follows store size; a large authoritative store such as Devin CLI's `sessions.db` is refused only after its bounded scaled budget, never silently truncated. Each parser connection holds a read transaction; ordinary concurrent WAL changes do not invalidate that transaction. An optional report lower bound skips only Devin CLI rows whose integer completion time is earlier; later writes remain eligible for duration back-anchoring, and Desktop overlap resolution still scans complete CLI identities. Different files/connections are not one globally atomic filesystem snapshot. A failed or unrecognized database query cannot become an empty successful client snapshot.
- Cross-source ownership is preserved for combined Devin CLI/Desktop and Codex/OpenClaw contexts. Default all-client enumeration excludes the overlapping 9Router selector; native Synthetic rows are separate from Synthetic gateway filters on other clients.
- A local `tokens_estimated` field preserves CommandCode/ZCode fallback evidence. Freebuff is estimated, Kiro is conservatively estimated, and Crush/Warp token evidence is unavailable. Every all-zero token row is conservatively unavailable because upstream rows do not consistently retain field-presence evidence, so cost-only records are never mislabeled measured. This field is not an upload schema.
- Source cost provenance preserves valid recorded zero separately from missing values for Amp, Trae, Warp, Crush, RooCode, OpenClaw, Synthetic and Mux; incomplete Mux bucket costs stay unknown. Hermes retains actual-versus-estimate provenance; mixed aggregate cost is conservatively estimated. Amp credits retain upstream USD units, consistent with [Amp’s pricing documentation](https://ampcode.com/docs/pricing) checked 2026-09-19. Hindsight uses its reported total to resolve inclusive cached input into disjoint buckets.
- Upstream parser tests and fixtures remain available for explicit focused testing; default dependency builds do not run the upstream test suite. AI Charts boundary tests live in crates/aicharts-import.

Limits and claims:

The library imports known local source formats. It does not acquire Cursor, Trae, Warp, Antigravity IDE or Hindsight remote usage, authenticate any account, or capture MiniMax headless streams. Existing caches can be read. Source cache absence, well-formed unknown schema records, source-native estimates, aggregate counters and timestamp fallbacks must remain visible in product readiness claims. Detected malformed/read/SQL/limit failures reject the entire client result; successful parsing is not proof that every upstream application version or every private account has been live-qualified.

Modified or added Rust files:

- `src/aggregator.rs`
- `src/cc_mirror.rs`
- `src/http.rs`
- `src/lib.rs`
- `src/message_cache.rs`
- `src/offline.rs`
- `src/offline/tests.rs`
- `src/offline_io.rs`
- `src/offline_clone.rs`
- `src/opencode_model_name.rs`
- `src/scanner.rs`
- `src/scanner/profile.rs`
- `src/scanner/profile/tests.rs`
- `src/sessionize.rs`
- `src/sessions/amp.rs`
- `src/sessions/antigravity.rs`
- `src/sessions/augment.rs`
- `src/sessions/cherrystudio.rs`
- `src/sessions/claudecode.rs`
- `src/sessions/cline.rs`
- `src/sessions/codebuff.rs`
- `src/sessions/codex.rs`
- `src/sessions/commandcode.rs`
- `src/sessions/copilot.rs`
- `src/sessions/copilot_desktop.rs`
- `src/sessions/copilot_vscode.rs`
- `src/sessions/cost_provenance_tests.rs`
- `src/sessions/crush.rs`
- `src/sessions/cursor.rs`
- `src/sessions/devin.rs`
- `src/sessions/droid.rs`
- `src/sessions/dsh.rs`
- `src/sessions/freebuff.rs`
- `src/sessions/fx.rs`
- `src/sessions/gemini.rs`
- `src/sessions/gjc.rs`
- `src/sessions/goose.rs`
- `src/sessions/grok.rs`
- `src/sessions/hermes.rs`
- `src/sessions/hindsight.rs`
- `src/sessions/jcode.rs`
- `src/sessions/junie.rs`
- `src/sessions/kilo.rs`
- `src/sessions/kimi.rs`
- `src/sessions/kiro.rs`
- `src/sessions/lmstudio.rs`
- `src/sessions/mcode.rs`
- `src/sessions/mod.rs`
- `src/sessions/mux.rs`
- `src/sessions/openclaw.rs`
- `src/sessions/opencode.rs`
- `src/sessions/opencode_schema.rs`
- `src/sessions/opencodereview.rs`
- `src/sessions/pi.rs`
- `src/sessions/qwen.rs`
- `src/sessions/reasonix.rs`
- `src/sessions/roocode.rs`
- `src/sessions/synthetic.rs`
- `src/sessions/tencent_buddy.rs`
- `src/sessions/trae.rs`
- `src/sessions/utils.rs`
- `src/sessions/warp.rs`
- `src/sessions/zcode.rs`
- `src/sessions/zed.rs`
