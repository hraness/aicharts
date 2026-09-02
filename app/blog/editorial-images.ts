import type { BlogSlug } from "./articles";

export const EDITORIAL_IMAGE_WIDTH = 1536;
export const EDITORIAL_IMAGE_HEIGHT = 864;
export const EDITORIAL_IMAGE_CREDIT =
  "AI Charts editorial illustration · Atet with GPT Image 2";

export type BlogEditorialImage<Slug extends BlogSlug = BlogSlug> = Readonly<{
  alt: string;
  caption: string;
  credit: typeof EDITORIAL_IMAGE_CREDIT;
  height: typeof EDITORIAL_IMAGE_HEIGHT;
  provenance: Readonly<{
    job: `gateway_${string}.json`;
    package: "@hraness/atet@3.1.2";
    promptSha256: string;
    receipt: `${string}/receipt.json`;
  }>;
  sha256: string;
  slug: Slug;
  socialSrc: `/images/blog/${Slug}.webp`;
  src: `/images/blog/${Slug}.webp`;
  width: typeof EDITORIAL_IMAGE_WIDTH;
}>;

type EditorialImageRecord = Readonly<{
  [Slug in BlogSlug]?: BlogEditorialImage<Slug>;
}>;

function image<Slug extends BlogSlug>(
  slug: Slug,
  alt: string,
  caption: string,
  sha256: string,
  promptSha256: string,
  receipt: `${string}/receipt.json`,
  job: `gateway_${string}.json`,
): BlogEditorialImage<Slug> {
  const src = `/images/blog/${slug}.webp` as const;
  return {
    alt,
    caption,
    credit: EDITORIAL_IMAGE_CREDIT,
    height: EDITORIAL_IMAGE_HEIGHT,
    provenance: {
      job,
      package: "@hraness/atet@3.1.2",
      promptSha256,
      receipt,
    },
    sha256,
    slug,
    socialSrc: src,
    src,
    width: EDITORIAL_IMAGE_WIDTH,
  };
}

export const BLOG_EDITORIAL_IMAGES = {
  "terminal-bench-science": image(
    "terminal-bench-science",
    "Paper-cutout hands hold a high charcoal measuring beam while a compact cobalt apparatus reaches only partway, with coral and mint weights on a low tray.",
    "Scientists set the task set; this illustration separates completion, evaluation cost, and token use. It is not a data plot.",
    "25b0982fb419a0e7caa8551c1521950a70ae10ac84d12d8cd765c705015f4541",
    "a233bd9a0784c0f26b90201a57e315b9d642a0f3b285256a204e25041df14be3",
    "20260831T132600000Z-image-25b0982f-tbs/receipt.json",
    "gateway_db4be239e6db4bae5aa62a424e6e6a4c.json",
  ),
  "coding-agent-score-holdouts": image(
    "coding-agent-score-holdouts",
    "A modular testing path passes an open gate while an unresolved branch waits behind a folded screen.",
    "Public-suite success does not establish performance on cases the optimizer could not see.",
    "93d3936c6f6af202ea3da59def3563ba184a21779942e7fa7161cd92956667d5",
    "febeb1a517412083a71e2bd9527f96d90cec32da5d975312a45244a8ced78562",
    "20260829T045554012Z-image-79298e96-a51/receipt.json",
    "gateway_9346b1f302c942cd98baad3406be272b.json",
  ),
  "open-models-coding-agent-benchmarks": image(
    "open-models-coding-agent-benchmarks",
    "Several modular systems combine inner cores, tool frames, and adjustable outer rings on one testing surface.",
    "Each result belongs to a complete model, harness, and setting configuration.",
    "bd86b36cda57755c74e7e7c08c04dd7e5d4ac21a4771bd6eb6696dba9fdb2270",
    "bde3d211d39a01393e6118edb2a6a101f15eac042f0fff1d87fde21f68e540be",
    "20260829T045629124Z-image-9eb375f4-52e/receipt.json",
    "gateway_18c21b758a5a476294bdde88c1b45935.json",
  ),
  "aa-index-cost-coding-agents": image(
    "aa-index-cost-coding-agents",
    "Computational modules sit between a dark resource tray and a rising blue capability scaffold.",
    "Cost and benchmark performance form trade-offs, not one universal ranking; the illustration is not a data plot.",
    "59dff83d9eb1a1ce7ebc46d10bc4a11712b260f38ed5e7123944763b98011fc4",
    "0dbf95c4d09574546dff3dc815f4137ea6bf065595f56f0b3168977daca357ad",
    "20260829T045702332Z-image-bde652f9-edb/receipt.json",
    "gateway_8d52216479e2468d8c685877699be66d.json",
  ),
  "mirrorcode-coding-agent-benchmark": image(
    "mirrorcode-coding-agent-benchmark",
    "A hidden machine and a newly assembled machine receive the same inputs and return almost matching physical outputs.",
    "Behavioral reimplementation is judged by outputs, including held-out tests the agent cannot inspect.",
    "1a4823c8de472b1edcb48d5a8ebf7a893c7aad2d26ea52be6cedecb6df331331",
    "489c252eef19475feb415cfee029ba1d0edbb48bbd85b6c2556d331e1036877f",
    "20260829T045733333Z-image-0903f6a9-912/receipt.json",
    "gateway_e99b616d49ae40a9b656442b726178ed.json",
  ),
} as const satisfies EditorialImageRecord;

export function blogEditorialImage<Slug extends BlogSlug>(
  slug: Slug,
): BlogEditorialImage<Slug> | undefined {
  return (BLOG_EDITORIAL_IMAGES as EditorialImageRecord)[slug] as
    | BlogEditorialImage<Slug>
    | undefined;
}

export const blogEditorialImages = Object.values(BLOG_EDITORIAL_IMAGES);
