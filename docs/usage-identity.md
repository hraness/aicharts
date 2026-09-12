# Usage identity and activation

AI Charts binds browser sign-in to Hraness Accounts. Usage collection stays local until separately qualified enrollment and ingestion exist. This design adds no product password database, provider-token forwarding, or public profile endpoint.

## Browser trust boundary

The reviewed Suite Accounts registration is current-only and production-only:

| Field | Exact value |
| --- | --- |
| Consumer | `aicharts` |
| Origin | `https://aicharts.io` |
| Auth mode | `oidc-rp` |
| Client | `hraness:aicharts:production:v1` |
| Callback | `https://aicharts.io/api/suite-auth/callback` |
| Authentication | Accounts email code |

The SDK's validated factory binds these values to its closed provider configuration. Issuer, resource, signing algorithms, token endpoints and JWKS are not application environment overrides. Preview, localhost, retired domains and lookalike hosts have no registration. AI Charts receives no linked-product receipt, billing-return or native authorization grant.

The server adapter delegates authorization-code exchange, S256 PKCE, state, nonce, JWT verification, cookie encryption and refresh rotation to the immutable SDK. Browser routes are limited to `GET start`, `GET callback`, `GET session`, `POST refresh` and `POST sign-out` under `/api/suite-auth`. Other routes and methods cannot reach SDK operations. Cookies remain encrypted, Secure and HttpOnly; OAuth bearers never enter browser JSON or the usage CLI.

Product authorization uses a live-verified server account session and projects only the opaque Suite account ID and expiry. An email address, profile name, browser-provided account ID or numeric upload field is not ownership evidence. Usage ownership must survive account renames. Future enrollment and private query handlers must repeat authorization close to the data operation rather than trusting a page layout.

## Disabled by default

The server requires all of the following before creating a relying party:

- `AICHARTS_USAGE_AUTH_ENABLED=1`.
- Vercel production identity: `VERCEL=1`, `VERCEL_ENV=production`, and `VERCEL_TARGET_ENV=production` when that field is present.
- `NEXT_PUBLIC_SITE_URL=https://aicharts.io`.
- No Preview surface marker: `NEXT_PUBLIC_VERCEL_SURFACE_ORIGIN`, `NEXT_PUBLIC_HRANESS_VERCEL_SURFACE_ORIGIN` or `NEXT_PUBLIC_HRANESS_VERCEL_PREVIEW_ORIGIN`.
- A private `SUITE_OIDC_COOKIE_SECRET` accepted by the SDK's byte-length policy.

The enable flag is an operational fence, not evidence that provider registration or sign-in works. Keep it unset during ordinary operation until qualification passes. A planned, time-bounded production qualification can temporarily enable it after the authority is verified. Enabling opens the browser routes to all eligible Accounts users; absence of a login button is not a test-account restriction. Unset the flag and verify the dormant response if qualification fails. Disabled, incomplete and Preview configuration returns a fixed private, non-cacheable `503` without provider requests or new cookies. No page advertises sign-in in this slice. Refresh and sign-out still require the SDK's same-origin checks; an arbitrary forwarded host cannot select a new authority.

Do not put the cookie secret in a `NEXT_PUBLIC_` variable, test fixture, CLI configuration, analytics event or diagnostic output. Generate production credentials through the owner-controlled secret store. Unset `AICHARTS_USAGE_AUTH_ENABLED` to disable authentication for emergency containment. Rotating the cookie secret invalidates existing browser sessions and requires a reviewed rollout. Neither action deletes usage data.

## Registration and delivery order

Accounts owns client registration. SDK source, authority adoption and public package release have distinct gates:

1. Implement and independently review the Accounts-owned registration change, including additive OTP branding and synthetic authorization tests.
2. Review and merge the SDK registration source with generated artifacts and complete package/browser checks.
3. Publish and verify the immutable SDK release through its separate release gate.
4. Adopt the exact released tag in Accounts, preserving its tag-only dependency checks, then validate, merge and deploy the authority.
5. Consume the released SDK independently in AI Charts with its authentication fence unset.
6. Verify the deployed authority and exact reconciled registration before enabling a bounded product qualification.

