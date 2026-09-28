import { createSiteSocialImageResponse } from "@hraness/web-discovery/social-image";

import { aichartsSocialImageSite, modelsSocialImagePage } from "../../social-image-site";

export const dynamic = "force-static";

export function GET() {
  return createSiteSocialImageResponse(aichartsSocialImageSite, modelsSocialImagePage);
}
