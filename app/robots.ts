import type { MetadataRoute } from "next";

import { site } from "./site";

export default function robots(): MetadataRoute.Robots {
  return {
    host: site.origin,
    rules: [
      { userAgent: "*", allow: "/" },
      { userAgent: "OAI-SearchBot", allow: "/" },
    ],
    sitemap: `${site.origin}/sitemap.xml`,
  };
}
