import { describe, expect, test } from "bun:test";
import { HranessSiteFooter } from "@hraness/site-footer/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AICHARTS_MAILING_TURNSTILE_SITEKEY_ENV,
  aiChartsMailingListConfig,
} from "./mailing-config";

describe("AI Charts mailing configuration", () => {
  test("binds the public widget key to the AI Charts audience", () => {
    const turnstileSitekey = "1x00000000000000000000AA";
    const mailingList = aiChartsMailingListConfig({
      [AICHARTS_MAILING_TURNSTILE_SITEKEY_ENV]: turnstileSitekey,
    });
    expect(mailingList).toEqual({
      audience: "aicharts",
      kind: "signup",
      turnstileSitekey,
    });

    const html = renderToStaticMarkup(createElement(HranessSiteFooter, {
      mailingList,
    }));
    expect(html).toContain('action="https://account.hraness.com/api/mailing/subscribe"');
    expect(html).toContain('name="audience" type="hidden" value="aicharts"');
    expect(html).toContain('data-action="mailing_aicharts"');
    expect(html).toContain('aria-label="Hraness on X"');
    expect(html).toContain('aria-label="Hraness on GitHub"');
    expect(html).not.toContain('name="audience" type="hidden" value="hraness"');
  });

  test("fails closed on missing or malformed public widget keys", () => {
    for (const turnstileSitekey of [
      undefined,
      "too-short",
      "1x00000000000000000000AA!",
    ]) {
      expect(() => aiChartsMailingListConfig({
        [AICHARTS_MAILING_TURNSTILE_SITEKEY_ENV]: turnstileSitekey,
      })).toThrow(AICHARTS_MAILING_TURNSTILE_SITEKEY_ENV);
    }
  });
});
