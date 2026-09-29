import { describe, expect, test } from "bun:test";
import { HranessSiteFooter } from "@hraness/site-footer/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { aiChartsMailingListConfig } from "./mailing-config";

describe("aicharts mailing configuration", () => {
  test("documents unsubscribe scope for confirmed newsletter subscriptions", async () => {
    const readme = (await Bun.file(new URL("../README.md", import.meta.url)).text())
      .replace(/\s+/gu, " ");

    expect(readme).toContain(
      "After confirmation, each newsletter message includes an aicharts-specific unsubscribe link, which does not change subscriptions to other Hraness products.",
    );
    expect(readme).not.toContain("Every message includes an aicharts-specific unsubscribe link");
  });

  test("binds the stable aicharts audience unconditionally", () => {
    const mailingList = aiChartsMailingListConfig();
    expect(mailingList).toEqual({
      audience: "aicharts",
      kind: "signup",
    });

    const html = renderToStaticMarkup(createElement(HranessSiteFooter, {
      mailingList,
    }));
    expect(html).toContain('action="https://account.hraness.com/api/mailing/subscribe"');
    expect(html).toContain('name="audience" type="hidden" value="aicharts"');
    expect(html).toContain('name="website"');
    expect(html).toContain('data-state="idle"');
    expect(html).toContain('aria-label="Hraness on X"');
    expect(html).toContain('aria-label="Hraness on GitHub"');
    expect(html).toContain('href="https://www.linkedin.com/company/hraness"');
    expect(html).toContain('href="https://substack.com/@hraness"');
    expect(html).toContain('href="https://hraness.com/"');
    expect(html).not.toContain("data-sitekey");
    expect(html).not.toContain("bsky.app");
    expect(html).not.toContain("Bluesky");
    expect(html).not.toContain('name="audience" type="hidden" value="hraness"');
  });

  test("retargets X and GitHub to the aicharts profiles", () => {
    const html = renderToStaticMarkup(createElement(HranessSiteFooter, {
      mailingList: aiChartsMailingListConfig(),
      social: {
        x: { href: "https://x.com/aichartsio", label: "aicharts on X" },
        github: { href: "https://github.com/hraness/aicharts", label: "aicharts on GitHub" },
      },
    }));

    expect(html).toContain('href="https://x.com/aichartsio"');
    expect(html).toContain('aria-label="aicharts on X"');
    expect(html).toContain('href="https://github.com/hraness/aicharts"');
    expect(html).toContain('aria-label="aicharts on GitHub"');
    expect(html).toContain('href="https://www.linkedin.com/company/hraness"');
    expect(html).toContain('href="https://substack.com/@hraness"');
    expect(html).toContain('href="https://hraness.com/"');
    expect(html).not.toContain('href="https://x.com/hraness"');
    expect(html).not.toContain('href="https://github.com/hraness"');
    expect(html).not.toContain("bsky.app");
    expect(html).not.toContain("Bluesky");
  });

  test("keeps the package-owned Hraness attribution alongside the aicharts audience and profiles", () => {
    const html = renderToStaticMarkup(createElement(HranessSiteFooter, {
      mailingList: aiChartsMailingListConfig(),
      social: {
        x: { href: "https://x.com/aichartsio", label: "aicharts on X" },
        github: { href: "https://github.com/hraness/aicharts", label: "aicharts on GitHub" },
      },
      support: {
        id: "aicharts",
        name: "aicharts",
        updates: true,
        valueProposition: "Support sourced benchmark research and clear, interactive model comparisons.",
      },
    }));

    expect(html.match(/data-slot="hraness-site-footer"/gu)).toHaveLength(1);
    expect(html).toContain('aria-label="Hraness home"');
    expect(html).toContain(">by Hraness</span>");
    expect(html).toContain('name="audience" type="hidden" value="aicharts"');
    expect(html).toContain('href="https://x.com/aichartsio"');
    expect(html).not.toContain("Ben Guo");
    expect(html).not.toContain("Built by aicharts");
  });
});
