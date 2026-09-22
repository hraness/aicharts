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

The server adapter delegates authorization-code exchange, S256 PKCE, state, nonce, JWT verification, cookie encryption and refresh rotation to the immutable SDK. Browser authentication routes are `GET start`, `GET callback`, `GET session`, `POST refresh` and `POST sign-out` under `/api/suite-auth`, each limited to its declared method. The separately guarded private-days route uses the live account accessor described below. Cookies remain encrypted, Secure and HttpOnly; OAuth bearers never enter browser JSON or the usage CLI.

Product authorization uses a live-verified server account session and projects only the opaque Suite account ID and expiry. An email address, profile name, browser-provided account ID or numeric upload field is not ownership evidence. Usage ownership must survive account renames. Enrollment and private query handlers must repeat authorization close to the data operation rather than trusting a page layout.

`beginUsageAccountSession(request)` provides one request-owned live session scope for asynchronous private queries. `read()` performs at most one SDK live-account check and returns only a frozen account ID and expiry. `current()` synchronously rechecks the captured production configuration and cookie secret, canonical origin, abort signal, observed clock floor and eventual session expiry; a refusal stays closed. `finish()` closes the scope without refreshing authority. Request metadata is copied without consuming the product body. New provider calls are refused after closure, while an already dispatched response stays under SDK cleanup before the final projection check. The older `usageAccountSession` accessor retains its behavior and is not a substitute for this cross-await scope.

## Disabled by default

The server requires all of the following before creating a relying party:

- `AICHARTS_USAGE_AUTH_ENABLED=1`.
- Vercel production identity: `VERCEL=1`, `VERCEL_ENV=production`, and `VERCEL_TARGET_ENV=production` when that field is present.
- `NEXT_PUBLIC_SITE_URL=https://aicharts.io`.
- No Preview surface marker: `NEXT_PUBLIC_VERCEL_SURFACE_ORIGIN`, `NEXT_PUBLIC_HRANESS_VERCEL_SURFACE_ORIGIN` or `NEXT_PUBLIC_HRANESS_VERCEL_PREVIEW_ORIGIN`.
- A private `SUITE_OIDC_COOKIE_SECRET` accepted by the SDK's byte-length policy.

The enable flag is an operational fence, not evidence that provider registration or sign-in works. Keep it unset during ordinary operation until qualification passes. A planned, time-bounded production qualification can temporarily enable it after the authority is verified. Enabling opens the browser routes to all eligible Accounts users; absence of a login button is not a test-account restriction. Unset the flag and verify the dormant response if qualification fails. Disabled, incomplete and Preview configuration returns a fixed private, non-cacheable `503` without provider requests or new cookies. The default `/usage` page retains its local-only introduction. Refresh and sign-out still require the SDK's same-origin checks; an arbitrary forwarded host cannot select a new authority.

Do not put the cookie secret in a `NEXT_PUBLIC_` variable, test fixture, CLI configuration, analytics event or diagnostic output. Generate production credentials through the owner-controlled secret store. Unset `AICHARTS_USAGE_AUTH_ENABLED` to disable authentication for emergency containment. Rotating the cookie secret invalidates existing browser sessions and requires a reviewed rollout. Neither action deletes usage data.

## Private daily reads

The source includes `GET /api/usage/days` and a daily dashboard at `/usage`. Both require the independent server flag `AICHARTS_USAGE_PRIVATE_READ_ENABLED=1` in addition to every authentication/production check above and a cookie secret within the SDK's 32–1,024 UTF-8 byte range. Keep both flags unset until their live qualification passes. Enabling browser authentication alone does not enable private reads. The route, session scope and transport recheck private-read availability across awaited work; disabling the flag or rotating the secret stops new provider/Worker dispatch and refuses the eventual projection. Already dispatched work remains subject to its owned cleanup.

The page checks configuration without reading an account session. Its browser client makes one query for the selected 1–31 UTC days; the default is the latest 30 days. Only canonical `firstUtcDay` and `dayCount` query parameters are accepted, in that order, with `Accept: application/json`, same-origin fetch metadata and no request body or Authorization header. The server's `beginUsagePrivateReadSession` uses one SDK read to derive account and expiry. Its `readOutcome()` distinguishes an absent local session from a failed provider check without another account read. Neither browser parameters nor an upload credential can select the queried account.

