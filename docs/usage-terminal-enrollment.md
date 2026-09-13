# Terminal enrollment wire

The dormant terminal enrollment codecs and Worker HTTP factory connect six terminal operations to the existing pairing and account Durable Objects. They do not add a CLI command, public Worker route, credential store, browser approval flow or upload authority.

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

Client context contains acceptance-time `nowMs`, the original initialized expiry, the explicitly confirmed account, the accepted reservation and the accepted enrollment receipt/device state, as applicable. These are validation inputs, not authentication or capabilities. Durable retention and credential references belong to a later native custody join.

Each reply must match its request operation and intent. Poll and confirm retain the original pairing expiry. Poll success has a 5,000 ms delay; confirm permits 0–5,000 ms and must match the chosen account. Reservations bind both proof commitments, account, reservation ID, generation and interval. Later replies must preserve the complete reservation and receipt, including the derived device ID. An observed revoked device cannot become active again.

The server may truncate reservation expiry to the earlier authentication expiry. The terminal still checks that the reservation falls within its independently retained original pairing lifetime. The server does not reconstruct original pairing creation from this truncated reservation: `PairingIntent` already audits that history.

Expired initialization, reservation and enrollment readback is observational and does not renew a grant. Namespace success requires the pinned active receipt and a live reservation. The terminal codec's time sample does not replace the monotonic transport deadline or clock history that a later transport/custody implementation must own. Rust secret-bearing request, namespace and wire-byte wrappers provide explicit borrows without Debug or general serialization.

## Authoritative Worker dispatch

The factory remains absent from the default Worker entrypoint. Initialize, poll and confirm select `PAIRINGS.getByName(intentId)` and each perform one RPC. Confirm's account input is an explicit confirmation choice, never an account-object routing key.

Reserve first calls `readEnrollmentReservation`. Only the checked `not_reserved` result permits exactly one reserve call. Existing reservation readback therefore survives a lost response or expired grant without creating new credentials or extending the original interval. Malformed or unknown results never synthesize absence.

Enroll and namespace first read and validate the authoritative reservation, derive the account object's name only from its account ID, then forward the original proof fields to the selected account method. That method independently rereads the reservation. Neither a caller-provided account, reservation, context nor generation selects account authority.

The adapter retains the exact source-specific pairing error sets and the current enrollment error union. Before account dispatch, checked `invalid_input` and `not_initialized` reservation-read failures map to `storage_unavailable`, matching the account operation. Other reachable read errors retain their exact mappings. Unknown shapes or impossible operation errors become operational 503.

## Request lifetime and remaining qualification

Each request has a 10-second total budget, five-second body/direct-RPC stages and one of eight outstanding-work slots. The factory registers its terminal work before reading bytes or dispatching RPCs. Slots remain held until actual body/RPC cleanup settles, including late outcomes. Each raw RPC envelope is owned, validated and copied before its once-only disposal; raw then-accessors do not participate in the adapter's promise resolution.

Captured generation, abort state, clock progression, deadlines and validated success expiry are checked through response delivery. Timeout never starts a later reserve/account operation. It does not cancel a committed mutation, prove a global recovery barrier, or authorize retry, credential replacement or recovery fallback.

Focused source validation consists of the client/server codec and HTTP tests, the Rust enrollment tests, and `bun run scripts/usage-worker-tools.ts test-terminal-enrollment`. The real workerd suite exercises the existing DOs, auth-truncated reservations, exact replay, revocation and restart. Local fixtures do not establish live Accounts authority, native HTTPS framing, operating-system credential custody, arbitrary restore, a public service or product activation. Follow [Usage Worker boundaries](usage-worker.md#validation-and-activation) and the [private Cloudflare procedure](usage-cloudflare-qualification.md) for their separate gates.
