import { WorkerEntrypoint } from "cloudflare:workers";
import { retiredResponse } from "./usage-worker-internal.mjs";

export {
  AccountEnrollment,
  PairingIntent,
  RestoreFence,
  retiredHandler as default,
} from "./usage-worker-internal.mjs";

export function createSyntheticQualificationHandler() {
  return async () => retiredResponse();
}

export class SyntheticQualification extends WorkerEntrypoint {
  async fetch() {
    return retiredResponse();
  }
}
