import type { Metadata } from "next";

export const LARGE_SOCIAL_IMAGE = {
  height: 630,
  width: 1200,
} as const;

export const INDEXABLE_ROBOTS = {
  follow: true,
  googleBot: {
    follow: true,
    index: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
  },
  index: true,
} as const satisfies NonNullable<Metadata["robots"]>;

export type OwnedPath = `/${string}`;

export type SearchSite = Readonly<{
  applicationName?: string;
  category?: string;
  creator?: string;
  description: string;
  language?: string;
  locale?: string;
  name: string;
  origin: `https://${string}`;
  publisher?: string;
  socialImage?: Readonly<{
    alt: string;
    height?: number;
    path: OwnedPath;
    width?: number;
  }>;
  socialTitle?: string;
  title: string;
  titleTemplate?: string;
}>;

function parsedOrigin(origin: SearchSite["origin"]): URL {
  const parsed = new URL(origin);
  if (
    parsed.protocol !== "https:"
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.pathname !== "/"
    || parsed.search.length > 0
    || parsed.hash.length > 0
  ) {
    throw new RangeError(`Search origins must be bare HTTPS origins; received ${origin}.`);
  }
  return parsed;
}

function assertOwnedPath(path: string): asserts path is OwnedPath {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new RangeError(`Owned paths must be root-relative; received ${path}.`);
  }
  const parsed = new URL(path, "https://owned.invalid");
  if (
    parsed.origin !== "https://owned.invalid"
    || parsed.search.length > 0
    || parsed.hash.length > 0
    || parsed.pathname !== path
  ) {
    throw new RangeError(`Owned paths must not change origin or require normalization; received ${path}.`);
  }
}

export function absoluteWebUrl(origin: SearchSite["origin"], path: OwnedPath): string {
  const base = parsedOrigin(origin);
  assertOwnedPath(path);
  return new URL(path, base).toString();
}

function socialImage(site: SearchSite) {
  const image = site.socialImage ?? {
    alt: `${site.name} — ${site.description}`,
    path: "/opengraph-image" as const,
  };
  return {
    alt: image.alt,
    height: image.height ?? LARGE_SOCIAL_IMAGE.height,
    url: absoluteWebUrl(site.origin, image.path),
    width: image.width ?? LARGE_SOCIAL_IMAGE.width,
  };
}

export function createPublicSiteMetadata(
  site: SearchSite,
  options: Readonly<{ canonicalPath?: OwnedPath }> = {},
): Metadata {
  const canonical = absoluteWebUrl(site.origin, options.canonicalPath ?? "/");
  const image = socialImage(site);
  const socialTitle = site.socialTitle ?? site.title;
  return {
    metadataBase: parsedOrigin(site.origin),
    title: site.titleTemplate === undefined
      ? site.title
      : { default: site.title, template: site.titleTemplate },
    description: site.description,
    applicationName: site.applicationName ?? site.name,
    alternates: { canonical },
    openGraph: {
      type: "website",
      url: canonical,
      siteName: site.name,
      title: socialTitle,
      description: site.description,
      locale: site.locale ?? "en_US",
      images: [image],
    },
    robots: INDEXABLE_ROBOTS,
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: site.description,
      images: [{ alt: image.alt, url: image.url }],
    },
  };
}
