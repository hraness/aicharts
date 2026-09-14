// The qualification driver uses the repository's native Node 24 runtime.
// Parameter properties require Node's --experimental-transform-types flag:
// https://nodejs.org/docs/latest-v24.x/api/typescript.html#type-stripping
import * as nodeModule from "node:module";

if (process.versions.bun !== undefined || process.release.name !== "node"
  || !/^24\./u.test(process.versions.node) || typeof nodeModule.registerHooks !== "function"
  || typeof import.meta.main !== "boolean") {
  throw new Error("usage-cloudflare-node: native_node_24_required");
}
if (!process.execArgv.includes("--experimental-transform-types")) {
  throw new Error("usage-cloudflare-node: transform_types_flag_required");
}

const repository = new URL("../", import.meta.url);
const sourceUrl = relative => new URL(relative, repository).href;
const edges = new Map([
  [sourceUrl("scripts/usage-cloudflare-qualification.ts"), new Map([
    ["../fixtures/usage/cloudflare-qualification", sourceUrl("fixtures/usage/cloudflare-qualification.ts")],
    ["../lib/usage/admission", sourceUrl("lib/usage/admission.ts")],
    ["../lib/usage/wire", sourceUrl("lib/usage/wire.ts")],
    ["../services/usage-worker/src/admission-policy", sourceUrl("services/usage-worker/src/admission-policy.ts")],
  ])],
  [sourceUrl("fixtures/usage/cloudflare-qualification.ts"), new Map([
    ["../../lib/usage/admission", sourceUrl("lib/usage/admission.ts")],
    ["../../lib/usage/private-days-contract", sourceUrl("lib/usage/private-days-contract.ts")],
    ["../../lib/usage/wire", sourceUrl("lib/usage/wire.ts")],
    ["../../services/usage-worker/src/admission-policy", sourceUrl("services/usage-worker/src/admission-policy.ts")],
  ])],
  [sourceUrl("lib/usage/admission.ts"), new Map([
    ["../result", sourceUrl("lib/result.ts")],
    ["./wire", sourceUrl("lib/usage/wire.ts")],
  ])],
  [sourceUrl("lib/usage/private-days-contract.ts"), new Map([
    ["./wire", sourceUrl("lib/usage/wire.ts")],
  ])],
  [sourceUrl("lib/usage/wire.ts"), new Map([
    ["../result", sourceUrl("lib/result.ts")],
  ])],
  [sourceUrl("services/usage-worker/src/admission-policy.ts"), new Map([
    ["../../../lib/usage/admission", sourceUrl("lib/usage/admission.ts")],
    ["../../../lib/usage/wire", sourceUrl("lib/usage/wire.ts")],
  ])],
  [sourceUrl("services/usage-worker/src/namespace-anchor.ts"), new Map([
    ["./enrollment-contract", sourceUrl("services/usage-worker/src/enrollment-contract.ts")],
  ])],
]);

nodeModule.registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = edges.get(context.parentURL)?.get(specifier);
    // No extension search or load hook: original files and import.meta.url stay
    // intact. Node owns every unmatched relative, URL, node:, and package import.
    return nextResolve(target ?? specifier, context);
  },
});
