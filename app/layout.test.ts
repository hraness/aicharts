import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import RootLayout from "./layout";

test("the root layout renders the in-flow content footer and the shared Hraness footer after every route", async () => {
  const source = await Bun.file(new URL("./layout.tsx", import.meta.url)).text();
  const children = source.indexOf("{children}");
  const contentFooter = source.indexOf("<MarketingSiteFooter");
  const footer = source.indexOf("<HranessSiteFooter");
  const analytics = source.indexOf("<AnalyticsBoundary />");
  const foil = source.indexOf("<FoilController />");

  expect(source).toContain('from "@hraness/design-kit/react/server"');
  expect(source).toContain('from "@hraness/site-footer/react"');
  expect(source).toContain('from "@/components/analytics-boundary"');
  expect(source).toContain('from "@/components/foil-controller"');
  expect(source).toContain('from "@/components/site-header"');
  expect(source).toContain('from "./mailing-config"');
  expect(source).toContain('ariaLabel="AI Charts"');
  expect(source).toContain('src="/icon.png"');
  expect(source).toContain('brandLabel="AI Charts home"');
  expect(source).toContain("links={SITE_HEADER_LINKS}");
  expect(source).toContain("name={site.name}");
  expect(source).toContain("mailingList={aiChartsMailingListConfig()}");
  expect(source).toContain('x: { href: "https://x.com/aichartsio", label: "AI Charts on X" }');
  expect(source).toContain(
    'github: { href: "https://github.com/hraness/aicharts", label: "AI Charts on GitHub" }',
  );
  expect(source).not.toContain("bsky.app");
  expect(source).not.toContain("bluesky");
  expect(children).toBeGreaterThan(-1);
  expect(contentFooter).toBeGreaterThan(children);
  expect(footer).toBeGreaterThan(contentFooter);
  expect(analytics).toBeGreaterThan(footer);
  expect(foil).toBeGreaterThan(analytics);
});

test("every route inherits one in-flow content footer and one shared footer carrying the package-owned Hraness attribution", () => {
  const marker = "route-content-marker";
  const html = renderToStaticMarkup(createElement(
    RootLayout,
    null,
    createElement("main", { id: marker }, "Route content"),
  ));

  expect(html.match(/data-hraness-marketing="footer"/gu)).toHaveLength(1);
  expect(html.match(/id="hraness-site-footer"/gu)).toHaveLength(1);
  expect(html.match(/data-slot="hraness-site-footer"/gu)).toHaveLength(1);
  expect(html).toContain('aria-label="AI Charts"');
  expect(html).toContain('aria-label="AI Charts home"');
  expect(html).toContain('src="/icon.png"');
  expect(html).toContain(">AI Charts</span>");
  expect(html).toContain('aria-label="Hraness home"');
  expect(html).toContain(">by Hraness</span>");
  expect(html.indexOf(`id="${marker}"`)).toBeLessThan(html.indexOf('data-hraness-marketing="footer"'));
  expect(html.indexOf('data-hraness-marketing="footer"')).toBeLessThan(html.indexOf('id="hraness-site-footer"'));
  expect(html).toContain('name="audience" type="hidden" value="aicharts"');
  expect(html).toContain('href="https://x.com/aichartsio"');
  expect(html).not.toContain("Ben Guo");
  expect(html).not.toContain("Built by AI Charts");
});

test("no page or component supplies its own maker credit beside the shared attribution", async () => {
  const glob = new Bun.Glob("**/*.{ts,tsx,css}");
  const roots = ["app", "components", "styles"].map(root => new URL(`../${root}/`, import.meta.url));
  const offenders: string[] = [];
  for (const root of roots) {
    for await (const path of glob.scan({ cwd: root.pathname })) {
      if (/\.test\.tsx?$/u.test(path)) continue;
      const text = await Bun.file(new URL(path, root)).text();
      if (/Ben Guo|Built by Ben|MarketingMaker|hraness-marketing-maker|https:\/\/x\.com\/hraness"/u.test(text)) {
        offenders.push(path);
      }
    }
  }
  expect(offenders).toEqual([]);
});
