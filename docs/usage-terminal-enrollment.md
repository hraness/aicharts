# Terminal enrollment wire and transport

The dormant terminal enrollment codecs, native HTTPS adapter and Worker HTTP factory connect six terminal operations to the existing pairing and account Durable Objects. A private attempt record and persistence core retain local observations separately from those exchanges. The native adapter has no production constructor. This source adds no CLI command, public Worker route, operating-system credential store, browser approval flow or upload authority.

The TypeScript client codec and Rust `enrollment::contract` share independently authored literal vectors in `fixtures/usage/terminal-enrollment-v1.json`. Both own canonical bytes and validate replies against retained observations. The separate server codec validates authoritative RPC results without accepting or manufacturing client context.

## Canonical request and response

The fixed endpoint is `POST https://usage.aicharts.io/v1/enrollment`, with request `Content-Type` and `Accept` both exactly `application/json`. Requests are at most 1,024 bytes; responses are at most 2,048 bytes. Both use ASCII JSON in fixed field order, without whitespace, duplicate or extra fields, alternate escapes, BOM, fractional or exponent numbers, or negative zero. Decoders require exact canonical re-encoding.

The request envelope is `{schemaVersion:1,operation,input}`. The response envelope is `{schemaVersion:1,operation,intentId,result}`, where the result is `{ok:true,value}` or `{ok:false,error}`. The six operations are:

| Operation | Input after the envelope | Successful value |
| --- | --- | --- |
| `initialize` | `intentId`, `pollSecret`, `uploadCommitment` | Original `expiresAtMs` |
| `poll` | `intentId`, `pollSecret` | Pairing state, original expiry, polling delay and approved account |
| `confirm` | `intentId`, `pollSecret`, `accountId` | Terminal-confirmed pairing view for that explicit account |
| `reserveEnrollment` | `intentId`, `pollSecret`, `uploadSecret` | The immutable reservation |
| `enroll` | The same three proof fields | Reservation plus enrollment receipt and device state |
| `namespaceForEnrollment` | The same three proof fields | Reservation plus namespace version, key and enrollment receipt |

IDs, commitments, namespace keys and generations use nonzero lowercase 64-digit hex. Accounts use `acct_` followed by nonzero lowercase 32-digit hex. Poll and upload secrets must differ. Commitment and device derivation hash the existing domain-separated ASCII strings, including their hex spelling; they do not hash decoded identifier bytes.

The HTTP factory requires one canonical positive Content-Length matching the complete bounded request body. It refuses URL/query substitutions, unsupported methods, browser Origin, cookies, authorization, compression, transfer encoding and trailers before RPC dispatch. Replies use an owned fixed-length body, `application/json; charset=utf-8`, private/no-store caching, no-referrer, nosniff and noindex/nofollow. Domain results use 200. Invalid framing or input uses the fixed 400 `invalid_request` envelope; operational failure uses the fixed 503 `enrollment_unavailable` envelope. A failure status does not prove that an earlier mutation had no effect.

## Retained terminal observations

Client context contains acceptance-time `nowMs`, the original initialized expiry, the explicitly confirmed account, the accepted reservation and the accepted enrollment receipt/device state, as applicable. These are validation inputs, not authentication or capabilities. The private attempt schema records these facts and original credential references; operational sequencing and operating-system persistence still require the native custody join.

Each reply must match its request operation and intent. Poll and confirm retain the original pairing expiry. Poll success has a 5,000 ms delay; confirm permits 0–5,000 ms and must match the chosen account. Reservations bind both proof commitments, account, reservation ID, generation and interval. Later replies must preserve the complete reservation and receipt, including the derived device ID. An observed revoked device cannot become active again.

The server may truncate reservation expiry to the earlier authentication expiry. The terminal still checks that the reservation falls within its independently retained original pairing lifetime. The server does not reconstruct original pairing creation from this truncated reservation: `PairingIntent` already audits that history.

Expired initialization, reservation and enrollment readback is observational and does not renew a grant. Namespace success requires the pinned active receipt and live original pairing and reservation expiries. The native adapter owns each exchange's fresh clock observations and monotonic deadline; durable clock history across restarts remains part of the later custody join. Rust secret-bearing request, namespace and wire-byte wrappers provide explicit borrows without Debug or general serialization. They do not promise erasure of transient copies.

## Dormant native HTTPS exchange

