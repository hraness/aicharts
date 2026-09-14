# Usage activation runbook

This runbook records the qualifications required to activate Usage. Keep the product flags closed unless the
current step's evidence and rollback check are complete.

## What is currently true

The repository Worker router joins pairing, terminal enrollment, admission and
private daily reads through `services/usage-worker/src/production.ts`. Its
current production deployment remains unqualified. The Wrangler template has no public
Worker URL or route (`services/usage-worker/wrangler.jsonc` sets
`workers_dev:false` and `preview_urls:false`). Public Accounts discovery and JWKS
endpoints are healthy at the exact URLs below. The last inspected Vercel production environment inventory contained only the
existing newsletter and PostHog entries; Usage bindings, authentication values,
and the AI Charts site URL were absent from that inventory. It did not read
secret values and does not prove credentials do not exist elsewhere. No live
Accounts or Usage activation qualification has passed. The repository therefore
has no verified live collector, upload endpoint, or authenticated dashboard, even
though the handlers and local Cloudflare qualification exist in source.

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

This can be qualified before enabling the Worker or accepting usage data. It
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

No provider configuration mutation occurred: the requested Vercel configuration
change was rejected by automatic review. The remaining prerequisite is explicit
owner approval to add `SUITE_OIDC_COOKIE_SECRET` and `NEXT_PUBLIC_SITE_URL` to
the production environment, followed by the bounded qualification above. The
Vercel project must also provide owner-authorized metadata access and a test
Accounts user. Until that evidence exists, activation remains unqualified. The local
`bun run test:browser` fixture is synthetic evidence only.

## Worker and collector order

After Accounts qualification, proceed in this order, with one owner for each
provider operation:

1. Provision or verify the private Worker, both Durable Object namespaces and
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
3. Connect the native enrollment sequencer to the explicit macOS custody
   adapter and production constructor. Qualify default User-domain keychain
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

## External restore fence

The current generation variable and namespace anchor are useful refusal checks,
but they are not an external restore fence. The Worker reads generation from
its environment and the anchor from the control bucket; if both the account
object and control data are restored or deleted together, neither source can
prove that the restored state is stale. Durable Object restart audit and the
immutable admission journal detect missing or reordered local history, not an
administrative rollback of both stores.

Implement the fence as a separately owned, append-only control resource whose
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

The join can be implemented independently behind a narrow `RestoreFence` port:
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
