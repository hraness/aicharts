import { describe, expect, test } from "bun:test";
import {
  PREVIEW_NOTICE_ORIGIN_ENV,
  PREVIEW_ROBOTS_HEADER,
  PREVIEW_ROBOTS_POLICY,
  PRODUCTION_DELIVERY_PROOF_HEADER,
  productionDeliveryProofToken,
} from "@hraness/vercel-delivery";

import { INDEX_MODEL_PAGES } from "@/lib/index-model-pages";
import { MODEL_CARD_PRESENTATIONS } from "@/lib/model-card-collection";
import { modelCardRouteStatus } from "@/lib/model-card-route-status";

import nextConfig, { createNextConfig, MODEL_ROUTE_REDIRECTS, SECURITY_HEADERS } from "./next.config";

const identity = {
  VERCEL: "1",
  VERCEL_DEPLOYMENT_ID: "dpl_AiChartsPreview123",
  VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  VERCEL_PROJECT_ID: "prj_AiChartsProject123",
} as const;

describe("site migration redirects", () => {
  test("permanently redirects legacy and www hosts to the canonical domain", async () => {
    if (nextConfig.redirects === undefined) {
      throw new Error("Next.js redirects are not configured.");
    }

    const redirects = await nextConfig.redirects();
    expect(redirects.map(redirect => ({
      destination: redirect.destination,
      host: redirect.has?.find(condition => condition.type === "host")?.value,
      permanent: redirect.permanent,
      source: redirect.source,
      statusCode: redirect.statusCode,
    }))).toEqual([
      {
        destination: "https://aicharts.io/:path*",
        host: "codingchart.com",
        permanent: undefined,
        source: "/:path*",
        statusCode: 301,
      },
      {
        destination: "https://aicharts.io/:path*",
        host: "www.codingchart.com",
        permanent: undefined,
        source: "/:path*",
        statusCode: 301,
      },
      {
        destination: "https://aicharts.io/:path*",
        host: "www.aicharts.io",
        permanent: true,
        source: "/:path*",
        statusCode: undefined,
      },
      ...MODEL_ROUTE_REDIRECTS.map(([source, destination]) => ({
        destination,
        host: undefined,
        permanent: true,
        source,
        statusCode: undefined,
      })),
      {
        destination: "/blog/open-models-coding-agent-benchmarks",
        host: undefined,
        permanent: true,
        source: "/blog/are-open-models-catching-up",
        statusCode: undefined,
      },
    ]);
  });

  test("sends each retired model route to one published, indexable model card", () => {
    const cardPaths = new Set(MODEL_CARD_PRESENTATIONS.map(card => card.path));
    const indexPaths = new Set(INDEX_MODEL_PAGES.map(page => page.path));
    const indexableCardPaths = new Set(MODEL_CARD_PRESENTATIONS
      .filter(card => !modelCardRouteStatus(card).isProvisional)
      .map(card => card.path));
    const sources = MODEL_ROUTE_REDIRECTS.map(([source]) => source);

    expect(new Set(sources).size).toBe(sources.length);
    for (const [source, destination] of MODEL_ROUTE_REDIRECTS) {
      expect(cardPaths.has(source)).toBe(false);
      expect(indexPaths.has(source)).toBe(false);
      expect(indexableCardPaths.has(destination)).toBe(true);
    }
    expect(Object.fromEntries(MODEL_ROUTE_REDIRECTS)).toMatchObject({
      "/models/anthropic/claude-opus-5-5/index": "/models/anthropic/claude-opus-5.5/max",
      "/models/unlisted/glm-5-3.fffd32adf07098d3cd835ee1/default": "/models/zai/glm-5.3/default",
      "/models/xai/grok-4-7/index": "/models/spacexai/grok-4.7/xhigh",
    });
  });

  test("preserves redirects while adding the generic Preview delivery contract", async () => {
    const environment = {
      ...identity,
      VERCEL_ENV: "preview",
      VERCEL_URL: "aicharts-git-example-hraness.vercel.app",
    } as const;
    const config = createNextConfig(environment);
    const headers = await config.headers?.();

    expect(config.redirects).toBe(nextConfig.redirects);
    expect(config.env?.[PREVIEW_NOTICE_ORIGIN_ENV]).toBe(
      "https://aicharts-git-example-hraness.vercel.app",
    );
    expect(headers).toEqual([
      { headers: [...SECURITY_HEADERS], source: "/:path*" },
      {
        headers: [
          {
            key: PRODUCTION_DELIVERY_PROOF_HEADER,
            value: productionDeliveryProofToken({
              deploymentId: identity.VERCEL_DEPLOYMENT_ID,
              projectId: identity.VERCEL_PROJECT_ID,
              projectName: "aicharts",
              sha: identity.VERCEL_GIT_COMMIT_SHA,
            }),
          },
          { key: PREVIEW_ROBOTS_HEADER, value: PREVIEW_ROBOTS_POLICY },
        ],
        source: "/:path*",
      },
    ]);
  });
});

describe("security headers", () => {
  test("sends the baseline headers on every route and forbids framing", async () => {
    const rules = await nextConfig.headers?.();
    const rule = rules?.find(entry => entry.source === "/:path*" && entry.headers.some(h => h.key === "Content-Security-Policy"));
    const byKey = new Map(rule?.headers.map(h => [h.key, h.value]));
    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
    expect(byKey.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(byKey.get("Permissions-Policy")).toContain("camera=()");
    expect(byKey.get("Strict-Transport-Security")).toContain("max-age=");
    expect(byKey.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(byKey.get("Content-Security-Policy")).toContain("object-src 'none'");
  });
});