`enrollment::https::HttpsEnrollment::exchange_once` borrows the typed request and retained context, validates them before DNS and encodes the request once. It sends those canonical bytes in one synchronous exchange to the fixed enrollment URL. It neither changes the caller's context nor persists request or response bodies. The returned `AcceptedEnrollment` contains a fresh `observed_at_ms` and the checked domain result; it is not a custody receipt or upload grant.

The transport uses the pinned Rustls/WebPKI roots, certificate and hostname verification, and SNI. It has no caller-supplied URL or roots, proxy, redirect, automatic retry or reusable idle connection. Requests set the exact media headers, Content-Length and `Connection: close`; they carry no cookies, browser Origin or authorization header. Proof preimages remain inside the canonical operation body. Test-only roots, loopback routing and clocks are unavailable in production builds.

One attempt has a 20-second monotonic deadline. Configured stage timeouts are three seconds for DNS and sending request headers, five seconds for connection and each body direction, and 15 seconds for response headers, each capped by the remaining overall budget. Checks around blocking work, response cleanup and decoding reject late acceptance without restarting that budget. Blocking operating-system or TLS work is not preemptible. The shared DNS resolver retains its single process-wide permit until the OS lookup finishes, including after caller timeout; it receives only the fixed service hostname and port and keeps at most 16 addresses.

The first wall-clock observation must not precede the retained context time. Subsequent observations reject wall-clock or monotonic regression. Decoding uses a fresh wall time after response and agent cleanup, and the final result carries the later checked observation. Confirm success must precede the original pairing expiry. Namespace success must also precede the retained reservation expiry. Both wall time and a monotonic deadline derived from the original expiry enforce these success-only fences; domain errors and expired initialize/reserve/enroll observations do not become live grants.

Only a final HTTP/1.1 200 response enters domain decoding. It requires one exact `application/json; charset=utf-8` media value and one canonical positive Content-Length of at most 2,048, matching the complete decoded body. Empty, duplicated or alternate numeric lengths, compression, transfer encoding, Location, Set-Cookie, trailers and upgrades are refused. ureq is configured with a 16 KiB response-header limit; the adapter also limits the final response to 64 header fields. HTTP 503 becomes the fixed transport `Unavailable` error; other non-200 statuses become `InvalidResponse`, without reading or draining their bodies. Transport failures remain distinct from checked domain errors, and a failure after dispatch may follow a remote commit.

These framing checks apply to the final message exposed by pinned ureq. The dependency consumes informational 1xx responses internally. Its Content-Length EOF is a message boundary, not socket EOF or proof that no further bytes were sent. The adapter closes the connection without waiting for peer FIN, including after rejection or codec failure; it does not inspect bytes beyond that decoded message. Chunked and close-delimited replies remain unsupported.

The transport asserts at compile time that the existing all-profile `log` macro suppression remains enabled, because dependency traces can include raw bodies. The enrollment and upload TLS fixtures share one process-global test logger owner and retain it through server cleanup. Their synthetic capture records only whether a log call occurred, never its payload.

## Private attempt records and persistence

The private `enrollment::attempt` modules define a canonical nonsecret record and compare-and-publish storage core. No production storage adapter or public constructor exists. Decoding a coherent record does not authenticate its history, verify current vault contents or authorize a request.

Records use at most 4,096 ASCII JSON bytes in fixed field order. The schema keeps the installation and intent, original typed pairing identity and complete `RecordIntent` commitment, a distinct reserved namespace item ID, poll/upload commitments, original pairing expiry, last pairing view and observation time, explicit account choice, complete reservation and enrollment receipt, namespace identity/commitment and original acceptance time, progress, fixed failure and a durable clock floor. It contains no secret preimages, request/response bodies, browser proof, upload sequence or upload grant. A polled approved account remains separate from an explicit chosen and confirmed account. Original credential bindings, initialized expiry, chosen account/time, reservation, receipt fields and namespace pin/time remain fixed once recorded. Pairing observations may advance, and device state may move from active to revoked, never back.

One retained flight records its operation, ordinal, prepared revision/time, last attempted time, dispatch count and canonical request/context digests. The record permits at most 128 flights, three explicit dispatches per flight and revision 1,024. Successor checks preserve a retained flight's identity and digests; they do not execute requests or prove that the recorded dispatch occurred. The eventual sequencer must supply checked observations and revalidate live authority before effects.

