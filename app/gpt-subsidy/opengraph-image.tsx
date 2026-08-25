import {
  createSocialImageResponse,
  socialImageSize,
} from "@hraness/web-discovery/social-image";

import { GPT_SUBSIDY_DESCRIPTION, GPT_SUBSIDY_TITLE } from "@/lib/gpt-subsidy-data";
import { site } from "../site";

export const size = socialImageSize;
export const contentType = "image/png";
export const alt = GPT_SUBSIDY_TITLE + " historical chart";

export default function OpenGraphImage() {
  return createSocialImageResponse({
    description: GPT_SUBSIDY_DESCRIPTION,
    domain: site.domain + "/gpt-subsidy",
    eyebrow: "AI Charts usage analysis",
    theme: { accent: site.palette.chromatic.key },
    title: GPT_SUBSIDY_TITLE,
  });
}
