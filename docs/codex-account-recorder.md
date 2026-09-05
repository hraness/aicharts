# Codex account recorder

The account recorder samples which signed-in Codex account is active without retaining account identities. For an attributable ChatGPT account, the same run also records the current Codex quota buckets and available full-reset-credit count through the read-only Codex app-server contract. These samples support account-aware reset detection and a privacy-bounded aggregate plan comparison, but they cannot reconstruct switches or quota changes that happened before recording began.

## Privacy boundary

`scripts/record-codex-account.ts` reads and parses the private `$CODEX_HOME/auth.json` file, defaulting to `~/.codex/auth.json`, but uses only `auth_mode` and `tokens.account_id`. It creates a local 256-bit secret, immediately converts the account ID to an HMAC-SHA256 fingerprint, and discards the parsed auth document. It never writes or prints the raw account ID, email address, access token, refresh token, or ID token. It persists keyed fingerprints only inside the private ledger and never prints them.

The secret and private observation ledgers live under `${XDG_STATE_HOME:-$HOME/.local/state}/aicharts/gpt-subsidy/`. The directory is mode `0700`; the secret and ledgers are mode `0600`. A derived private key ID binds both ledgers to the same HMAC key. After the first public aggregate, the publisher also keeps a private mode-`0600` continuity marker containing only that key ID, ledger creation times, and monotonic record-count floors. It contains no fingerprint or quota value and prevents a reinstall, replacement, truncation, or re-key from silently lowering already-published evidence. If the key disappears or changes while a ledger exists, recording fails closed rather than mixing incomparable fingerprints. The account ledger contains only:

- first and last observation times for each private fingerprint;
- compact intervals for the current fingerprint or an unavailable state;
- bounded auth-mode and subscription-verification statuses.

The quota ledger contains only:

- the private account fingerprint active for each compact observation interval;
- provider-defined limit IDs and bounded plan types;
- primary and secondary used percentages, window durations, and reset timestamps;
- the number of available full-reset credits;
- detected reset boundaries with their classification, prior and current percentage, fresh 100-percent capacity, and a lower bound on the percentage restored.

The recorder starts a fresh Codex app-server process, initializes its JSONL protocol, checks `configRequirements/read`, and then calls `account/rateLimits/read`. It copies the exact already-read `auth.json` bytes into a private mode-`0700` temporary `CODEX_HOME` with a mode-`0600` auth file. It does not copy the real `.env` or user config, removes inherited external token and workload-identity variables, forces file credential storage, and fails closed if managed requirements override that storage. This prevents Codex bootstrap from replacing the fingerprinted file identity with workload identity restored from the real `$CODEX_HOME/.env`. Keyring-only, externally supplied token, and other auth contexts that cannot be tied to the same file fingerprint are not attributed. It does not call `account/rateLimitResetCredit/consume` or any thread, prompt, response, workspace-message, or authentication method. It discards credit IDs, titles, descriptions, account metadata, credit balances, spend controls, and app-server notifications before persistence. Unknown response fields, invalid percentages, unsafe provider IDs, oversized output, and malformed existing state fail closed. The installed wrapper pins the absolute Codex executable resolved at installation time.

Repeated observations extend the current interval rather than appending samples. An account change, logout, invalid auth replacement, or API-key mode starts a new interval. The recorder also starts a new interval after a gap longer than two and a half hours, even when it sees the same account again. This tolerates one missed hourly run plus normal scheduler jitter while keeping the daily 2–7 AM pause out of observed coverage. A private fingerprint distinguishes locally observed account IDs; it does not prove that two accounts have separate paid subscriptions or that either account has a particular commercial plan.

The recorder reads the real auth fingerprint again after the app-server response and before storing quota state. If the account changed during that interval, quota recording fails without attributing the snapshot. The quota observation time is captured immediately after the bounded app-server response rather than at recorder startup, so a scheduled boundary crossed during the read is classified against the response-time state. The child gets a bounded SIGTERM grace period and then SIGKILL fallback, and the recorder waits for process exit before deleting the temporary auth home and settling. Stream failures, timeouts, malformed responses, and successful reads all use the same bounded reaping and cleanup path. Switching away and back between both fingerprint reads remains outside sampled coverage.