A namespace response adds its original pin in `NamespacePlanned` while retaining the same dispatched flight. Local custody then advances through `NamespacePrepared` to `NamespaceCustodyVerified`; only that final transition clears the flight. The pin, original acceptance time and dispatch facts remain unchanged during these local steps. Existing accepted material can finish local custody after expiry without acquiring a fresh namespace grant. The core performs none of the reference or vault operations represented by those states.

The storage port requires a stable private directory and lock, bounded committed reads, immutable staging, file synchronization, conditional atomic publication and directory synchronization. `initialize` requires absence. `compare_and_publish` binds the predecessor's revision and canonical digest, checks that exact predecessor before and after staging, publishes once, synchronizes the directory and verifies the exact committed candidate bytes before returning a durable snapshot. A staged candidate may be reused only when it is identical; the core never deletes, adopts or repairs a pending stage automatically.

Every failure from publication dispatch through final readback returns `OutcomeUnknown`, including an error whose port claims publication had no effect. `inspect` is observational. Explicit `read_durable` requires the expected token, committed-file synchronization, directory synchronization and another exact-token read; visible bytes alone do not establish durability. The returned snapshot does not retain a lock or confer network or custody authority.

The focused synthetic record and storage checks run with:

```text
cargo test --locked -p aicharts-cli --bin aicharts enrollment::attempt
```

These tests use literal canonical vectors, typed synthetic secret-record commitments and an in-memory fault model. They cover uncertain publication, explicit restart reconciliation, stale predecessor races and retained namespace flights. They do not qualify an operating-system persistence backend or a process-death recovery path.

## Authoritative Worker dispatch

The factory remains absent from the default Worker entrypoint. Initialize, poll and confirm select `PAIRINGS.getByName(intentId)` and each perform one RPC. Confirm's account input is an explicit confirmation choice, never an account-object routing key.

Reserve first calls `readEnrollmentReservation`. Only the checked `not_reserved` result permits exactly one reserve call. Existing reservation readback therefore survives a lost response or expired grant without creating new credentials or extending the original interval. Malformed or unknown results never synthesize absence.

Enroll and namespace first read and validate the authoritative reservation, derive the account object's name only from its account ID, then forward the original proof fields to the selected account method. That method independently rereads the reservation. Neither a caller-provided account, reservation, context nor generation selects account authority.

The adapter retains the exact source-specific pairing error sets and the current enrollment error union. Before account dispatch, checked `invalid_input` and `not_initialized` reservation-read failures map to `storage_unavailable`, matching the account operation. Other reachable read errors retain their exact mappings. Unknown shapes or impossible operation errors become operational 503.

## Worker lifetime and remaining qualification

Each Worker request has a 10-second total budget, five-second body/direct-RPC stages and one of eight outstanding-work slots. The factory registers its terminal work before reading bytes or dispatching RPCs. Slots remain held until actual body/RPC cleanup settles, including late outcomes. Each raw RPC envelope is owned, validated and copied before its once-only disposal; raw then-accessors do not participate in the adapter's promise resolution.

Captured generation, abort state, clock progression, deadlines and validated success expiry are checked through response delivery. Timeout never starts a later reserve/account operation. It does not cancel a committed mutation, prove a global recovery barrier, or authorize retry, credential replacement or recovery fallback.

Focused source validation consists of the client/server codec and HTTP tests, the Rust enrollment tests, and `bun run scripts/usage-worker-tools.ts test-terminal-enrollment`. For the native TLS and shared logger cases, run:

```text
cargo test --locked -p aicharts-cli --bin aicharts -- enrollment::https:: upload::https::
```

Follow the host scheduler requirements for native and aggregate checks. The local TLS fixtures cover the frozen vectors, trust refusal, framing and size bounds, lost replies, clock/expiry checks, cleanup and logging. The real workerd suite separately exercises the existing DOs, auth-truncated reservations, exact replay, revocation and restart. Neither fixture connects the native adapter to a deployed Worker.

Operational enrollment sequencing, operating-system attempt and credential-reference persistence, actual credential custody, explicit terminal account selection and the sealed production constructor remain unfinished. Local fixtures do not establish live Accounts authority, actual edge framing, process-death enrollment recovery, arbitrary restore, a public service or product activation. Follow [Usage Worker boundaries](usage-worker.md#validation-and-activation) and the [private Cloudflare procedure](usage-cloudflare-qualification.md) for their separate gates.
