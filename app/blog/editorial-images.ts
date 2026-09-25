import type { RepresentativeImage } from "@hraness/web-discovery";

import type { BlogSlug } from "./articles";

export const EDITORIAL_IMAGE_WIDTH = 1536;
export const EDITORIAL_IMAGE_HEIGHT = 864;
export const EDITORIAL_IMAGE_CREDIT =
  "AI Charts editorial illustration · Slopcamera with GPT Image 2";
export const ATET_EDITORIAL_IMAGE_CREDIT =
  "AI Charts editorial illustration · Atet with GPT Image 2";
export const ATET_PACKAGE = "@hraness/atet@3.1.2";
export const SLOPCAMERA_PACKAGE = "@hraness/slopcamera";
export const SLOPCAMERA_VERSION = "3.2.5";
export const SLOPCAMERA_SOURCE_COMMIT =
  "66b4322030f4de24f4d5b6d0c2515c109259f901";

export type AtetEditorialProvenance = Readonly<{
  job: `gateway_${string}.json`;
  package: typeof ATET_PACKAGE;
  promptSha256: string;
  receipt: `${string}/receipt.json`;
}>;

export type SlopcameraEditorialProvenance = Readonly<{
  job: `gateway_${string}.json`;
  package: typeof SLOPCAMERA_PACKAGE;
  promptSha256: string;
  receipt: `${string}/receipt.json`;
  sourceCommit: typeof SLOPCAMERA_SOURCE_COMMIT;
  version: typeof SLOPCAMERA_VERSION;
}>;

export type EditorialImageProvenance =
  | AtetEditorialProvenance
  | SlopcameraEditorialProvenance;

export type BlogEditorialImage<Slug extends BlogSlug = BlogSlug> = Readonly<{
  alt: string;
  caption: string;
  credit: typeof EDITORIAL_IMAGE_CREDIT | typeof ATET_EDITORIAL_IMAGE_CREDIT;
  height: typeof EDITORIAL_IMAGE_HEIGHT;
  provenance: EditorialImageProvenance;
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
      package: SLOPCAMERA_PACKAGE,
      promptSha256,
      receipt,
      sourceCommit: SLOPCAMERA_SOURCE_COMMIT,
      version: SLOPCAMERA_VERSION,
    },
    sha256,
    slug,
    socialSrc: src,
    src,
    width: EDITORIAL_IMAGE_WIDTH,
  };
}

