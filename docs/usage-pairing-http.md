# Pairing HTTP adapters

AI Charts contains dormant server and Worker adapters for the four [pairing transport operations](usage-pairing-transport.md). They are not connected to the production authentication resolver or default Worker entrypoint. The fixed target, `https://usage.aicharts.io/internal/pairing`, is planned configuration, not an observed live endpoint. Creating a factory does not enable browser pairing, enrollment or uploads.

## Binding and authority

`lib/usage/pairing-transport.ts` exports `createPairingTransport(dependencies)`, which returns an intent-bound resolver. Each invocation validates and copies its request before asynchronous work and requires the request's intent to equal the resolver's intent. It acquires the current platform context synchronously, then snapshots only its own `headers` field's own `x-vercel-oidc-token` string. Missing, malformed or throwing context fails closed. Incoming HTTP headers, environment tokens, CLI credentials and OAuth refresh helpers are not fallbacks.

`lib/usage/pairing-vercel.ts` supplies the public `getContext` export from exact `@vercel/oidc` 3.8.7, global fetch and clocks, and public `after` from `next/server`. Construct one resolver per server module and invoke its methods in the current request context. It registers the already-created, nonrejecting terminal promise with `after(terminal)` before transport work starts. Passing a callback to `after` would defer the work until response close and would change this ordering. Missing Next lifetime registration prevents outbound work.

The bounded import review found no eager auth/config-file read, token refresh, HTTP request or CLI spawn in the directly traced Vercel helper code. That is a limited source observation: the package root also loads unused token/CLI modules, captures host metadata and initializes dependencies. A named import does not establish a side-effect-free package graph, and the review was not a full transitive no-I/O audit. The selected `getContext` function itself reads only the platform request context.

`services/usage-worker/src/pairing-http.ts` exports `createPairingHttpHandler(dependencies)`. Its trusted structural verifier interface accepts the actual request lifetime and exposes only `verify`, `isCurrent` and `finish`; an opaque verified handle is never inspected or returned. The accepted [coordinator verifier](usage-coordinator-verifier.md) is checked for type compatibility without importing its browser ambient types into the Worker graph.

The Worker authenticates the workload before consuming a body or selecting a Durable Object. After decoding, it rechecks current authority immediately before canonical `PAIRINGS.getByName(intentId)` selection and dispatches exactly one allowlisted method. Each method explicitly copies its checked primitive fields into an ordinary frozen object: the tested workerd runtime rejects the codec's null-prototype records as RPC arguments. The codec and its strict owned representation remain unchanged. The Worker checks authority again after asynchronous work. The adapter requires a real RPC reply's own synchronous `Symbol.dispose`, captures its original receiver and disposes it on accepted, malformed and late replies. Failure to validate or dispose a reply cannot produce success.

Workload verification authenticates the coordinating service, not an Accounts user. Fresh account facts, browser consent, CSRF, cookie custody and durable decision-time checks remain governed by [Usage identity and activation](usage-identity.md#device-enrollment-boundary). The adapters add no caller-selected account authority, polling method, enrollment operation or arbitrary RPC dispatch.

## HTTP and work limits

Requests use only POST to the exact target, with `Content-Type: application/json`, `Accept: application/json` and a bounded compact bearer token. The client uses `redirect: "manual"`, `credentials: "omit"` and `cache: "no-store"`. It sends one request and follows no redirect. The Worker rejects query/path/method substitutions, cookies and content encoding.

| Resource | Bound |
| --- | --- |
| Request / response body | 1,024 / 512 bytes |
| Bearer | 8,192 ASCII characters; three nonempty base64url segments |
| Client deadline | 15 seconds from method entry, including synchronous context acquisition |
| Worker deadline | 10 seconds from handler entry |
| Body read or RPC stage | Five seconds, capped by the remaining overall deadline |
| Outstanding operations | Eight per client factory and eight per Worker adapter instance; no queue |
| Body reads | At most byte cap plus one reader result, including EOF; zero-length chunks refused |

An optional Content-Length must be a canonical positive decimal within the relevant cap and equal bytes consumed at EOF. Empty bodies, unsupported byte views and oversized chunks are refused. Accepted bytes are copied into owned fixed-size buffers. Response media must be exactly `application/json; charset=utf-8`, with the exact final URL, no redirected flag, encoding, Location or Set-Cookie. Responses carry private, no-store headers.

Timers request cancellation, while every guard also checks absolute overall and active-stage deadlines and refuses observed clock regression. Late timer delivery cannot make an over-deadline stage successful. Outward timeout does not release capacity while owned fetch, stream cancellation or RPC work remains unsettled. Late replies can only be validated for cleanup and disposed; they cannot revive authority or produce a successful response.

The nonrejecting terminal task retains cleanup through the actual request lifetime. No pending promise, token, controller, stream or verified handle is kept in factory-global state. An unresolved operation may occupy its permit until actual settlement or isolate replacement; there is no timed capacity reset. Bodies rejected before admission remain unread and under platform ownership. These limits bound application consumption and owned work, not prior platform buffering, synchronous preemption, fleet-wide cost or generic socket-disconnect behavior.

## Failures and uncertain decisions

Worker transport failures have fixed bodies and codes: HTTP 400 `invalid_request`, 401 `unauthorized_service`, or 503 `coordinator_unavailable`. Checked domain results, including domain failures, use HTTP 200 and the existing codec. The server client returns those checked domain results; every transport failure throws only `pairing_transport_unavailable`, without a cause or reflected body, token, account, URL or upstream exception. Never log transport bodies: they contain pairing capabilities.

A timeout or lost response after dispatch may follow a committed durable operation. There is no automatic retry, rollback claim or permission to replay an OAuth code. Reconcile the same retained attempt through the existing identity flow before replacing it. Even `browserStatus` can advance durable expiry state, so it is not a storage-read-only API.

## Validation and remaining qualification

Synthetic tests cover all four operations, fixed failures, input ownership, synchronous context capture, registration-before-I/O, redirects, byte limits, stale authority, delayed timers, late replies, disposal and held-capacity cleanup. The public-binding fixture uses the real installed `getContext` export with synthetic platform context, mocked Next lifetime and mocked fetch; it checks isolation and absence of environment fallback. It does not prove a deployed Vercel request or token.

Run `bun test pairing-http.test.ts lib/usage/pairing-vercel.test.ts` for the transport and isolated public-binding fixtures. `bun run scripts/usage-worker-tools.ts test-pairing-http` selects the real local Worker contract through the credential-isolated runner; do not substitute a remote binding or invoke its child directly. Both suites are included in the repository's complete `bun run check`.

A bounded local workerd fixture passed initialization/disposal, all four handler operations, wrong-context rejection, durable approval readback and the unchanged default 503. It used synthetic workload authority, real RPC replies and request lifetime, nine sequential incoming requests, no outbound requests and completed runtime disposal. A direct control reproduced null-prototype rejection and accepted an ordinary copy of the same checked fields. This qualifies the tested local RPC composition, not live JWT/context compatibility, HTTP disconnect behavior, production routing, provider bindings, account pairing or upload readiness. Keep the default Worker unavailable and production resolver absent until the separate activation gates pass.
