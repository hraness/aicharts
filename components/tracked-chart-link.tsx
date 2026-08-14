"use client";

import { captureContentEvent } from "@/lib/analytics";
import Link from "next/link";
import type { ReactNode } from "react";

export function TrackedChartLink({
  children,
  className,
  sourceKind,
}: Readonly<{
  children: ReactNode;
  className?: string;
  sourceKind: "blog_article" | "blog_index";
}>) {
  return (
    <Link
      className={className}
      href="/"
      onClick={() => captureContentEvent({
        name: "content chart opened",
        properties: {
          destination_chart: "coding_agents",
          source_kind: sourceKind,
        },
      })}
    >
      {children}
    </Link>
  );
}
