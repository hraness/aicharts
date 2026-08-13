import type { ReactNode } from "react";

export function JsonLdScript({
  data,
  id,
}: Readonly<{
  data: unknown;
  id: string;
}>): ReactNode {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replaceAll("<", "\\u003c"),
      }}
      id={id}
      type="application/ld+json"
    />
  );
}
