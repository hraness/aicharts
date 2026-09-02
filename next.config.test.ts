import { describe, expect, test } from "bun:test";
import {
  PREVIEW_NOTICE_ORIGIN_ENV,
  PREVIEW_ROBOTS_HEADER,
  PREVIEW_ROBOTS_POLICY,
  PRODUCTION_DELIVERY_PROOF_HEADER,
  productionDeliveryProofToken,
} from "@hraness/vercel-delivery";

import nextConfig, { createNextConfig } from "./next.config";

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
      {
        destination: "/blog/open-models-coding-agent-benchmarks",
        host: undefined,
        permanent: true,
        source: "/blog/are-open-models-catching-up",
        statusCode: undefined,
      },
      {
        destination: "/blog/coding-agent-score-holdouts",
        host: undefined,
        permanent: true,
        source: "/blog/benchmarkpocalypse",
        statusCode: undefined,
      },
    ]);
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
