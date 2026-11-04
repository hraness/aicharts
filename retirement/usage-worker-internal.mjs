import { DurableObject } from "cloudflare:workers";

export function retiredResponse() {
  return new Response("AI Charts is retired.\n", {
    status: 410,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export const retiredHandler = {
  async fetch() {
    return retiredResponse();
  },
};

class RetiredDurableObject extends DurableObject {
  async fetch() {
    return retiredResponse();
  }

  async alarm() {
    // Complete delivery without reading, writing, or rearming an alarm.
  }
}

export class AccountEnrollment extends RetiredDurableObject {}
export class LeaderboardIndex extends RetiredDurableObject {}
export class PairingIntent extends RetiredDurableObject {}
export class RestoreFence extends RetiredDurableObject {}
