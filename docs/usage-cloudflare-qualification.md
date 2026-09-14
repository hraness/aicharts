# Qualify the private Usage Worker

This procedure exercises the internal pairing, enrollment, admission and daily-query operations on Cloudflare with one synthetic account. The local driver calls the named `SyntheticQualification` entrypoint through a remote service binding. The service has no public route, workers.dev URL or Preview URL; its default handler retains the fixed private `503`.

The checked source is qualification infrastructure. A local test or successful bundle does not establish a completed provider run. Product authentication, enrollment, upload and private-read activation remain separate gates in [Usage Worker boundaries](usage-worker.md#validation-and-activation).

## Establish the run target

Use the exact reviewed and validated source commit with the locked dependencies, native Node 24.2 or later within Node 24, and installed Wrangler 4.131.0. Run the driver with `--experimental-transform-types` and the checked `scripts/usage-cloudflare-node.mjs` import hook, as shown below. The hook requires both `registerHooks` and `import.meta.main` before entry. The installed Wrangler runtime does not support Bun. Node's [TypeScript transformation](https://nodejs.org/docs/latest-v24.x/api/typescript.html#type-stripping) is required for the source parameter property; the hook maps only the exact reviewed extensionless import edges and delegates all other resolution to Node. It preserves original source files and `import.meta.url`.

The driver hashes a bounded source set, including the Node hook, and rechecks it whenever a run is loaded. The operator separately verifies that this source belongs to the recorded commit; a caller-provided SHA or deployment receipt does not authenticate itself.

The native driver sends the fixed URL and an options object through the service binding, with an explicit `Content-Length` equal to the retained request byte length. Without that header, the installed Miniflare Node proxy streams the body with `transfer-encoding: chunked`; the synthetic Worker rejects that envelope. The native binding regression checks the receiving URL, headers and canonical bytes, including a negative control for the omitted length. Keep the Worker's existing request checks intact.

Confirm the owner-controlled Cloudflare account, authority, current Workers and R2 plans, included usage and capacity before deployment. Reuse the private Standard buckets `aicharts-usage-records` and `aicharts-usage-control`. Verify their identity and location, disabled development URLs, absent custom domains and the absence of the new run's exact synthetic object prefixes. Do not change a subscription, public binding or existing data to make qualification pass.

Before any remote `getPlatformProxy` call, verify that the same account authentication includes the required Workers Scripts authority, such as the supported OAuth scope `workers_scripts:write`, and read the account's existing Workers subdomain. A 403 or authentication error does not establish absence. Installed Wrangler can register an account subdomain when none exists and creates a remote preview session for remote bindings; setup effects may precede a usable proxy or cleanup handle. Confirm the existing subdomain or separately review account setup before invoking that path. These provider setup effects are separate from the target service's disabled public URLs.

Confirm that `aicharts-usage-synthetic-qualification` is absent before the first deployment. The initial deployment creates its two SQLite Durable Object namespaces. Later checkpoints must preserve the same Worker name, class names and namespace IDs. Inspect the generated configuration and provider dry run before each deployment; source templates are intentionally unconfigured and must not be deployed directly.

An aborted run can require corrected source and a fresh run identifier. If it completed no mutating stage, preserve its private manifest and receipts, inspect its exact prefixes and anchor, and require empty storage before replacing its dedicated qualification configuration. Match the existing Worker version, bindings, namespace IDs and private routing against the retained deployment evidence immediately before replacement. Record the expected previous deployment and the new source/run/config digests in a separate immutable intent. Preserve the Worker, both namespaces, buckets and all previous evidence. Unexpected provider identity or populated old-run storage requires a separately reviewed continuation; do not delete or reset it to satisfy the empty-prefix check.

The sequence has 41 service requests across three deployment checkpoints. Each request has a 2 KiB input and 16 KiB response cap. Its normal path leaves one 160-byte namespace anchor, three immutable batch objects and three terminal journals. The workload is synthetic and bound to one random run identifier; the driver retains server-issued reservations and browser capabilities as evidence. The existing buckets may contain other data; every inspection is confined to the run's exact prefixes. Free-plan CPU, actual service-binding behavior and deployed persistence need live evidence.

The source-derived successful-path budget is 25 R2 Class A operations, including 18 bounded prefix lists, 104 R2 GETs and 56 Durable Object RPCs including nested calls. The explicit retry cap allows at most 119 service attempts; conservatively tripling the storage work bounds it to 75 Class A operations, 312 GETs and 164 RPCs. The retained seven objects total 3,152 body bytes. These bounds exclude provider setup APIs and response/list metadata. The largest expected stage has 22 downstream operations, with nested RPCs counted; this count does not establish CPU fit or future capacity for real usage.

## Prepare private configuration

Create a user-owned mode-0600 target JSON file outside tracked source, with exactly `accountId`, `workerName`, `recordsBucket` and `controlBucket`. Use the verified account ID and the fixed names above. Keep the run directory absent and its parent canonical. Then run from the repository:

```text
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-cloudflare-qualification.ts prepare ABSENT_RUN_DIRECTORY EXACT_SOURCE_SHA ABSOLUTE_PRIVATE_TARGET_JSON
```

The driver creates a mode-0700 directory with a mode-0600 canonical manifest and three configurations: `wrangler.driver.json`, `wrangler.generation-one.json` and `wrangler.generation-two.json`. It never adopts an existing run directory. The frozen run expires after 24 hours and contains two distinct recovery generations. Keep these files private: the manifest retains synthetic browser capabilities and exact response evidence needed for reconciliation.

The generated service configurations bind only the verified account, fixed Worker, two existing buckets, two Durable Object classes, frozen run and selected generation. Both public URL controls, observability and telemetry remain disabled. The driver configuration contains only the remote named service binding. `getPlatformProxy` supplies that binding locally; the driver is never deployed and opens no public application listener.

The Node driver calls the service binding with the fixed URL and an explicit options object containing its method, headers, signal and owned canonical bytes. Node's native `Request` object is not compatible with the installed proxy's request class. The binding uses manual redirect behavior; the driver separately rejects redirected replies and every Location header before accepting evidence. Local Node binding tests exercise the actual dispatch and reply checks without provider authentication.

The live driver disables Wrangler logging and application environment loading. Do not place `.env` or `.dev.vars` files in the run directory. Use the supported existing Wrangler account authentication; do not copy credentials into a fixture, command argument, source file or public receipt. Keep deployment command output private because provider tooling can display configuration variables.

## Run the three checkpoints

Each deployment is a separate operator action. The driver never deploys or promotes a Worker. Record deployment intent before invoking the CLI and reconcile provider state after every outcome. Wrangler can internally retry an upload up to three times, so one CLI invocation does not prove one provider write. Do not repeat an uncertain deployment without inspecting its active state. Run the installed Wrangler CLI from the validated private run directory with the exact account and generated service configuration. Wrangler loads `.env` and `.env.local` from its working directory even when the driver environment-loading flags are disabled; the checked run directory forbids those files. Pass `--experimental-provision=false` so a missing named R2 binding cannot trigger bucket creation; `--experimental-auto-create=false` alone is insufficient. Then inspect the provider's active deployment, version, bindings and URL settings.

1. Deploy `wrangler.generation-one.json` as the initial private service after the target and bundle checks pass.
2. Record a verified initial deployment receipt as described below.
3. Run one `step` command at a time until the summary reports the `redeploy` checkpoint.
4. Redeploy the same generation-one configuration and verify that both Durable Object namespace IDs are unchanged.
5. Record the verified `redeploy` receipt.
6. Run individual steps until the summary reports the `generation-two` checkpoint.
7. Deploy `wrangler.generation-two.json` to the same Worker and verify the unchanged namespace IDs.
8. Record the verified `generation-two` receipt.
9. Run the remaining steps and retain the complete summary plus private evidence.

Use these commands for each recorded receipt and step:

```text
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-cloudflare-qualification.ts record-deployment ABSOLUTE_RUN_DIRECTORY ABSOLUTE_PRIVATE_RECEIPT_JSON
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-cloudflare-qualification.ts step ABSOLUTE_RUN_DIRECTORY
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-cloudflare-qualification.ts summary ABSOLUTE_RUN_DIRECTORY
```

The mode-0600 receipt file must be directly inside the run directory. `DeploymentReceipt` in `scripts/usage-cloudflare-qualification.ts` defines its exact fields: phase, source/run/config digests, account and Worker, deployment/version IDs, both namespace IDs, both buckets, verification time and the required private settings. Read these facts from the provider and exact local files before recording them. The driver checks consistency, distinct deployment/version IDs, unchanged namespaces, checkpoint order and 100% traffic; it does not query the provider to authenticate the receipt. Preserve that distinction in the final evidence.

The first phase checks an empty prefix, synthetic pairing, enrollment with a withheld committed RPC response, exact enrollment replay, namespace binding, initial admission with another withheld response, exact terminal-journal replay and daily totals. The second verifies persistence after redeployment, then correction, tombstone, revocation, a permitted latest-batch retry and denial of a new revoked-device operation. Exact anchor, batch and journal bytes, checksums, metadata and object version IDs must remain stable. The final phase uses a fresh synthetic reservation and requires `recovery_required` from seven checks covering old authority and fresh-generation reopening, followed by unchanged object readback. Leave the service in generation two; rolling it back would contradict the tested closure.

## Reconcile an uncertain step

The driver durably records exact request bytes before dispatch and retains `prepared`, `dispatched`, `complete` or `ambiguous` state. It admits only one local lock holder. A crashed holder leaves its lock for investigation; the driver never deletes a stale lock automatically. The finite public summary excludes account IDs, capabilities, namespace bytes and private object contents.

A timeout or lost response can follow a committed Durable Object operation. Inspect the private manifest and the owned process state before retrying. After reconciling an ambiguous idempotent step, use:

```text
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-cloudflare-qualification.ts retry ABSOLUTE_RUN_DIRECTORY
```

The driver reuses the retained request bytes and permits at most three explicit attempts for that step. It never retries automatically. An ambiguous `begin` operation stops the run because it creates a random browser capability that cannot be recovered by repeating the request. Preserve the failed run and its evidence; a replacement run needs a new identifier and separately verified target state.

A source repair invalidates the old source digest even if the uncertain request was only an inspection. Do not edit the retained manifest, substitute a factory or disable source verification to continue it. Preserve the failed run, complete the corrected source's delivery gates, then prepare a fresh private run and separately reconcile its deployment target as described above.

The replacement procedure uses a create-only private packet that pins the corrected source commit and digest, the fresh run digest, the expected active deployment and both existing Durable Object namespace IDs, plus the retained old receipt hash. Native Node 24 readback, prefix reconciliation, initial intent preparation, deployment acceptance and the three bounded phase drivers consume that packet. The packet and every readback are mode-0600; provider reads use a selected authentication environment and bounded response streams. Before and after snapshots must match the expected phase and active version; an uncertain deployment remains preserved for reconciliation and is never manually retried.

The driver rejects acceptance after a 20-second monotonic deadline, run expiry or clock rollback observed during an attempt. The Worker applies its own 15-second guard and the underlying storage operations retain their narrower bounds. These guards reject late success; they do not preempt a committed RPC or prove cancellation of platform work. Keep one owner of the live process and its cleanup.

## Interpret and retain the result

A complete summary establishes only the verified synthetic sequence with the recorded deployed identities. The intentional loss cases discard a completed RPC response; they do not simulate loss of an R2 write acknowledgment. Redeployment establishes persistence across that deployment, and generation closure establishes the tested refusals. Neither establishes arbitrary SQLite point-in-time recovery, a globally atomic recovery fence, immutable enrollment/revocation replay, lost-object reconstruction, live Accounts authority or native HTTPS framing.

Retain the bounded result, exact source/tree, local validation, three provider receipts, private configuration digests, measured request/capacity outcome and immutable object evidence. Do not publish the private manifest or provider logs. Preserve the seven synthetic objects and generation-two closure until a separately reviewed cleanup or recovery operation owns them. Completion never enables the product's production feature flags.

Local source checks are:

```text
bun run scripts/usage-worker-tools.ts test-synthetic-qualification
bun test scripts/usage-cloudflare-qualification.test.ts scripts/usage-cloudflare-node.test.ts scripts/usage-cloudflare-node-binding.test.ts scripts/usage-worker-tools.test.ts
```

The full repository gate includes the Worker suite, driver tests, types and lint. Follow the host scheduler requirements for runtime, bundling and aggregate checks.
