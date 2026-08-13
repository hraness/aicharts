"use client";

import { RouteErrorState, type RouteErrorProps } from "@/components/route-state";

export default function RouteError(props: RouteErrorProps) {
  return <RouteErrorState {...props} />;
}
