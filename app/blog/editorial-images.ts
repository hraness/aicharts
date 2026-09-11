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
} as const satisfies EditorialImageRecord;

export function blogEditorialImage<Slug extends BlogSlug>(
  slug: Slug,
): BlogEditorialImage<Slug> | undefined {
  return (BLOG_EDITORIAL_IMAGES as EditorialImageRecord)[slug] as
    | BlogEditorialImage<Slug>
    | undefined;
}

export const blogEditorialImages = Object.values(BLOG_EDITORIAL_IMAGES);