The recorder opens the auth file without following symbolic links, reads one opened inode so atomic auth replacements cannot produce mixed bytes, rejects group- or world-readable auth and state files, validates existing ledger structure, writes through atomic same-directory renames, and serializes runs with a private process lock. Corrupt or unsafe state fails closed without printing auth data.

## Reset semantics

The [official Codex app-server contract](https://learn.chatgpt.com/docs/app-server) exposes a multi-bucket snapshot with `usedPercent`, `windowDurationMins`, and `resetsAt`. The [official Codex pricing documentation](https://learn.chatgpt.com/docs/pricing) describes a shared rolling five-hour window and possible additional weekly limits. The provider may expose different buckets for different model families.

The recorder classifies a reset only within the same private account fingerprint, provider limit ID, plan type, window position, and duration:

- `scheduled` means the prior reset timestamp passed and the provider advanced the boundary;
- `reset-credit-correlated` means the provider advanced the boundary early while the available reset-credit count decreased;
- `provider-unscheduled` means the provider advanced the boundary early and used percentage dropped without reset-credit evidence.

An account switch, new bucket, changed plan, changed duration, timestamp correction without a usage drop, or missing reset timestamp is not classified as a reset. A reset-credit correlation is evidence from two sampled values, not proof of a particular backend transaction.

A fresh provider window has 100 percent capacity. The last pre-reset `usedPercent` is a conservative lower bound on the percentage restored because more use may occur between that sample and the reset. The first post-reset sample can already include new use. Codex does not expose a fixed message or token allowance for a bucket, and consumption varies with model, context, reasoning, tools, retrieval, and caching. Absolute messages or tokens per reset must therefore be reported as an empirical estimate joined from aggregate token usage, never as an exact provider entitlement.

## Install

From a reviewed AI Charts checkout:

```sh
./scripts/install-codex-account-recorder.sh install
```

This installs `~/.local/bin/aicharts-record-codex-account`. Installation requires Bun and a resolvable Codex executable. Uninstalling removes the executable but deliberately preserves the private ledgers and HMAC secret:

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
{"kind":"recorded","observedAt":"2026-08-25T12:00:00.000Z","changed":false,"observedAccountFingerprintCount":3,"authMode":"chatgpt","planStatus":"subscription-unverified","rateLimits":{"kind":"recorded","availableResetCreditCount":1,"bucketCount":2,"windowCount":3,"detectedResets":[]}}
```

For an auth mode without an attributable ChatGPT account, `rateLimits` is `{"kind":"not-applicable"}`. A detected reset includes only its classification, duration, prior and current percentage, fresh capacity, and restored-percentage lower bound. It never prints an account fingerprint or provider limit ID.

The command exits `75` when another heartbeat owns the lock. That is a harmless skipped sample. Other nonzero exits require inspection because permissions, app-server input, state, or response shape failed closed.

Sampling can never prove complete coverage. An hourly heartbeat can miss an account used entirely between samples, multiple quota boundaries can pass between observations, and the observed fingerprint count is only a lower bound on accounts used. Keep the fingerprints, quota buckets, and interval history private. The publication enricher clips positive-duration account intervals to each public window and emits only aggregate coverage and counts. It counts a fingerprint in the 31-day Pro-status lower bound only when it has at least one same-key app-server observation in that period and every bucket in every overlapping observation reports `planType: "pro"`; one null, mixed, or non-Pro report excludes it. That is provider-reported plan-status evidence, not billing verification. It never extrapolates from coverage or publishes an identity. Even then, the result is a plan-price upper bound rather than audited subscription spend: the current account hash alone is not evidence of billing dates, purchased credits, or the source of each historical token.
