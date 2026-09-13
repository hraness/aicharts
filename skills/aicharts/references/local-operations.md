# Foreground local collection

Use only for an explicitly requested local smoke test or a process supervisor that the user already controls. The daemon is intentionally not an installer and does not enable remote sync.

```sh
aicharts daemon --once \
  --state-dir /absolute/private/aicharts-state \
  --key-file /absolute/private/aicharts.key \
  --codex /absolute/path/to/codex-sessions \
  --claude /absolute/path/to/claude-projects --json
```

Without `--once`, the foreground loop runs every 15 minutes by default. `--interval-seconds` is bounded to 60 seconds through 24 hours. `--retry-attempts` accepts `0..8` and defaults to three retries, with bounded 1/2/4-second waits, only for `ledger_busy_retry` and `ledger_changed_retry`. Source changes, malformed input, partial tails, invalid state, and other fixed errors stop the process so a supervisor can diagnose them.

The command requires explicit state, key, and at least one source path. It does not search home directories, install LaunchAgents/systemd tasks, read provider credentials, contact a server, or upload pending records. Keep the state directory and key outside synchronized folders, do not paste key bytes into a prompt, and do not claim that a successful local collection is remote acceptance. Service installation, account pairing, and authenticated transport remain separate unqualified product boundaries.
