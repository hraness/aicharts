# Pairing transport bytes

`lib/usage/pairing-transport-contract.ts` defines the memory-only request and result format for a future authenticated AI Charts server-to-Worker transport. It performs no network request, authentication, dispatch or persistence. The production resolver remains absent and the default Worker remains unavailable. This format carries pairing capabilities, not usage measurements; never log its bodies.

## Exact operations

Each request has exactly `{schemaVersion:1,operation,input}` in that order. The four operation names and input fields are:

| Operation | Input fields, in wire order |
| --- | --- |
| `beginBrowserAttempt` | `intentId`, `browserNonce` |
| `recordVerifiedAuthentication` | `intentId`, `attemptId`, `browserNonce`, `contextToken`, `accountId`, `authTimeMs`, `sessionExpiresAtMs` |
| `browserStatus` | `intentId`, `attemptId`, `browserNonce`, `contextToken` |
| `decideBrowser` | `intentId`, `attemptId`, `browserNonce`, `contextToken`, `accountId`, `liveSessionExpiresAtMs`, `decision` |

Proof fields are 64 lowercase hexadecimal characters, excluding the all-zero value. Account IDs have the exact `acct_` prefix and 32 lowercase hexadecimal characters; their opaque suffix may be all zeros. Times are integer milliseconds from zero through 8,640,000,000,000,000, excluding negative zero. `authTimeMs` must be divisible by 1,000. A decision is `approve` or `deny`. Structural acceptance does not prove freshness, consent, account ownership or a genuine user session.

Each response has exactly `{schemaVersion:1,operation,result}`. Its operation must match an independently checked request. A domain result is `{ok:true,value}` or `{ok:false,error}`. Successful values are:

- Begin: `{attemptId,contextToken,startedAtMs,expiresAtMs}`, with a positive lifetime of at most ten minutes.
- Record: `{recorded:true}`.
- Status or decision: `{state,expiresAtMs,accountId,authenticationExpiresAtMs}`. States are `pending`, `browser-approved`, `terminal-confirmed`, `denied` and `expired`. Account and authentication expiry are both null or both present; approved/confirmed states require both. Authentication expiry need not be below intent expiry. Decision success must match the request's account and permitted decision state: approved/confirmed for approve, denied for deny.

Common domain errors are `invalid_input`, `not_initialized`, `unauthorized`, `storage_invalid` and `clock_regressed`. Begin additionally admits `expired`, `invalid_transition` and `attempt_limit`; record admits `expired`, `invalid_transition`, `authentication_not_fresh` and `conflict`; decision admits `expired`, `invalid_transition` and `authentication_not_fresh`. Status admits only the common set. Polling, enrollment and arbitrary RPC names/errors are outside this format.

## Codec API and ownership

```ts
encodePairingTransportRequest(input: unknown)
decodePairingTransportRequest(bytes: Uint8Array)
encodePairingTransportResponse(request: unknown, result: unknown)
decodePairingTransportResponse(bytes: Uint8Array, request: unknown)
```

Each returns a `Result`. Codec failures are fixed `invalid_request` or `invalid_response` strings, without reflected values or exception details. Response decoding returns the domain result, not the transport envelope: an accepted domain failure is `{ok:true,value:{ok:false,error:...}}`. Callers must check both layers.

Request bodies are capped at 1,024 bytes and responses at 512 bytes. Encoding is compact canonical ASCII JSON without a trailing newline. Decoding copies admitted bytes, parses, validates the exact shape and compares regenerated canonical text. Duplicate, escaped, reordered, unknown or missing keys; whitespace, BOM and suffixes; non-ASCII bytes; alternate numeric spellings and negative zero are refused.

Object inputs may be ordinary or null-prototype records, with enumerable own data fields only. Property order is normalized for object inputs, but byte inputs must already have canonical order. Returned metadata is copied into deeply frozen null-prototype records. Encoded arrays remain mutable and own fresh exact-length buffers. Intrinsic view access avoids overridden byte-view getters and iterators; shared, resizable, detached, empty and non-Uint8Array views are refused.

The byte caps bound admitted parsing and serialization, not arbitrary JavaScript execution. Metadata reflection depends on the input's property count, and proxy reflection traps can execute or fail to terminate. The codec assumes trusted runtime intrinsics and is not a hostile-JavaScript sandbox. Fixed shapes and small bodies reduce accidental data acceptance; they cannot eliminate covert encoding into valid capability fields.

## Integration and validation

The future transport must authenticate workload identity before selecting a Durable Object, use fixed routing, bound body streams and deadlines, and dispose real Worker RPC results. It must bind the requested intent to the selected resolver. None of those behaviors is provided by this codec. Browser authentication facts must still come from the validated Accounts completion, not browser-submitted claims. A valid payload is not authorization.

No automatic mutation retry follows from encoding. A lost response may follow a committed operation; starting another authentication attempt is not proof that the previous one failed. The existing [identity and custody rules](usage-identity.md#device-enrollment-boundary) continue to govern reconciliation. Status can advance durable expiry state and is not a storage-read-only operation.

The focused synthetic corpus runs with `bun test lib/usage/pairing-transport-contract.test.ts`. It covers every operation and error, bounds, nullable status, account/decision correlation, ownership, noncanonical byte mutations, truncations and fixed-seed properties. Run the complete `bun run check` after integration. Pure Bun execution and TypeScript compatibility do not establish live workerd dispatch, workload authentication, account pairing or upload readiness.
