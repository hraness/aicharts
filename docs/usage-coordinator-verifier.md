# Coordinator identity verification

`lib/usage/oidc/usage-oidc-verifier.ts` provides a request-owned verifier for the expected AI Charts production workload identity. No production handler constructs or calls it. Token acquisition, authenticated transport, user authorization and activation are separate unfinished integrations; the existing sign-in routes remain disabled.

## Expected identity

The verifier uses public `jose` 6.2.4 APIs with a source-owned RS256 policy. The expected values below are configuration, not observed live token claims:

| Claim | Required value |
| --- | --- |
| `iss` | `https://oidc.vercel.com/hraness` |
| `aud` | Single string `https://vercel.com/hraness` |
| `sub` | `owner:hraness:project:aicharts:environment:production` |
| `owner` / `owner_id` | `hraness` / `team_UAd1iD2XogJlbFg4h14mRaPM` |
| `project` / `project_id` | `aicharts` / `prj_0ppMfRRMDfiVsQ1JaekoxSZ7Mwgn` |
| `environment` | `production` |

The standard Vercel audience is shared within the owner. Exact subject, project and owner claims narrow the admitted workload; they do not create recipient-specific token isolation or replay protection. Required integer `exp`, `iat` and `nbf` claims permit at most a two-hour issuance lifetime with no future issuance or expiration grace. The header must contain exactly `alg`, `kid` and `typ`, with `typ` equal to the three ASCII letters `jwt` in any case. No token field can choose a key URL or algorithm.

## Request ownership

`createUsageOidcVerifier(dependencies)` snapshots trusted fetch, clock and timer functions. It returns frozen `{beginRequest}` and performs no I/O. The future Worker must create one verifier per module instance, then call `beginRequest(actualExecutionContext)` inside each request. Each scope exposes:

```text
verify(token: unknown) -> Promise<Result<VerifiedCoordinator>>
isCurrent(handle: unknown) -> boolean
finish() -> void
```

Only one verification attempt is permitted per scope, including malformed attempts. Success returns an opaque empty frozen object; its authority exists only in that scope's private metadata. Copies, serialized values and other scopes' handles fail. Results never contain tokens, claims, key IDs, expiry values or upstream errors.

The handler must recheck `isCurrent` and its separate activation/user-authority fences before protected work and after intervening awaits. Call `finish()` in an outer `finally` before returning a normal response. Do not capture the scope or authority in a response stream or background authenticated operation. Verification does not bind a request body, authorize an Accounts user or enable dispatch.

The actual work and cleanup promise is registered with the supplied context before its deferred work starts. Registration failure prevents I/O. Global state holds completed public keys and bounded numerical gates only; pending promises, tokens, contexts, controllers, streams, timers and handles stay request-local. Callers never wait on another request's pending fetch.

## Bounds and cache policy

| Resource | Bound |
| --- | --- |
| JWT | 8,192 ASCII characters; header 512 bytes, claims 4,096 bytes, signature 256–512 bytes |
| JSON | Fatal UTF-8, no BOM or duplicate decoded keys; depth eight, 256 units, 32 members per object |
| JWKS | 16,384 bytes; 16,385 reader results including empty chunks and EOF; zero through eight RSA keys |
| Key | Canonical odd 2,048–4,096-bit modulus, exponent 65,537; selected public fields only |
| Outstanding work | One JWKS flight and eight verification tasks; no queue |
| Deadlines | Two seconds for fetch/body/import; five seconds for the verification response |
| Cache | Five minutes from flight start; 30-second fetch cooldown after settlement |

The only fetch target is `https://oidc.vercel.com/hraness/.well-known/jwks`. Requests use GET without credentials and fixed `redirect: "manual"`, so the transport does not follow redirects. Every response must have status 200, no redirected flag and that exact final URL; any 3xx is unavailable, its owned reader is canceled, and no Location value is read or followed. This uses the supported Worker mode after a synthetic runtime check found that `error` was refused before fetch. Media type, encoding, streamed size and optional length must also match. Every key is validated and imported sequentially before atomic cache replacement; a malformed unused key rejects the whole response. A valid empty set removes admitted keys.

Known fresh keys remain usable during an unrelated refresh. A failed refresh preserves the previous generation only until its original deadline. Successful replacement invalidates old handles even if a key is unchanged. A bad signature for a present key never triggers refresh. Unknown keys create no per-key cache entries or retry loop.

Invalid or regressing actual time invalidates authority without lowering the observed clock floor. The verifier rechecks its clock, request, deadline and cache-generation fences after crypto success or failure. `isCurrent` performs no I/O and cannot extend authority.

## Failure and recovery limits

Fixed `unauthorized` means a refused token, identity, claim, signature or absent key in a fresh admitted set. Fixed `unavailable` covers capacity, registration, deadline, network/key admission, clock and unexpected runtime failures. Public `jose` masks some WebCrypto verification exceptions as signature failure; those become `unauthorized` after this verifier's own fences are rechecked. No diagnostic details or automatic retry follow either error.

Timeout and `finish` invalidate the request's authority and request owned cancellation. They do not free a permit while its underlying fetch, body cancellation, import or crypto remains unsettled. This prevents accumulating replacement work behind response timeouts. If the runtime abandons cleanup, permits can remain occupied until actual settlement or isolate replacement. There is no timed reset or guaranteed availability recovery.

These limits apply per module instance, not across the service fleet. Cold instances can each fetch a key set for a structurally plausible unsigned token. Fleet-wide abuse/cost controls, live provider key/token compatibility and deployment identity require separate qualification before activation. Cache freshness also does not promise immediate provider-key revocation.

Synthetic unit tests exercise public JOSE with generated keys and controlled streams, clocks and crypto settlement. Run `bun test lib/usage/oidc`. Real HTTP Worker disconnect/cross-request qualification is tracked separately; unit promises alone do not establish it. Body caps limit bytes the application consumes, not prior platform buffering, and synchronous bounded parsing is not a preemptive CPU deadline or hostile-runtime sandbox.
