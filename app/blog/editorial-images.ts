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
  [Slug in BlogSlug]: BlogEditorialImage<Slug>;
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
  "small-models-have-arrived": image(
    "small-models-have-arrived",
    "A compact blue and coral computing core moves a light stream through a modular machine beside a separate taller structure.",
    "Consumer inference cost and coding-agent benchmark performance are separate questions.",
    "f6bfe3d262147db6408e069df98803277b34b1f471eb61f03a51a7ef2eb51330",
    "e29d12c19ab8ff27d923fe92a66207897a19522f4f59ecdfc7d0c8bfff7a9cf8",
    "20260829T044909987Z-image-8a112f56-e2a/receipt.json",
    "gateway_b77cf0ef88e742678bb8a594e8dcfcee.json",
  ),
  "are-open-models-catching-up": image(
    "are-open-models-catching-up",
    "Open modular components approach a dark gate beside a separately integrated tool system.",
    "A closing benchmark gap does not erase the product layer around a model.",
    "e96546990341ce2e1082a856016e46dedddfed9568f4cd0c6dda28bfdd29e385",
    "e020b195cacae4e6135dca805d35f060c0ecf0856a86c81dc04c045ede05ded8",
    "20260829T045119641Z-image-fe10f8ca-acc/receipt.json",
    "gateway_b3f9a421d0b149409c07dce46ddedc5c.json",
  ),
  "coding-agent-scores-still-need-expertise": image(
    "coding-agent-scores-still-need-expertise",
    "Hands inspect and align one path through a branching mechanical system on paper.",
    "A task score still needs a person who can specify the work and judge the result.",
    "918be37c7f50cddab799fb6d4cfb4a2b25eb09850ea6ac471654c2d58a39c8c4",
    "0e366967623c791b2db05cdbf3115de9719e4f4176b579eb38b358caf1f1d22d",
    "20260829T045334214Z-image-adfc884a-0f2/receipt.json",
    "gateway_372083261e9c4a7aae8af256c9bfd24b.json",
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
  "slopcodebench-long-horizon-coding-agents": image(
    "slopcodebench-long-horizon-coding-agents",
    "A clean modular structure grows into a longer construction with denser duplicated additions and awkward braces.",
    "Later changes inherit every earlier structural decision; the illustration is not a measured trajectory.",
    "ce552845580b975f6a8c3fb1cd6d150c70e1fc7ef466068654a8ac301dcd4b32",
    "e845ab6a7a4980b72d385d1f929f797edbe68bfc92f4069c5a2caaea0f1e6c91",
    "20260829T045808335Z-image-d89ed557-fba/receipt.json",
    "gateway_b8ea95991c3b42b8a52b141a51324a80.json",
  ),
} as const satisfies EditorialImageRecord;

export function blogEditorialImage<Slug extends BlogSlug>(
  slug: Slug,
): BlogEditorialImage<Slug> {
  return BLOG_EDITORIAL_IMAGES[slug] as BlogEditorialImage<Slug>;
}

export const blogEditorialImages = Object.values(BLOG_EDITORIAL_IMAGES);
