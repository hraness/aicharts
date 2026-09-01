# GPT subsidy publication

The local publisher reads the aggregate Codex ledger, updates the checked GPT subsidy series, validates the repository, pushes a single data-file commit to `main`, and waits for the matching production page.

## Files

- `scripts/update-gpt-subsidy.ts` calculates the checked series.
- `scripts/publish-gpt-subsidy.ts` owns the bounded Git transaction, temporary worktree, repository checks, push, and production verification.
- `scripts/gpt-subsidy-automation.sh` installs and runs the publisher from a dedicated clean checkout.
- `scripts/publish-gpt-subsidy.test.ts` covers canonical remotes, exact checkout state, hook isolation, commit attestation, clean publication, concurrent `main` updates, no-op production verification, worktree cleanup, and launcher locking.

The token-ledger adapter and price snapshot are documented separately in `docs/gpt-subsidy-ledger.md`.

The primary public metric is the measured API-retail-equivalent value of the trailing seven complete UTC days. The publisher does not project it to a month or divide it by one subscription price. Historical logs have no durable account attribution, so their subscription-adjusted multiple remains null. The publisher fails closed when its installed ledger adapter carries a different measurement revision. After any reviewed measurement-manifest change, reinstall the adapter with `./scripts/install-gpt-subsidy-ledger.sh` before the next scheduled publication.

## Install

Run this once from a reviewed AI Charts checkout after the publisher is on `main`:

```sh
./scripts/gpt-subsidy-automation.sh install
```

The installer copies the launcher to `${XDG_BIN_HOME:-$HOME/.local/bin}/aicharts-publish-gpt-subsidy` and prepares a dedicated checkout at `${AICHARTS_SUBSIDY_AUTOMATION_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/aicharts/gpt-subsidy-publisher}/repository`.

The scheduled task should invoke the installed launcher directly:

```sh
$HOME/.local/bin/aicharts-publish-gpt-subsidy
```

Do not point the scheduled task at a normal development checkout. The dedicated checkout allows local branches and uncommitted product work to continue without disabling publication.

## Transaction boundary

Each run performs these operations:

1. Acquires a nonblocking kernel file lock. Empty or retained lock files carry no ownership, and a process crash releases the lock automatically.
2. Verifies the dedicated checkout is clean, on `main`, and has canonical `hraness/aicharts` fetch and push URLs.
3. Fast-forwards the dedicated checkout to `origin/main` without resetting or discarding files, then requires local `HEAD` to equal that remote commit exactly. A local-ahead or diverged checkout fails closed.
4. Builds and validates the candidate in a detached temporary worktree at the observed remote commit. Repository checks receive Cloudflare's public always-pass Turnstile test key, matching CI without reading or copying the hostname-restricted production key.
5. Disables repository hooks for its worktree, commit, merge, and push operations. It attests that the new commit has the observed remote head as its sole parent, changes only `data/gpt-subsidy.json`, and leaves the candidate worktree clean before a normal non-force push.
6. Rebuilds from the new remote head when `main` advances concurrently, for at most three attempts.
7. Removes and prunes the temporary worktree on success, no-op, race, timeout, or failure.
8. Verifies that `https://aicharts.io/gpt-subsidy` exposes the checked generation timestamp after both a push and a no-op update. An unchanged local series is not reported healthy while production is stale or unavailable.

Git authentication is noninteractive. Network, dependency installation, calculation, checks, and production verification all have finite deadlines. The launcher exits with status `75` when another publication holds the lock and status `65` when its dedicated checkout violates an invariant.

`AICHARTS_BUN` may select a specific Bun executable. `AICHARTS_SUBSIDY_AUTOMATION_ROOT` and the standard XDG variables may relocate the installed state without involving a development checkout. The installed launcher removes `GPT_SUBSIDY_LEDGER_COMMAND`, `AICHARTS_GPT_SUBSIDY_HOME`, `TOKSCALE_CONFIG_DIR`, and `AICHARTS_SUBSIDY_VERIFY_URL` from its environment so fixture inputs and alternate verification endpoints cannot reach a publishing run.
