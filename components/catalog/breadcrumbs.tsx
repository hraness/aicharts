import { SITE_URL } from "@/lib/catalog";
import { JsonLd } from "./json-ld";

export type Crumb = Readonly<{ name: string; href: string }>;

/** The trail ends at the current page, which is not a link. */
export function Breadcrumbs({ trail }: Readonly<{ trail: readonly Crumb[] }>) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>
        {trail.map((crumb, i) => (
          <li key={crumb.href}>
            {i < trail.length - 1 ? (
              <a href={crumb.href}>{crumb.name}</a>
            ) : (
              <span aria-current="page">{crumb.name}</span>
            )}
          </li>
        ))}
      </ol>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: trail.map((crumb, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: crumb.name,
            item: SITE_URL + crumb.href,
          })),
        }}
      />
    </nav>
  );
}
