export type PostHogEndpoint = Readonly<{
  apiHost: "https://eu.i.posthog.com" | "https://us.i.posthog.com";
  uiHost: "https://eu.posthog.com" | "https://us.posthog.com";
}>;

const defaultApiHost = "https://us.i.posthog.com" as const;
const approvedEndpoints = new Map<string, PostHogEndpoint>([
  [defaultApiHost, { apiHost: defaultApiHost, uiHost: "https://us.posthog.com" }],
  [
    "https://eu.i.posthog.com",
    { apiHost: "https://eu.i.posthog.com", uiHost: "https://eu.posthog.com" },
  ],
]);

/** Resolve only the two documented regional ingest origins; malformed values fail closed. */
export function approvedPostHogEndpoint(value: unknown): PostHogEndpoint | null {
  const candidate = value === undefined ? defaultApiHost : value;
  if (typeof candidate !== "string") return null;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.username.length > 0
      || parsed.password.length > 0
      || parsed.pathname !== "/"
      || parsed.search.length > 0
      || parsed.hash.length > 0
    ) return null;
    return approvedEndpoints.get(parsed.origin) ?? null;
  } catch {
    return null;
  }
}
