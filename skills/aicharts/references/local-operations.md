# Foreground local collection

Use only for explicitly requested local collection. Resolve an already-installed executable with reviewed provenance and confirm its global `--help` lists the options to be used. Require an existing ledger, its existing key path, and explicit Codex/Claude source paths. Do not build, install, initialize, migrate, or discover private paths to make the mode work. Keep each path as a literal argument, never a shell fragment.

Even `--once` commits local numeric measurements, checkpoints, and pending records. It is not read-only or a dry run. Use it only when one collection pass is authorized; omit it only for an explicitly requested foreground loop. The daemon does not install a service or enable remote sync.

```sh
aicharts daemon --once \
  --state-dir /absolute/private/aicharts-state \
  --key-file /absolute/private/aicharts.key \
  --codex /absolute/path/to/codex-sessions \
  --claude /absolute/path/to/claude-projects --json
```

`--json` is available only with `--once` and must follow that flag. With `--once` but without `--json`, return one text summary. Without `--once`, print text after each successful pass and wait 15 minutes before the next by default. `--interval-seconds` is bounded to 60 seconds through 24 hours. `--retry-attempts` accepts `0..8` and defaults to three retries after the first attempt, with 1/2/4-second waits. Additional retries wait eight seconds each. Only `ledger_busy_retry` and `ledger_changed_retry` are retried. Source changes, malformed input, invalid state, and other fixed errors stop the process; keep the state and report the fixed error without repair.

For an already prefix-enabled ledger, add `--complete-prefix`. It selects `collect-prefix`, which defers a stable unfinished suffix until its newline and preserves the existing full-prefix history checks. Legacy mode stops on that partial tail. A prefix/legacy mode mismatch refuses before source traversal (`ledger_prefix_not_enabled` or `ledger_complete_prefix_required`); do not retry with another mode or migrate implicitly. A changing file during a scan or changed retained prefix still fails. Successful JSON identifies the prefix scan mode and `sourcesWithDeferredTail`; deferral means incomplete coverage, not zero work.

The command reads the selected local key and source bytes, but does not retain conversation bodies. It does not search home directories, install LaunchAgents/systemd tasks, read provider credentials, contact a server, or upload pending records. Ordinary ledger opening can recover SQLite; this is another reason not to use it as an inspector. Keep the state directory and key outside synchronized folders, never read or paste key bytes through agent tools, and do not claim successful local collection is remote acceptance. Do not forward summaries, paths, keys, or frames to benchmark endpoints or other services. Service installation, account pairing, and authenticated transport remain separate unqualified product boundaries.
