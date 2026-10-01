"use client";

import { RouteErrorPage, type RouteErrorPageProps } from "@hraness/design-kit/react";
import { useEffect } from "react";

import { captureAnalyticsException } from "@/lib/analytics";

import { site } from "./site";

export default function RouteError(props: RouteErrorPageProps) {
  useEffect(() => { captureAnalyticsException(props.error, "route_error_boundary"); }, [props.error]);
  return (
    <div className="hraness-site-shell__content" data-analytics-surface="error_recovery">
      <RouteErrorPage {...props} siteName={site.name} />
    </div>
  );
}
