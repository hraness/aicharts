export { PairingIntent } from "./pairing";
export { AccountEnrollment } from "./enrollment";

/** No network adapter is admitted until browser freshness and enrollment exist. */
export default {
  fetch(): Response {
    return new Response('{"error":"usage_service_unavailable"}', {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  },
} satisfies ExportedHandler<Env>;
