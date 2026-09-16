# Operate the Usage restore fence

This procedure drives the external restore fence described in
[Usage activation](usage-activation.md#external-restore-fence): close the epoch,
drain admitted operations, restore both stores externally, then publish a
strictly greater epoch. The operator driver calls the named
`RestoreFenceControl` entrypoint through a remote service binding. The service
has no public route, workers.dev URL or Preview URL; its default handler
retains the dormant Worker's fixed `503`, and the public `usage.aicharts.io`
router is unchanged and unreachable from this channel.

The channel admits exactly three operations — `read`, `close` and `publish` —
over one fixed private URL with a 1 KiB request cap, an 8 KiB reply cap and
canonical JSON bodies. It never accepts credentials, accepts no lease or
account RPC, and returns only the fence's fixed error codes at fixed statuses.
The fence's own `assertOpen`/`release` lease operations remain internal to the
Worker adapter; the operator never holds or forges a lease. The restore itself
never passes through this channel: the tool performs no Durable Object or R2
writes beyond the fence record.

## Establish the run target

Use the exact reviewed and validated source commit with locked dependencies,
native Node 24.2 or later within Node 24, and installed Wrangler 4.131.0, under
`--experimental-transform-types` and the checked
`scripts/usage-cloudflare-node.mjs` import hook. The driver hashes a bounded
source set, including the hook, and rechecks it whenever a run is loaded; the
operator separately verifies that this source belongs to the recorded commit.

The control Worker `aicharts-usage-restore-fence-control` owns no storage. Its
generated configuration binds `RESTORE_FENCES` cross-script, by `script_name`,
to the fenced Worker's existing Durable Object namespace, so closing and
publishing execute inside the fence's own authority. Confirm the
owner-controlled Cloudflare account, the fenced Worker name, and the exact
`USAGE_WORKER_VERSION` value the fenced deployment reports before preparing a
run. Confirm the control Worker is absent before its first deployment, and
verify Workers Scripts authority on the same Wrangler authentication before any
remote `getPlatformProxy` call.

The generated service configuration needs one external deployment, performed
by the operator with the installed Wrangler CLI from the private run directory,
exactly as in [Qualify the private Usage
Worker](usage-cloudflare-qualification.md#run-the-three-checkpoints): inspect
the generated file, pass `--experimental-provision=false`, then read the
provider's active deployment, version, bindings and disabled URL settings. The
driver never deploys or promotes a Worker.

## Prepare the run

Create a user-owned mode-0600 intent JSON outside tracked source with exactly
these fields: `schemaVersion:1`, `accountId`, `generation`,
`cloudflareAccountId`, `fencedWorker`, `fromEpoch`, `toEpoch`,
`fromWorkerVersion` and `toWorkerVersion`. `toEpoch` must exceed `fromEpoch`;
both Worker versions are the 64-hex deployment values, with `fromWorkerVersion`
the version the fence currently records and `toWorkerVersion` the version the
new fenced deployment reports. Then run:

```text
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-restore-fence-control.ts prepare ABSENT_RUN_DIRECTORY EXACT_SOURCE_SHA ABSOLUTE_PRIVATE_INTENT_JSON
```

The driver creates a mode-0700 directory with a mode-0600 canonical manifest
and two generated configurations: `wrangler.driver.json` and
`wrangler.control.json`. It never adopts an existing directory, and the frozen
run expires after 12 hours. Keep the manifest private: it retains exact request
and reply evidence needed for reconciliation. The driver configuration contains
only the remote named service binding; `getPlatformProxy` supplies it locally,
the driver is never deployed, and no public listener opens.

Deploy `wrangler.control.json` once, verify the deployment, and record the
receipt before any step. The mode-0600 receipt file sits directly inside the
run directory; `FenceDeploymentReceipt` in
`scripts/usage-restore-fence-control.ts` defines its exact fields: account,
both Worker names, distinct version/deployment IDs, disabled development URLs,
zero routes, disabled observability, 100% traffic and verification time.

```text
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-restore-fence-control.ts record-deployment ABSOLUTE_RUN_DIRECTORY ABSOLUTE_PRIVATE_RECEIPT_JSON
```

## Run the transition

Each `step` performs exactly one transition. `step` and `retry` print the
planned transition and dispatch nothing for a mutating step unless `--apply`
is present. The full sequence for one account:

```text
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-restore-fence-control.ts plan ABSOLUTE_RUN_DIRECTORY
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-restore-fence-control.ts step ABSOLUTE_RUN_DIRECTORY          # read-initial: observe open at the pinned epoch
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-restore-fence-control.ts step ABSOLUTE_RUN_DIRECTORY --apply  # close: refuse new leases
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-restore-fence-control.ts step ABSOLUTE_RUN_DIRECTORY          # drain: poll until inFlight is zero
# EXTERNAL: restore the account Durable Object and both R2 stores, invalidate
# old device credentials, reconcile journal prefixes and namespace anchors.
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-restore-fence-control.ts record-restore ABSOLUTE_RUN_DIRECTORY ABSOLUTE_PRIVATE_RECEIPT_JSON
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-restore-fence-control.ts step ABSOLUTE_RUN_DIRECTORY --apply  # publish: reconcile by read, then reopen at the new epoch
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-restore-fence-control.ts step ABSOLUTE_RUN_DIRECTORY          # read-final: verify open at the new epoch
node --experimental-transform-types --import ./scripts/usage-cloudflare-node.mjs ./scripts/usage-restore-fence-control.ts summary ABSOLUTE_RUN_DIRECTORY
```

1. `read-initial` requires the fence open at the pinned `fromEpoch` and
   `fromWorkerVersion`. Any other record — absent, another epoch or version —
   refuses the step rather than proceeding.
2. `close` is idempotent: an already closed record at the pinned epoch
   reconciles instead of conflicting. New mutating leases then return
   `recovery_required` from the fence itself.
3. `drain` polls `read` every 2 seconds for at most 90 seconds — the lease TTL
   is 30 seconds — and completes only on `inFlight:0` while the record stays
   closed at the pinned epoch. A fence that never drains, or reports any other
   state, refuses the run; investigate the outstanding lease rather than
   forcing it.
4. The restore checkpoint is external. The tool performs no restore. After the
   two-store restore, credential invalidation and journal/anchor
   reconciliation, record a `FenceRestoreReceipt` attesting
   `accountStore:"reconciled"`, `controlStore:"reconciled"`,
   `credentialsInvalidated:true`, `journalsReconciled:true` and the restore
   time. The receipt must postdate the drain; publish cannot dispatch without
   it.
5. `publish` first reconciles by `read`. An open record at the pinned target
   completes the step without resending — an uncertain earlier publish is never
   blind-retried. Only a closed, drained record at the pinned epoch receives
   the publish; anything else refuses.
6. `read-final` verifies the reopened record at `toEpoch` and
   `toWorkerVersion`.

The summary reports `ready`, `deployment_required`, `restore_required`,
`ambiguous`, `refused` or `complete`, the last observed epoch/phase/in-flight
count, and whether `--apply` or an explicit `retry` is needed. It excludes
account IDs, generations and private values.

## Reconcile an uncertain step

The driver durably records exact request bytes before dispatch and retains
`prepared`, `dispatched`, `complete`, `refused` or `ambiguous` state under one
local lock. A crashed holder leaves its lock for investigation; the driver
never deletes a stale lock automatically.

A timeout or lost reply can follow a committed fence transition. Inspect the
private manifest before acting. `retry` reuses the retained request bytes and
permits at most three attempts per step. For `publish`, the retry reconciles by
read first: if the fence already carries the published epoch and version, the
step completes from that evidence and no second publish is ever sent. While a
step is `refused` — wrong epoch, wrong generation, an undrained fence,
`recovery_required`, `storage_unavailable` or `clock_regressed` — the fence
stays closed and the run stops. Preserve the run and its evidence; a
replacement run needs a new identifier and separately verified fence state.

Stop conditions from [Usage activation](usage-activation.md#stop-conditions-and-rollback)
apply verbatim: missing authority, ambiguous deployment state, a lost
write/readback, provider framing drift, clock regression, restore-fence
disagreement or credential exposure each leave the fence closed. Do not delete
namespaces, reset buckets, truncate journals or replace keys to force a
transition.