Responses contain only the bounded numeric projection or a fixed public outcome. A missing local session returns 401, an unenrolled account returns the explicit `not_enrolled` state, and disabled configuration or provider/backend failure returns 503. No account ID, email, expiry or bearer enters this browser DTO. Every result uses private/no-store, Cookie variation, no-referrer and noindex headers. The underlying [Worker query](usage-worker.md#private-daily-query) preserves already initialized state; existing Durable Object constructor initialization or migration still applies when an object starts.

The dashboard shows exact decimal Codex/Claude Code token totals, output-token subsets and occurrence counts with partial coverage; zero does not establish inactivity. Journal time describes the last recorded sync and can include a rejected terminal batch. Date validation rejects calendar overflow and ranges outside 1–31 days. The browser caps decoded response bytes at 16 KiB, checks status and range correlation, starts a 20-second abort timer and ignores superseded results. Compressed Content-Length describes encoded bytes and is not compared with Fetch's decoded stream; an unencoded declared length must match. Results remain in component memory, with no usage persistence, analytics payload or automatic retry. The exact values also appear in a labeled table with a separate row group for each UTC day.

The sign-in action appears only in the enabled dashboard's authentication-required state. Source review and synthetic fixtures do not establish live Accounts sign-in, Worker deployment, accepted remote data, recovery or production dashboard availability. Private-read activation remains separate from enrollment, native upload and public publishing consent.

## Public publishing consent and the public read

The source includes `GET`/`POST /api/usage/consent` and a publishing control in the private dashboard. Consent is a separate recorded decision: private collection never implies public sharing, and a withdrawal durably removes the account from the published index. Both endpoints require the private-read qualification — `AICHARTS_USAGE_PRIVATE_READ_ENABLED=1` plus every authentication/production check above — and stay closed while those flags are unset. The POST body carries only `{consent, publicHandle}`; the server derives account identity and expiry from the live session, so no browser field can assert ownership or an account ID. `GET` answers the recorded status view. Replies are private, non-cacheable fixed states: `ready`, `not_enrolled`, `authentication_required` or a fixed error.

`GET /api/leaderboard` and the `/leaderboard` page are anonymous by design. They are gated only by `AICHARTS_USAGE_PUBLIC_READ_ENABLED=1` plus the production identity checks above — never by the private collection or consent flags, and never by an Accounts session. The route serves only the materialized snapshot from the public index: ranked bounded handles, exact decimal observed-token totals, record counts, the coverage window and verification freshness. No account ID, email, device ID, credential or session field exists in the projection. Responses use a short shared `public, max-age=60` cache. While the flag is unset the route returns a fixed `503` and the page renders its honest paused state; an enabled-but-empty index renders the explicit zero-entry state, never fabricated rows.

A public handle is bounded lowercase text (1–32 characters, digits and single interior hyphens) and is the only identity the public projection carries. Two members claiming the same handle are excluded rather than guessed. Source review and synthetic fixtures do not establish live index materialization, consent writes or production read availability; keep both flags unset until their separate qualifications pass.

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

The current server account accessor verifies the existing account against live userinfo. It does not establish authentication age or fresh intent-bound sign-in. Those protections require additional durable intent state and a recorded fresh authentication before enrollment can be activated.

Pairing needs durable, bounded state, not an in-memory map in a serverless route. The design must handle expiration, guess limits, response loss, concurrent approval, account confirmation in the terminal and revocation at final ingestion admission. Upload credentials must not retrieve profile data or recover the account's deduplication namespace. A fresh browser-approved pairing is required for namespace recovery.

The dormant [Usage Worker primitives](usage-worker.md) implement internal pairing, separately reserved account enrollment and numeric-only R2 staging. The server-only pairing coordinator consumes immutable Suite Accounts v0.6.0 fresh completion internally. It seals the intent, attempt, browser nonce and context capability in a canonical, versioned 190-character context, then records only the SDK-verified account, signed authentication time and earliest evidence expiry against that exact durable attempt. It returns the SDK continuation only after an exact successful recording response. A recorded fresh authentication is the browser approval; the durable transition never enrolls a device and never returns a verification DTO for browser code to forward.

The server's `startPairingAuthentication`, `completePairingAuthentication`, `readPairingApproval` and `decidePairingApproval` methods are connected to guarded browser routes. They require the independent server-only `AICHARTS_USAGE_PAIRING_ENABLED=1` flag as well as every authentication and production check above. The default intent resolver loads the [Vercel request-context transport](usage-pairing-http.md) only after admission and shares one transport factory's capacity. The default Worker entrypoint remains unavailable; these source connections do not establish a live pairing service. Keep the pairing flag unset until the separate live acceptance criteria pass.

The terminal link uses `/usage/pairing#intentId=<64 lowercase hexadecimal characters>`. The browser removes the fragment before checking availability or parsing it, including when pairing is disabled. A valid nonzero intent remains only in component memory and the owned form; it performs no authentication or approval request until the user selects **Continue with Hraness**. Invalid fragments perform no request. A fragment-free callback page reads the original approval once.

The native form sends exactly `intentId=<hex>` in a 73-byte document POST to `/api/usage/pairing/start`, with `application/x-www-form-urlencoded`, canonical Origin and same-origin fetch metadata. The route rejects query parameters, alternative fields, encoding and framing substitutions before SDK work. After bounded body admission, it constructs the coordinator's fixed internal GET start request and exact `{ intentId }` object. The locator establishes no ownership. The coordinator generates independent browser-nonce and CSRF tokens and fixes the SDK continuation to `/usage/pairing`; callers cannot choose a return path.

The memory-only [pairing transport codec](usage-pairing-transport.md) defines exact bounded bytes for the four existing durable methods. It independently checks the request before accepting a response, preserves operation/account/decision correlation, and refuses unknown fields and noncanonical bytes. It authenticates nobody, selects no Durable Object and enables no route; workload identity, HTTP limits, RPC result disposal and uncertain-outcome reconciliation remain adapter responsibilities.

The dormant [coordinator verifier](usage-coordinator-verifier.md) implements the expected Vercel workload identity policy with request-owned work and a bounded completed-public-key cache. The HTTP client acquires a token only from the current platform context; neither adapter has a production caller. Local real-RPC checks use synthetic authority and do not establish live provider compatibility, generic HTTP disconnect behavior, fleet-wide abuse controls or activation readiness.

The `__Host-aicharts-usage-pairing` cookie retains the attempt proof, CSRF token and original lifetime in a fixed binary format. AES-GCM encryption uses a purpose-separated key derived from the private cookie secret. The cookie is Secure, HttpOnly, SameSite=Lax and host-only, and expires within ten minutes. Its exact canonical encoding rejects duplicates, tampering and additional fields. Callback completion requires every proof field to match the SDK-sealed context. A second attempt replaces the first browser cookie; approval reads and decisions reject stale attempt proofs without spending the terminal's guessing budget. The existing authentication-recording method retains its proof-failure budget.

Approval reads require an exact same-origin GET to `/api/usage/pairing`; denial requires POST at the same URL, same-origin fetch metadata and the canonical Origin. The POST accepts only `application/json` containing `decision` followed by `csrfToken` in canonical JSON, with no content encoding, a 512-byte limit and a five-second read budget. Invalid CSRF fails before provider or durable calls. Each operation verifies the current account through live userinfo and requires it to match the fresh authentication recorded for this attempt. The durable decision transaction independently checks that both the recorded authentication and live session remain unexpired when it commits. Reads cannot approve or deny, though they can expire an unfinished intent. An explicit `approve` decision remains accepted for older workers whose recorded attempt is still pending.

Successful reads and decisions return only `schemaVersion`, `state`, opaque `accountId`, earliest `expiresAtMs` and the attempt's stable `csrfToken`, under private, non-cacheable headers. They never project the attempt proof, encrypted cookie, OAuth tokens or email. The original cookie and CSRF token remain unchanged until expiry so a browser can read back an uncertain decision. An identical live decision retry is idempotent; denial cannot undo terminal confirmation. Approval still grants no upload credential or account namespace.

The auth handler selects fresh pairing or ordinary login before exchanging a callback code, with no fallback between modes. One bounded pairing-cookie marker selects the pairing coordinator, which authenticates its custody before SDK completion. Bare or duplicate markers and oversized headers refuse; the SDK independently rejects a transaction of the other mode before provider exchange. Missing pairing custody cannot convert a fresh SDK transaction into ordinary login. A successfully admitted ordinary start expires the pairing cookie because both modes share one transaction slot; rejected or failed starts preserve it. The default pairing resolver is installed behind the separate disabled pairing fence; live qualification remains required.

The approval page displays the exact checked opaque account and separates browser approval from terminal confirmation and enrollment. A completed sign-in approves the collector automatically; the page offers denial until the terminal confirms. Approve and deny each send one canonical decision POST, with approve retained only for a still-pending recorded attempt. An uncertain reply removes decision controls and offers an explicit status GET; there is no automatic mutation retry. Reply expiry removes actions, superseded results cannot restore them, and the client bounds decoded replies and aborts after 20 seconds. Intent and CSRF values are not persisted in URL queries, browser storage or analytics. The page uses the shared header and appearance control, semantic form buttons, visible keyboard focus and responsive account wrapping.

Both provider and durable work require the production fence. Pairing checks configuration again after asynchronous work and before each provider request, rejects expiry or observed clock regression, and stops new provider requests when the fence or cookie secret changes. It cannot cancel a request already dispatched. A failed or lost durable reply returns a fixed failure with no successful session cookie or continuation; the write may nevertheless have committed. Reconcile the attempt before starting a new login. Do not retry the OAuth code; authentication recording is itself the consent boundary and never retries or upgrades an ordinary login. Ordinary login and refresh still cannot produce pairing authentication.

Legacy local namespace keys determine both occurrence IDs and source-checkpoint IDs. Replacing one silently with an account key would break the private ledger and could count history twice. The explicit [shadow reindex commands](usage-local.md#prepare-an-account-bound-shadow) reread native identities while preserving the original ledger, checkpoint key and pending revisions. New split-key ledgers bind both keys and namespace version without changing legacy fingerprints. Active promotion and ranked upload remain disabled pending complete credential custody, sender and ingestion qualification; automatic reset or silent namespace reminting is not recovery.

The internal enrollment primitive requires both original secret preimages and resolves a durable reservation itself. It preserves one account namespace in a fixed immutable R2 anchor, records device/receipt state atomically and cannot reactivate a revoked receipt. Namespace readback requires live pairing authority, not merely a committed receipt. Explicit fresh-reservation recovery can finish retained pending genesis without enrolling its expired original credential. Public/CLI integration, credential custody and live recovery qualification remain unfinished; the internal methods are not a live device service. [Usage Worker boundaries](usage-worker.md#internal-account-enrollment) owns the exact recovery limits.

The dormant [terminal enrollment adapter](usage-terminal-enrollment.md) now provides canonical bytes for initialization, polling, explicit account confirmation, reservation, enrollment and namespace readback. Its Worker factory routes account operations only through the authoritative reservation. The TypeScript and Rust client codecs retain correlation and expiry checks; neither supplies native credential custody or an active login command.

Shared social/avatar profiles and accepted remote measurement storage remain separate implementation work. The existing private Accounts profile includes fields that must not be copied to a public leaderboard. The public projection is now implemented as the explicit bounded consent flow and materialized index above; richer public profile fields still require their own reviewed projection and separate publishing consent.

## Validation contract

Focused tests exercise the real SDK with synthetic transport and identity data. They must prove disabled configurations make no network requests, origin and method substitutions fail, callback failures do not reflect input, responses cannot be cached, and browser/product projections omit OAuth tokens and email. Property tests cover configuration mutations and forged cookies; deterministic cases cover unsafe return paths. The Next.js production build enforces the server-only boundary.

Run the repository's complete `bun run check` after integration. Production verification must confirm the expected deployed commit and the dormant `503` contract without sending an email or enabling collection. A complete browser flow, upload round trip and revocation/recovery qualification remain explicit activation gates.
