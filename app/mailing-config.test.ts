import { describe, expect, test } from "bun:test";
import { HranessSiteFooter } from "@hraness/site-footer/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AICHARTS_MAILING_TURNSTILE_SITEKEY_ENV,
  aiChartsMailingListConfig,
} from "./mailing-config";

describe("AI Charts mailing configuration", () => {
  test("documents unsubscribe scope for confirmed newsletter subscriptions", async () => {
    const readme = (await Bun.file(new URL("../README.md", import.meta.url)).text())
      .replace(/\s+/gu, " ");

    expect(readme).toContain(
      "After confirmation, each newsletter message includes an AI Charts-specific unsubscribe link, which does not change subscriptions to other Hraness products.",
    );
    expect(readme).not.toContain("Every message includes an AI Charts-specific unsubscribe link");
  });

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
    expect(html).toContain('href="https://www.linkedin.com/company/hraness"');
    expect(html).toContain('href="https://substack.com/@hraness"');
    expect(html).toContain('href="https://hraness.com/"');
    expect(html).not.toContain("bsky.app");
    expect(html).not.toContain("Bluesky");
    expect(html).not.toContain('name="audience" type="hidden" value="hraness"');
  });

  test("retargets X and GitHub to the AI Charts profiles", () => {
    const html = renderToStaticMarkup(createElement(HranessSiteFooter, {
      mailingList: aiChartsMailingListConfig({
        [AICHARTS_MAILING_TURNSTILE_SITEKEY_ENV]: "1x00000000000000000000AA",
      }),
      social: {
        x: { href: "https://x.com/aichartsio", label: "AI Charts on X" },
        github: { href: "https://github.com/hraness/aicharts", label: "AI Charts on GitHub" },
      },
    }));

    expect(html).toContain('href="https://x.com/aichartsio"');
    expect(html).toContain('aria-label="AI Charts on X"');
    expect(html).toContain('href="https://github.com/hraness/aicharts"');
    expect(html).toContain('aria-label="AI Charts on GitHub"');
    expect(html).toContain('href="https://www.linkedin.com/company/hraness"');
    expect(html).toContain('href="https://substack.com/@hraness"');
    expect(html).toContain('href="https://hraness.com/"');
    expect(html).not.toContain('href="https://x.com/hraness"');
    expect(html).not.toContain('href="https://github.com/hraness"');
    expect(html).not.toContain("bsky.app");
    expect(html).not.toContain("Bluesky");
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
