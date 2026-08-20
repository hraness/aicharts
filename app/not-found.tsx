import { createPrivateSiteMetadata } from "@hraness/web-discovery";
import { RouteNotFoundState } from "@/components/route-state";

import { notFoundSearchSite } from "./site";

export const metadata = createPrivateSiteMetadata(notFoundSearchSite);

export default function NotFound() {
  return <RouteNotFoundState />;
}
