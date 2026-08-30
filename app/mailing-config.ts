import type { HranessMailingListConfig } from "@hraness/site-footer";

export const AICHARTS_MAILING_TURNSTILE_SITEKEY_ENV =
  "NEXT_PUBLIC_HRANESS_MAILING_TURNSTILE_SITEKEY" as const;

const turnstileSitekeyPattern = /^[A-Za-z0-9_-]{20,100}$/u;

export function aiChartsMailingListConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): HranessMailingListConfig {
  const turnstileSitekey =
    environment[AICHARTS_MAILING_TURNSTILE_SITEKEY_ENV];
  if (
    turnstileSitekey === undefined
    || !turnstileSitekeyPattern.test(turnstileSitekey)
  ) {
    throw new Error(
      `${AICHARTS_MAILING_TURNSTILE_SITEKEY_ENV} must be a valid public Turnstile site key.`,
    );
  }

  return {
    audience: "aicharts",
    kind: "signup",
    turnstileSitekey,
  };
}
