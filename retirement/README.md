# Retired usage workers

These modules close the former AI Charts usage service. Every HTTP handler returns
410 with `Cache-Control: private, no-store`. Durable Object alarms finish without
application work. The modules do not read requests, environment bindings, or
stored records, and expose no application RPC methods.

The two entry files preserve the separate worker interfaces:

| Entry file | Durable Object exports | Other named exports |
| --- | --- | --- |
| `usage-worker.mjs` | `AccountEnrollment`, `LeaderboardIndex`, `PairingIntent`, `RestoreFence` | None |
| `synthetic-qualification.mjs` | `AccountEnrollment`, `PairingIntent`, `RestoreFence` | `SyntheticQualification` (Worker entrypoint), `createSyntheticQualificationHandler` (function) |

`usage-worker-internal.mjs` is their shared module. Keep the existing worker names,
SQLite namespaces, bindings, compatibility settings, and migration history when
staging a replacement. This directory contains no deployment command or migration.
Stored data stays in place.

Run the local checks with `bun test ./retirement/usage-worker.test.js`. They use
stand-ins for the Cloudflare base classes and throwing request, context, environment,
and outbound-call guards. The repository's normal test command also runs them.
These checks establish the application handlers' behavior; they do not qualify a
Cloudflare rollout or persisted alarm delivery.

Source delivery does not deploy these modules. A separately reviewed operation must
check the current worker identities and interfaces, preserve their data, and use
the provider's supported deferred update. Work already in flight before an update
may still complete. This source does not establish that such work has stopped.