export const BLOG_EDITORIAL_IMAGES = {
  "introducing-ai-charts": image(
    "introducing-ai-charts",
    "Seven small ivory forms, from a sphere to a pyramid, sit on separate charcoal plinths along one shelf, each with a blank tag hanging from a thin brass rail.",
    "Each result on AI Charts keeps its own source, version, and retrieval date, and each benchmark stays on its own scale.",
    "a78e4bdcb6a852d67dc0738215690ad7d05ef6065da5fe65adb1b5ca6f695093",
    "3233a72ede320006ad35729ce91c2acf056c7a63a29c302d6d85652794f8d00a",
    "20260924T212044913Z-image-a289b94d-c1e/receipt.json",
    "gateway_1bae97d06d1942f4a81732af7bc5510f.json",
  ),
  "terminal-bench-science": image(
    "terminal-bench-science",
    "A dark circular well sits under a brass-marked measuring beam on a tall stand, with four small brass weights on a round tray.",
    "Scientists set the task set; this illustration separates completion, evaluation cost, and token use. It is not a data plot.",
    "22e027068d7b6ec00916f4020bd5978bb37cdd42ddad9db8c141732b3898768b",
    "826a45b4469a95b6aa1692a976c503dc870421345784dce7279fae06e4b8a743",
    "20260910T235909311Z-image-b0beab7d-9f1/receipt.json",
    "gateway_360f56e67b5543029b3ff5923545f9d6.json",
  ),
  "coding-agent-score-holdouts": image(
    "coding-agent-score-holdouts",
    "A pale path splits: one branch enters a lit arched doorway with an open brass gate, and the other disappears behind a folded black screen.",
    "Public-suite success does not establish performance on cases the optimizer could not see.",
    "0a8c5cd5d0ea2030e8ac5a101c74c3654d70aa7089140d5a86ddf237027bbd3f",
    "a697a3a392f8d50cfa07a44fb100b07aa00d1a4e9643218308a31e2be88477e2",
    "20260910T235934359Z-image-d86ec47b-e72/receipt.json",
    "gateway_80e4fbb62d4d4986ace6978e80624d86.json",
  ),
  "open-models-coding-agent-benchmarks": image(
    "open-models-coding-agent-benchmarks",
    "A dark rounded core sits inside a gold lattice frame with four open loops.",
    "Each result belongs to a complete model, harness, and setting configuration.",
    "e54bd9c65521a0663942ec94ff02e6d89adfafba059d2837bfef7b42cce18dd3",
    "397dc4004579b3db53a32be2a87946e3f9a6158863a18dba6de9b6b81c095357",
    "20260910T235959491Z-image-66c52b1b-7e7/receipt.json",
    "gateway_b499bbfcfc3246adb97038e8cc0bebe8.json",
  ),
  "aa-index-cost-coding-agents": image(
    "aa-index-cost-coding-agents",
    "Mixed blocks, cylinders, and a thin brass frame sit on a dark tray; one cube glows cool blue.",
    "Cost and benchmark performance form trade-offs, not one universal ranking; the illustration is not a data plot.",
    "eb52d610171b0e344c2d3b45b5ad53901ccf8853522fe93261183738e806a8f3",
    "b604f426935f8db93c12e6331619a0b43a16caebe290ad24eca5b8fb89439ba3",
    "20260911T000022840Z-image-1cd1d625-7d6/receipt.json",
    "gateway_7723f4fb52d544cbb4db54c88e01f4d2.json",
  ),
  "mirrorcode-coding-agent-benchmark": image(
    "mirrorcode-coding-agent-benchmark",
    "A closed black box and an open assembled machine return matching white geometric outputs.",
    "Behavioral reimplementation is judged by outputs, including held-out tests the agent cannot inspect.",
    "63f633f21319870eec947d1986266e3aa60c50949d5d8c386064e934088f44cd",
    "641259195975f0a03db9088bbe9edf9c51e28ca79406446b1fab7271fb397171",
    "20260911T000050534Z-image-500cd108-717/receipt.json",
    "gateway_3d2f6d52a6e1436db973791cee47f312.json",
  ),
  "small-models-have-arrived": image(
    "small-models-have-arrived",
    "A small pale cube with a brass pin sits on a short track of circular stations beside a large dark block.",
    "A lower inference cost matters only for a repeated task that still meets a written quality bar. This illustration is not a cost plot.",
    "c13df141e34055cbe2b77ab577716bce1b5e4c4199c8e0575a7f4d92ea66f584",
    "fe677680fbcdc340cfd5e0083d2e91c8163464a5fef249d634f5a75c37ede2a8",
    "20260911T000116830Z-image-e23527ec-438/receipt.json",
    "gateway_3d2ac2f152574a2dafa6d5f5341f3b60.json",
  ),
  "devin-fusion-cost-saving": image(
    "devin-fusion-cost-saving",
    "A thick charcoal band carries a pale inner path that curves and meets a thinner side path, then continues as one quieter channel.",
    "The 39% saving belongs to one Astra-led Fusion pairing against Codex, not to Fusion as a general discount.",
    "40afa01d30b5ba78c6e344eccd314fa3130880f4a3aab63cc85ab2f0455133d1",
    "e902695ca85d37e131c384d87ffd2fce36fff4ef48c2c97b518beaf5ab9ae9b3",
    "20260922T011246307Z-image-03c61456-554/receipt.json",
    "gateway_089f98316e314755a51d5e5184ce0040.json",
  ),
  "real-swe-private-enterprise-benchmark": image(
    "real-swe-private-enterprise-benchmark",
    "A locked dark glass cabinet packed with black cubes sits beside a small pale-blue cube in a spotlight.",
    "The 38.8% rate is an aggregate over licensed private tasks; it is not interchangeable with a public-suite result.",
    "1d0837d5c90a477ddecf0a3ffc1e4aa6bf6153a791fc652a41f3c00d5c860331",
    "6fff75d9e6eac755b5bcee02b85eddcdda93d166e11597d99227299ba23b59e7",
    "20260922T011318249Z-image-fa29105e-a30/receipt.json",
    "gateway_fe2ca7c1cfee475e9a289746ad50e763.json",
  ),
  "harnesstax-coding-agent-harness": image(
    "harnesstax-coding-agent-harness",
    "A pale fiber core passes through a square, a circle, and a triangle frame, then flares into a wide fan.",
    "Same-model cost gaps belong to the harness pairing. Success stayed close; cost did not.",
    "ed17017da5bc44cb99f83fe2fc35f073d68d8f17cf1d3b0d353d2da762dc3927",
    "6182bf82dbcf86ea00e56241f9b2c3650136b8cdbc98b3be1314d41c7dec5952",
    "20260922T011357242Z-image-f8ded62b-d9f/receipt.json",
    "gateway_41c77d234b00449ca128245eea7de842.json",
  ),
  "harness-design-coding-agents": image(
    "harness-design-coding-agents",
    "A dark ring with four pale dots sits at the center, with modular pedestals and one blue cube under a glass dome around it.",
    "Component effects belong to one fixed agent loop and the named ablation settings, not to harnesses in general.",
    "63c4aa98609f10d4d49886e922a8f97864fe584b20c6b1ab05a7a11b4dccff7d",
    "4b11525047f54f222de119a3399e58ab62fc376cc1d1788f33e62fcf8b135615",
    "20260922T011430131Z-image-d26de292-0f6/receipt.json",
    "gateway_060552ce62b24ce6b9b5c19ce16c4884.json",
  ),
  "mimo-v2-6-pro-cost-frontier": image(
    "mimo-v2-6-pro-cost-frontier",
    "A small ivory sphere rests on a low charcoal step beside three tall dark pillars, on a staircase traced by one thin brass line.",
    "A frontier position is a measured score at a measured cost per task. It is not a ranking of every open model or a verdict on every task.",
    "252b9d6343404db49cce1e48f6e1b5374dd495f82dbdd1ff0a6ce8e4d2e2dbe7",
    "22d5fe3788ce281525136d9b4137f6405a1c5c302e8fe14773e7bde8b74294bc",
    "20260922T164854745Z-image-919d058d-dc9/receipt.json",
    "gateway_5573d1d786af4a94a2569ae0bbc905a2.json",
  ),
  "grok-4-7-coding-agent-index": image(
    "grok-4-7-coding-agent-index",
    "A large matte ivory stone rests across two separate charcoal plinths of different heights, each edged by its own short brass line.",
    "One model, two measurements: a coding-agent row inside one harness and an Intelligence Index row under another. The two scales do not meet, and this illustration is not a data plot.",
    "d6bbdb612bccd75470de5930aea3a73be525521b5245c6b6d69e2b4a01761f53",
    "ffba129024de00345b0c1f48b93cc1e89ecdd0cb48e3af88f5db5a2b095e89d8",
    "20260923T150512173Z-image-4365db6c-c83/receipt.json",
    "gateway_bc71b5ff0a604e44a40268303d9d329f.json",
  ),
  "gpt-6-sol-coding-agent-index": image(
    "gpt-6-sol-coding-agent-index",
    "A matte ivory sphere rests on a charcoal ledge above two separate dark pools, each holding its own reflection of it.",
    "One model measured twice: the coding-agent row in Codex and the Intelligence Index row are two readings of GPT-6 Sol, each on its own scale.",
    "4f517cca6dafb7d1e54b01c8efee223f03f3c2d439af12a5d248c0ebe944b8a7",
    "4e71b7f4f5783ea67e43acee8a19528645daddf74c4168abe787fd577c9a0a85",
    "20260924T145006571Z-image-99c4db4e-93e/receipt.json",
    "gateway_235223fbc0b94eba89ffd87e7b556768.json",
  ),
} as const satisfies EditorialImageRecord;

export function blogEditorialImage<Slug extends BlogSlug>(
  slug: Slug,
): BlogEditorialImage<Slug> | undefined {
  return (BLOG_EDITORIAL_IMAGES as EditorialImageRecord)[slug] as
    | BlogEditorialImage<Slug>
    | undefined;
}

/**
 * Projects one checked editorial-image record into the shared representative-
 * image contract so metadata, structured data, feeds, and sitemaps derive from
 * the same alt text, caption, credit, dimensions, and paths.
 */
export function representativeEditorialImage(
  image: BlogEditorialImage,
): RepresentativeImage {
  return {
    alt: image.alt,
    caption: image.caption,
    contentType: "image/webp",
    credit: image.credit,
    height: image.height,
    path: image.src,
    social: {
      height: image.height,
      path: image.socialSrc,
      width: image.width,
    },
    width: image.width,
  };
}

export const blogEditorialImages = Object.values(BLOG_EDITORIAL_IMAGES);
