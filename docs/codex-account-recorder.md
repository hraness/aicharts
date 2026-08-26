# Codex account recorder

The account recorder samples which signed-in Codex account is active without retaining account identities. Those samples can support future aggregate attribution coverage, but they do not assign token usage by themselves and cannot reconstruct switches that happened before recording began.

## Privacy boundary

`scripts/record-codex-account.ts` reads and parses the private `~/.codex/auth.json` file but uses only `auth_mode` and `tokens.account_id`. It creates a local 256-bit secret, immediately converts the account ID to an HMAC-SHA256 fingerprint, and discards the parsed auth document. It never writes or prints the raw account ID, email address, access token, refresh token, or ID token. It persists keyed fingerprints only inside the private ledger and never prints them.

The secret and observation ledger live under `${XDG_STATE_HOME:-$HOME/.local/state}/aicharts/gpt-subsidy/`. The directory is mode `0700`; the secret and ledger are mode `0600`. A derived private key ID binds the ledger to its HMAC key. If the key disappears or changes while a ledger exists, recording fails closed rather than mixing incomparable fingerprints. The ledger contains only:

- first and last observation times for each private fingerprint;
- compact intervals for the current fingerprint or an unavailable state;
- bounded auth-mode and subscription-verification statuses.

Repeated observations extend the current interval rather than appending samples. An account change, logout, invalid auth replacement, or API-key mode starts a new interval. The recorder also starts a new interval after a gap longer than two and a half hours, even when it sees the same account again. This tolerates one missed hourly run plus normal scheduler jitter while keeping the daily 2–7 AM pause out of observed coverage. A private fingerprint distinguishes locally observed account IDs; it does not prove that two accounts have separate paid subscriptions or that either account has a particular commercial plan.

The recorder opens the auth file without following symbolic links, reads one opened inode so atomic auth replacements cannot produce mixed bytes, rejects group- or world-readable auth and state files, validates existing ledger structure, writes through an atomic same-directory rename, and serializes runs with a private process lock. Corrupt or unsafe state fails closed without printing auth data.

## Install

From a reviewed AI Charts checkout:

```sh
./scripts/install-codex-account-recorder.sh install
```

This installs `~/.local/bin/aicharts-record-codex-account`. Uninstalling removes the executable but deliberately preserves the private ledger and HMAC secret:

```sh
./scripts/install-codex-account-recorder.sh uninstall
```

## Heartbeat

Run the installed command once per hour between 7 AM and 2 AM local time:

```sh
$HOME/.local/bin/aicharts-record-codex-account
```

Successful output contains only a bounded JSON status such as:

```json
{"kind":"recorded","observedAt":"2026-08-25T12:00:00.000Z","changed":false,"observedAccountFingerprintCount":3,"authMode":"chatgpt","planStatus":"subscription-unverified"}
```

The command exits `75` when another heartbeat owns the lock. That is a harmless skipped sample. Other nonzero exits require inspection because permissions, state, or input failed closed.

Sampling can never prove complete coverage. An hourly heartbeat can miss an account used entirely between samples, and the observed fingerprint count is only a lower bound on accounts used. It is not a count of Pro subscriptions. Keep the fingerprint count and interval history private. A future aggregate adapter may use the samples to disclose partial observation coverage and a lower-bound account count, but the recorder alone cannot support a subscription-adjusted estimate. The current account hash alone is not evidence of subscription price, quota tier, weekly exhaustion, purchased credits, or billed cost.
