import { describe, expect, test } from "bun:test";

import nextConfig from "./next.config";

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
    ]);
  });
});