The SDK's Accounts-service ownership rule does not require the authority PR to merge before publication. Accounts' executable dependency gates require released tags. Do not substitute a source-commit pin or weaken those gates to create a cross-repository merge order.

A successful factory call or package installation does not establish live provider authority. The synthetic Accounts flow covers branded email-code context, exact callback, PKCE and token claims without sending mail or using a real account. Live qualification must separately prove canonical deployment identity, sign-in, callback, refresh, sign-out, wrong-origin denial and non-disclosure of bearer tokens. Record evidence before exposing a login action. A failed qualification leaves the fence disabled; do not bypass it with a localhost or Preview client.

## Device enrollment boundary

Accounts currently provides browser authorization, not a device grant. The planned CLI pairing service belongs to AI Charts and accepts only a freshly authorized browser account. It must issue separately revocable upload-only credentials; a daemon never receives an Accounts access or refresh token.

The current server account accessor verifies the existing account against live userinfo. It does not establish authentication age, fresh intent-bound sign-in or pairing approval. Those protections require additional durable intent state and an explicit approval flow before enrollment can be activated.

Pairing needs durable, bounded state, not an in-memory map in a serverless route. The design must handle expiration, guess limits, response loss, concurrent approval, account confirmation in the terminal and revocation at final ingestion admission. Upload credentials must not retrieve profile data or recover the account's deduplication namespace. A fresh browser-approved pairing is required for namespace recovery.

The dormant [Usage Worker primitives](usage-worker.md) implement internal pairing, separately reserved account enrollment and numeric-only R2 staging. The server-only pairing coordinator consumes immutable Suite Accounts v0.6.0 fresh completion internally. It seals the intent, attempt, browser nonce and context capability in a canonical, versioned 190-character context, then records only the SDK-verified account, signed authentication time and earliest evidence expiry against that exact durable attempt. It returns the SDK continuation only after an exact successful recording response. Authentication completion never approves or enrolls a device and never returns a verification DTO for browser code to forward.

The factory's `startPairingAuthentication`, `completePairingAuthentication`, `readPairingApproval` and `decidePairingApproval` methods are not connected to public routes. Dormant [HTTP adapters and a public Vercel request-context binding](usage-pairing-http.md) exist, but no production intent resolver or Worker route installs them. Start accepts only an exact `{ intentId }` object from trusted product orchestration. It requires the canonical GET start URL without query parameters, same-origin fetch metadata and no conflicting Origin header. The server generates independent browser-nonce and CSRF tokens for the new attempt.

The memory-only [pairing transport codec](usage-pairing-transport.md) defines exact bounded bytes for the four existing durable methods. It independently checks the request before accepting a response, preserves operation/account/decision correlation, and refuses unknown fields and noncanonical bytes. It authenticates nobody, selects no Durable Object and enables no route; workload identity, HTTP limits, RPC result disposal and uncertain-outcome reconciliation remain adapter responsibilities.

The dormant [coordinator verifier](usage-coordinator-verifier.md) implements the expected Vercel workload identity policy with request-owned work and a bounded completed-public-key cache. The HTTP client acquires a token only from the current platform context; neither adapter has a production caller. Local real-RPC checks use synthetic authority and do not establish live provider compatibility, generic HTTP disconnect behavior, fleet-wide abuse controls or activation readiness.

The `__Host-aicharts-usage-pairing` cookie retains the attempt proof, CSRF token and original lifetime in a fixed binary format. AES-GCM encryption uses a purpose-separated key derived from the private cookie secret. The cookie is Secure, HttpOnly, SameSite=Lax and host-only, and expires within ten minutes. Its exact canonical encoding rejects duplicates, tampering and additional fields. Callback completion requires every proof field to match the SDK-sealed context. A second attempt replaces the first browser cookie; approval reads and decisions reject stale attempt proofs without spending the terminal's guessing budget. The existing authentication-recording method retains its proof-failure budget.

