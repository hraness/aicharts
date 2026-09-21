# Usage activation runbook

This runbook records the qualifications required to activate Usage. Preserve
working services and enable new behavior only after its current evidence and
rollback checks are complete.

## Recorded production evidence

On September 21 (UTC), commit `3a1ddb93456da39fd6a06037f1902dc81acf2663`
([PR 349](https://github.com/hraness/aicharts/pull/349)) deployed to both
production services after the complete source gate and protected-main checks.
Vercel deployment `dpl_HRUt74pjFKM4bQe6DNkbr7E86TqX` served the canonical
`aicharts.io` alias with the expected project, team, production target, and
source identity. This is a dated inspection; reinspect the alias before using
it as evidence for a later source change.

Worker deployment `4c2b0b07-5838-468d-8161-2b27a84cab46` served version
`8c5d52c9-ad8f-4e2f-ae7d-63571743e23c` at 100% traffic. Provider readback
confirmed all four existing SQLite namespaces, both R2 buckets, enrollment
generation, restore authority, six enabled private flags, and the fail-closed
route. The workers.dev and Preview URLs remained disabled, with no cron
schedules. The private production configuration preserved those identities;
the repository's Wrangler fixture was not used as production configuration.

The first signed-in reads returned HTTP 503 at the fixed diagnostic stage
`rpc_pending`: namespace lookup and method dispatch returned, but the response
did not settle inside the five-second request stage. A later bounded retry on
the same deployment and account succeeded. The dashboard returned 28,028
records with 7,947,800,864 observed tokens and 18,056,507 output tokens across
Codex, Claude Code, and Devin, and the consent read resolved to **Not
publishing**. This establishes current authenticated numeric readback and
consent status for that deployment. It does not establish uninterrupted
latency, current native custody, a new accepted upload, public publication, or
scheduled cutover. A local real-runtime regression keeps the earlier delayed
storage case covered: the request returns `rpc_pending`, the late RPC result
remains owned through settlement, and all eight capacity slots are reusable.

Both `AICHARTS_USAGE_STATS_ENABLED` and `AICHARTS_USAGE_PUBLIC_READ_ENABLED`
remain disabled on both services. Retain Worker version
`c40fc2b2-fce2-4189-8cdb-458bed6e9cda` as the preceding schema-6-aware flags-off
recovery artifact before any detailed-profile activation. Restoring it
contains new operations while retaining stored data and committed ownership;
it does not undo a completed v2 transition. Reinspect its identity before use.
Existing native custody, renewed live acquisition, public
publish/refresh/withdrawal, and scheduled cutover remain unqualified by this
deployment. The old scheduled publisher was preserved.

The 2026-09-19 production inspection superseded the earlier unconfigured
environment inventory. It found that Vercel project `aicharts` had production
authentication, pairing and private-read flags, the cookie secret and the
canonical site URL.
The public-read flag was absent. A correctly framed anonymous request to
`/api/usage/days` returned `authentication_required`; `/api/leaderboard` returned
`unavailable`. These observations prove configuration and refusal behavior,
not authenticated dashboard readback or readiness to replace another collector.
They describe that inspection, not deployment of the current source tree.

That inspection found Usage served by the existing Worker named
`aicharts-usage-local-only`, despite that historical name. Its then-active
version was `36447868-30b8-4cb4-8bcd-cb9fd6913946`, deployed September 16.
Its worker, authentication, enrollment, pairing, admission and private-read
flags were enabled; public reads were disabled. It bound four Durable Object
classes (`PairingIntent`, `AccountEnrollment`, `RestoreFence`, and
`LeaderboardIndex`) and the existing private `aicharts-usage-local-only` and
`aicharts-usage-control-local-only` R2 buckets. Preserve those resource
identities, generation and restore-fence authority during upgrades. Do not
substitute newly named resources or deploy the source fixture configuration
over production. The checked Wrangler file remains a local test fixture.

A retained September 16 qualification record reports a real browser-approved
enrollment and one accepted native upload of 62 occurrences / 5,293,376 observed
tokens, followed by an empty second upload. This is historical evidence, not a
renewed qualification of the current tree. On September 19, the retained CLI
could no longer open that enrollment and returned `attempt_recovery_required`.
Preserve the ledger and custody items; do not reset them to make a new build run.

The collector, private dashboard, public consent and scheduled publisher must
each pass their own current acceptance checks before cutover. A passing source
gate or a configured flag alone does not establish those outcomes.

The exact browser registration is owned by the pinned Suite Accounts SDK and
the binding in `lib/usage/auth-server.ts`:

- origin and site URL: `https://aicharts.io`
- callback: `https://aicharts.io/api/suite-auth/callback`
- client: `hraness:aicharts:production:v1`
- issuer: `https://account.hraness.com`
- discovery: `https://account.hraness.com/.well-known/openid-configuration`
- JWKS: `https://account.hraness.com/api/auth/jwks`

The public discovery and JWKS endpoints are read-only authority checks. They do
not prove that the AI Charts client is registered or that the Vercel secret is
present. The SDK's `createSuiteAccountsClientConfiguration` and the production
deployment identity checks remain authoritative.

## Minimal live Accounts qualification

For a new environment, this can be qualified before enabling the Worker or accepting usage data. It
requires owner access to the Vercel production project, a test Accounts user,
and a private 32–1,024-byte `SUITE_OIDC_COOKIE_SECRET` in the secret store.
Do not put the secret in a shell command, fixture, browser variable, log, or
repository file.

1. Read the production environment *names and targets only*. Confirm
   `VERCEL=1`, `VERCEL_ENV=production`, `VERCEL_TARGET_ENV` absent or `production`, and
   `NEXT_PUBLIC_SITE_URL=https://aicharts.io`. Confirm that all three Preview
   surface markers are absent. Do not read values of secrets.
2. Record a bounded qualification intent containing the deployment ID, commit
   SHA, test account, start time and rollback time. Keep
   `AICHARTS_USAGE_PRIVATE_READ_ENABLED`, pairing, enrollment, admission and
   Worker flags unset.
3. In a production deployment, set only `AICHARTS_USAGE_AUTH_ENABLED=1` and
   the private cookie secret. Verify the disabled `/api/usage/days` response is
   still `503`; authentication alone must not enable usage reads.
4. In a clean browser at `https://aicharts.io/usage`, exercise one fresh email
   code login. Verify the exact callback, state and nonce handling, an opaque
   session account ID, expiry, refresh rotation and sign-out. Verify no access
   or refresh bearer appears in HTML, browser JSON, cookies, URLs, analytics or
   logs.
5. Repeat with a wrong origin/host and an expired or malformed callback. Each
   case must refuse without a new session. Verify the login transaction cannot
   be replayed.
6. If the qualification passes, keep the auth flag enabled and proceed to the
   next activation gate; if it fails, unset it and verify the fixed private
   unavailable response. Preserve the browser and deployment evidence with the
   qualification intent. Authentication can remain usable after a passed test,
   while private reads and collection stay separately fenced.

The recorded production configuration already existed. Reinspect deployment
identity and configuration names before qualification. Do not rotate secrets,
repeat provisioning, or disable a working private service as a side effect of checking
this list. Qualify the current authenticated path with an owner-authorized
account and retain a bounded receipt. The local `bun run test:browser` fixture
is synthetic evidence only.

## Worker and collector order

After Accounts qualification, proceed in this order, with one owner for each
provider operation:

1. Verify the existing Worker, all four Durable Object namespaces and
   the existing R2 buckets. The workload identity is the platform-issued
   `x-vercel-oidc-token` request-context header captured by `@vercel/oidc`;
   there is no CLI token-minting step and `VERCEL_OIDC_TOKEN` is not a production
   fallback. Configure the Worker verifier for the exact claims documented in
   `docs/usage-coordinator-verifier.md`; never forward browser OAuth tokens to
   it. Verify the exact deployment, bindings, disabled public URLs and
   cost/plan limits.
2. Run the private Cloudflare sequence in
   `docs/usage-cloudflare-qualification.md` against generated configs. The
   template configs are intentionally unconfigured; do not deploy them
   directly. Preserve the completed v3 synthetic manifest and its seven
   objects.
3. Qualify the connected native enrollment sequencer, macOS custody
   adapter and production constructor. Verify default User-domain keychain
   selection, signed CLI/LaunchAgent behavior, process-death recovery and
   fresh Accounts pairing. The disposable keychain receipt does not cover
   these cases.
4. Send one bounded native admission batch through the real edge URL. Verify
   exact `Content-Length`, journal readback, correction, revocation and lost
   reply reconciliation. Then exercise the private query against the same
   account and verify corrected totals.
5. Enable private reads for a bounded account test after the preceding
   evidence passes. Keep the read and Worker flags enabled only when their
   qualified evidence and owner decision support continued use; otherwise
   disable them and verify the fixed private response. Retain the result before
   any leaderboard or public publishing decision.

## Stable macOS collector identity

An ad hoc signed executable has a code-hash-specific Keychain requirement.
Rebuilding it can make existing enrollment credentials inaccessible. Use the
checked `bun run custody:signing` workflow to inspect and establish a stable
local signing identity before a new enrollment. Local self-signing does not
establish a notarized or publicly distributed release.

Never remove Keychain access checks, export custody secrets, replace a
checkpoint key, or reset a ledger to repair a build mismatch. For retained
items created under an earlier signature, the documented
[existing-item consent flow](usage-local.md#stable-macos-signing-for-credential-custody)
allows macOS to request access for one process with
`AICHARTS_CUSTODY_INTERACTION=allow`. The operator grants the stable signed
binary access through the native prompt; the CLI does not silently change
the access list. A status read from the verified enrolled state resolves both
pairing and namespace custody. Confirm that enrollment binding, then repeat
with the interaction override unset to verify unattended access. A generic
status response from legacy state is not enrolled-custody proof.

Keep the original authorized binary and retained state available for
reconciliation. A fresh enrollment is a separate operation, not a repair
shortcut. Verify the same signed binary from launchd before replacing an
existing job.

## Cutover acceptance

1. Record the old publisher's schedule and provider coverage. Keep its job and
   data intact while the replacement is being qualified.
2. Compare the same source range locally. Account for UTC versus local-day
   bucketing, unknown cache categories, source exclusions and deduplication;
   differing totals alone do not identify which collector is correct.
3. Inspect a numeric-only outbox, then upload a bounded batch with the enrolled
   collector. Reconcile uncertain results through the retained batch, and verify
   a repeated run does not add usage twice.
4. Read the same dates in the authenticated dashboard and compare exact totals.
   Verify error, empty, expired-session and refresh behavior.
5. Exercise public consent, unique handles, refresh and withdrawal before
   opening rankings. Cached public responses may remain visible for 60 seconds.
6. Qualify scheduled collection and upload with the stable installed binary,
   bounded batches, overlap prevention, observable failures and recovery after
   a missed or interrupted run. Disable the old job only after the replacement
   has completed a successful scheduled cycle and its data is visible.

Current v1 source limits are explicit: the public index holds at most 128
publishers; each account admits at most 100,000 occurrence heads and 4,096
journal revisions. These are bounded rollout limits, not an unlimited
retention promise. The [detailed report](usage-details.md) expands known source
formats and dated retail estimates. The current source implements explicit
Cursor, Trae, Warp, Hindsight, and Antigravity refreshes, MiniMax Code capture,
and one configured `autosubmit` publication cycle. The
[scheduled publisher guide](usage-autosubmit.md) describes configuration and
manual launchd setup; the CLI does not install or switch a LaunchAgent.
These implementations still require relevant live provider, custody, account
readback, and scheduled-cycle qualification before cutover. Public profile
pages and embeddable statistics are not implemented.

## Detailed snapshot profile

The `client-stats-v2` source adds bounded day/client/provider/model snapshots
behind `AICHARTS_USAGE_STATS_ENABLED=1` on both the Worker and Next.js service.
The existing authentication, enrollment, admission, private-read, namespace,
restore-generation, and revocation requirements still apply. Deploying the new
source does not authorize enabling those controls or replacing an existing job
without the cutover evidence above.

V2 uses the existing `AccountEnrollment` Durable Object and private R2 resources.
Its account schema adds control, writer, device-receipt, pending-intent, and
daily-projection tables while preserving v1 records. A client has one device
writer. Exact retries retain their original operation and receipt. Ordinary snapshots preserve historical days and refuse unexplained reductions
in existing numeric observations. Explicit reviewed replacement windows have
a separate mode. Warp replaces only its own latest billing snapshot; its
refresh date never becomes a daily activity total. Queries select the owned
profile for each client/day and never add overlapping v1 and v2 totals. Estimated or unavailable
token observations do not enter reported-token rankings.

For an existing v1 window, the native sender pins the prior revision, head digest
and client owner. The service admits takeover only when every retained day has
at least its prior reported record count and every one of its five token buckets.
A head digest alone is not coverage proof. Empty, missing or incomplete imports,
estimated replacements, stale heads, another writer and unknown-provenance
tombstones refuse. V1 tables and immutable history remain retained. This numeric
preservation guard does not replace live source comparison during cutover.

A terminally refused retained flight requires explicit `stats-sync --abandon`
with the existing state and key. The authenticated operation pins the exact
flight. It either returns its already committed receipt or advances the account
revision to fence a late retry, without consuming the device upload sequence.
It clears only a matching pending intent and keeps immutable objects and byte
reservations. The native checkpoint clears a flight only after correlated
proof; uncertain replies remain frozen. The scheduled publisher never abandons
a flight automatically. A maintenance revision can exist before any published
report; read and recovery paths must not infer publication from revision alone.

Each upload is limited to 4 MiB and 8,192 aggregate rows. Account projections are
limited to 65,536 client-days, 262,144 rows, and 128 MiB. Hosted reads are capped
at 4 MiB and 8,192 rows and return an explicit range-limit result rather than a
truncated total. The complete local report remains bounded at 32 MiB and 65,536
rows. These ceilings are admission limits; production qualification must also
measure the intended user's scan duration and real Worker resource use.

Each account also has an 8 GiB cumulative immutable-object budget and at most
1,000,000 accepted revisions. Admission reserves the snapshot's encoded bytes
plus 1,024 bytes for its receipt before the first R2 write. Exact retries do not
reserve again; an abandoned uncertain intent keeps its reservation. Exhaustion
refuses new data without deleting existing history.

Once account schema 6 has been initialized, a schema-5-only Worker is not a
compatible rollback: its strict schema check refuses the extra tables. Keep a
schema-6-aware rollback artifact and turn off the detailed-profile controls when
needed. Do not delete the new tables to make old code run. Immutable R2 receipt
objects can belong to an abandoned intent; recovery follows the committed SQL
references and must not replay every receipt object found in the bucket.

## External restore fence

The current generation variable and namespace anchor are useful refusal checks,
but they are not an external restore fence. The Worker reads generation from
its environment and the anchor from the control bucket; if both the account
object and control data are restored or deleted together, neither source can
prove that the restored state is stale. The Durable Object history audit and
the immutable admission journal detect missing or reordered local history, not
an administrative rollback of both stores.

That history audit is linear in retained history, so it runs once per object
lifetime before the first write rather than in the constructor. Every path that
commits — the fenced mutations, and the enrollment status read, which settles a
durable observed time and revision — clears it first, as does the leaderboard
projection, whose totals leave the account for the public index. A refusal
poisons the object, so no later transaction on any path can commit onto history
known bad. The constructor still runs the constant-cost control checks on every
rehydration, so a lost or malformed control row, or a schema mismatch, still
fails a read closed.

The remaining tradeoff is scoped to the non-committing private reads: daily
totals, stats status, stats reports and consent can be served between a
corruption and the next audited operation, and would then report unverified
counters. Treat the private dashboard as a numeric view, not as evidence of
history integrity. Nothing published to the public index relies on it.

The implementation in `services/usage-worker/src/restore-fence.ts` provides a
separate control authority. The [operator procedure](usage-restore-fence-control.md)
owns close, drain and publication. Qualify its deployment and recovery before
relying on it to survive an administrative restore; source tests alone cannot
prove independent operational custody. The required recovery behavior is:
use a separately owned, append-only control resource whose
authority survives either store: one account/generation record containing a
monotonic `restoreEpoch`, the active Worker version, and a closed/open state.
The restore operator must close the epoch before restoring either Durable
Object or R2 data, then publish a strictly greater epoch after both stores are
reconciled. While the fence is closed or transitioning, every mutating
enrollment/admission operation returns `recovery_required`. Every operation
reads and records the current epoch and active Worker version; a regression or
mismatch also returns `recovery_required`. A restored object cannot reopen
itself. Recovery must also invalidate old device credentials and reconcile
journal prefixes and namespace anchors before reopening the epoch.

The recovery authority must retain the responsibilities of the narrow `RestoreFence` port:
`read()`, `close(epoch)`, `publish(epoch, deployment)`, and `assertOpen(epoch)`.
The port must also own a lease/drain barrier: closing an epoch first prevents
new operations, waits for already admitted operations to settle, and only then
allows restore. Pre/post checks alone cannot prove that an in-flight commit did
not race the close. The Worker adapter owns the provider-operation lease and
pre-dispatch/post-await checks; a separate operator tool owns the two-store
snapshot, bounded reconciliation and epoch publication. Add tests for
simultaneous object/bucket loss, stale epoch, deployment mismatch, credential
invalidation, in-flight drain and uncertain publish. Do not reuse
`USAGE_ENROLLMENT_GENERATION` as this external authority or silently remint the
namespace.

## Stop conditions and rollback

Stop and leave every usage fence closed on missing authority, ambiguous
deployment state, a lost write/readback, provider response framing drift,
clock regression, restore-fence disagreement, or any credential exposure.
Reconcile an uncertain operation from its retained intent before retrying. Do
not delete namespaces, reset buckets, truncate journals, or replace a key to
make a qualification pass.

The source and local gates remain:

```text
bun run usage:worker:check
bun run check
cargo test --locked -p aicharts-cli --bin aicharts -- enrollment::https::
cargo test --locked -p aicharts-cli --bin aicharts -- upload::https::
```

These commands establish source and local-runtime behavior. They do not replace
the live Accounts, edge, restore or production evidence described above.
