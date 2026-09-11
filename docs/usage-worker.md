# Usage Worker boundaries

The Usage Worker contains internal device-pairing and numeric blob-staging primitives. Its public handler always returns a fixed, private `503`. It has no deployment command, public browser approval route, account enrollment, upload authorization, accepted-usage index or query endpoint. The application has a dormant server-only authentication coordinator, but no production Worker connection. Tests use synthetic local bindings; no live Worker or R2 bucket is provisioned by this source slice.

## Storage split

Pairing requires transactional, durable control state. SQLite-backed Durable Objects provide that state without adding a separate SQL service. Private R2 holds compact measurement frames. R2 alone would require an application-owned transaction coordinator for enrollment, revocation and deduplication. The current pairing object does not yet implement those account-owned operations.

Cloudflare recommends SQLite-backed [Durable Object class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/). The local configuration declares one `PairingIntent` class and one R2 staging binding, disables public Worker/Preview URLs and observability, and contains no production account, route or remote test binding. It is a local fixture configuration, not a qualified deployment target.

## Pairing authority

The internal lifecycle ends at terminal confirmation. That state does not create an account namespace, enroll a device or activate its committed upload credential. The short-lived polling secret and the future upload secret have distinct hash domains and must be independent. Persisted state contains commitments, bounded opaque identifiers, timestamps and counters, never OAuth bearers or transcript fields.

The browser attempt has a random context capability and nonce commitment. The server-only coordinator in `lib/usage/pairing-auth.ts` carries the exact proof inside the SDK's sealed transaction, consumes the verified account and signed `auth_time` internally, and calls only `recordVerifiedAuthentication`. Its narrow server transport port is unconfigured in production. `prompt=login`, a recent token `iat`, a callback response or the existing product session are not sufficient freshness evidence. Ordinary login and refresh cannot produce pairing authentication or approval.

Only the trusted coordinator may record verified authentication through a future qualified server transport. Internal method validation checks its bounded DTO and timestamp relationships; it cannot verify an OAuth signature or manufacture trust from a caller-supplied timestamp. The coordinator maps the SDK's earliest transaction/token expiry to `sessionExpiresAtMs` and withholds its continuation when recording fails or becomes uncertain. Durable recording is idempotent for identical live evidence but never grants consent. A separate same-origin, CSRF-protected approval POST must recheck the live account and consume the same browser-bound attempt. Browser nonce cookie custody is still unimplemented. The CLI must display and explicitly confirm the approved account before enrollment. No public route currently calls these methods.

## Numeric staging

The staging adapter accepts only the v1 binary media type `application/vnd.aicharts.usage-v1`. It bounds the stream to 884,760 bytes, validates the existing wire policy and records, and re-encodes an owned canonical frame before writing. It never persists the raw request, caller headers, filenames, URLs or arbitrary metadata. The authenticated account's routing scope is separate from `Usage.accountId`, which identifies a provider account or subscription observation.

Objects use account-scoped, content-addressed keys. Conditional creation prevents overwrites. Repeated or uncertain writes require bounded readback of the exact canonical bytes and derived metadata. Fixed error codes do not reflect request data. A receipt explicitly says `staged` and `accepted: false`; staged objects cannot feed rankings, billing, private analytics or an acknowledgment that deletes a local outbox entry.

The fixed numeric protocol excludes free-form chat fields, unknown fields and trailing data. It cannot prove honest measurement or prevent a malicious client from encoding information in numeric counters or fixed-width identifiers. Encryption protects transport or storage confidentiality; it does not establish those stronger privacy or anti-gaming claims.

## Validation and activation

Run `bun run usage:worker:check` after installing frozen dependencies. This generates ignored runtime types from the pinned Wrangler configuration, typechecks the Worker independently of Next.js, then runs `*.worker.ts` in Cloudflare's [local Vitest runtime](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/). `bun run check` includes this gate for local integration and both existing CI callers. The test runner has no publish mode and directs its configuration/logs to the ignored local fixture directory. It refuses execution when a legacy user `.wrangler` path exists, because pinned Wrangler prefers that path over XDG configuration. The runner checks existence only and never reads, moves or deletes that personal configuration. These guards do not constitute OS-enforced process isolation.

Local restart helpers preserve Durable Object storage across instance teardown. They test persistence, retry and refusal behavior, not production disaster recovery. Actual SQLite [point-in-time recovery](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api) is unavailable locally and does not restore R2 or other objects. Do not treat R2 object version identifiers as recoverable bucket version history.

Before activation, complete and independently review:

- Authenticated coordinator-to-Worker transport, real fresh-authentication qualification, browser nonce custody, CSRF/live-account approval checks, human-code routing and pre-creation abuse limits.
- Account-owned enrollment, terminal account confirmation, credential custody, stable namespace recovery and explicit local-ledger reindex. Retain original ledger keys and pending history.
- Authenticated admission, per-account deduplication, correction semantics and final-commit revocation checks. An R2 write alone never commits visibility.
- An external recovery fence, immutable receipts and tombstones, bounded reconciliation and credential invalidation after restore. Restored object state must not independently authorize reopening.
- Exact owner/resource/cost qualification, private bindings, workload authority, recovery procedures and a bounded live upload/revocation/readback test. Keep public activation disabled until this evidence exists.

The remaining product work and delivery evidence belong in [the implementation plan](../kb/plans/usage-leaderboard.md). [Usage identity](usage-identity.md) owns the browser registration and activation fence; [the wire contract](usage-wire-v1.md) owns measurement bytes.