Approval reads require an exact same-origin GET to `/api/usage/pairing`; decisions require POST at the same URL, same-origin fetch metadata and the canonical Origin. The POST accepts only `application/json` containing `decision` followed by `csrfToken` in canonical JSON, with no content encoding, a 512-byte limit and a five-second read budget. Invalid CSRF fails before provider or durable calls. Each operation verifies the current account through live userinfo and requires it to match the fresh authentication recorded for this attempt. The durable decision transaction independently checks that both the recorded authentication and live session remain unexpired when it commits. Reads cannot approve or deny, though they can expire an unfinished intent.

Successful reads and decisions return only `schemaVersion`, `state`, opaque `accountId`, earliest `expiresAtMs` and the attempt's stable `csrfToken`, under private, non-cacheable headers. They never project the attempt proof, encrypted cookie, OAuth tokens or email. The original cookie and CSRF token remain unchanged until expiry so a browser can read back an uncertain decision. An identical live decision retry is idempotent; denial cannot undo terminal confirmation. Approval still grants no upload credential or account namespace.

Public integration still needs an explicit callback dispatcher that selects fresh pairing or ordinary login before exchanging a code, with no fallback between modes. An admitted ordinary login start must also cancel pairing custody because both SDK modes share one transaction-cookie slot. These route and browser-UI behaviors are not implemented or live-qualified by the internal methods.

Both provider and durable work require the production fence. Pairing checks configuration again after asynchronous work and before each provider request, rejects expiry or observed clock regression, and stops new provider requests when the fence or cookie secret changes. It cannot cancel a request already dispatched. A failed or lost durable reply returns a fixed failure with no successful session cookie or continuation; the write may nevertheless have committed. Reconcile the attempt before starting a new login. Do not retry the OAuth code or treat authentication recording as consent. Ordinary login and refresh still cannot produce pairing authentication.

Legacy local namespace keys determine both occurrence IDs and source-checkpoint IDs. Replacing one silently with an account key would break the private ledger and could count history twice. The explicit [shadow reindex commands](usage-local.md#prepare-an-account-bound-shadow) reread native identities while preserving the original ledger, checkpoint key and pending revisions. New split-key ledgers bind both keys and namespace version without changing legacy fingerprints. Active promotion and ranked upload remain disabled pending complete credential custody, sender and ingestion qualification; automatic reset or silent namespace reminting is not recovery.

The internal enrollment primitive requires both original secret preimages and resolves a durable reservation itself. It preserves one account namespace in a fixed immutable R2 anchor, records device/receipt state atomically and cannot reactivate a revoked receipt. Namespace readback requires live pairing authority, not merely a committed receipt. Explicit fresh-reservation recovery can finish retained pending genesis without enrolling its expired original credential. Public/CLI integration, credential custody and live recovery qualification remain unfinished; the internal methods are not a live device service. [Usage Worker boundaries](usage-worker.md#internal-account-enrollment) owns the exact recovery limits.

Shared social/avatar profiles and accepted remote measurement storage remain separate implementation work. The existing private Accounts profile includes fields that must not be copied to a public leaderboard. A future public profile requires an explicit bounded projection and publishing consent.

## Validation contract

Focused tests exercise the real SDK with synthetic transport and identity data. They must prove disabled configurations make no network requests, origin and method substitutions fail, callback failures do not reflect input, responses cannot be cached, and browser/product projections omit OAuth tokens and email. Property tests cover configuration mutations and forged cookies; deterministic cases cover unsafe return paths. The Next.js production build enforces the server-only boundary.

Run the repository's complete `bun run check` after integration. Production verification must confirm the expected deployed commit and the dormant `503` contract without sending an email or enabling collection. A complete browser flow, upload round trip and revocation/recovery qualification remain explicit activation gates.
