"use client";

import { RouteErrorState, type RouteErrorProps } from "@/components/route-state";
import "./globals.css";

export default function GlobalError(props: RouteErrorProps) {
  return <html lang="en"><body><RouteErrorState {...props} /></body></html>;
}
