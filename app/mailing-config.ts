import type { HranessMailingListConfig } from "@hraness/site-footer";

const AICHARTS_MAILING_AUDIENCE = "aicharts";

export function aiChartsMailingListConfig(): HranessMailingListConfig {
  return {
    audience: AICHARTS_MAILING_AUDIENCE,
    kind: "signup",
  };
}
