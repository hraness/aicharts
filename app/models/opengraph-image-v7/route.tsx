import {
  modelCardsDescription,
  modelCardsEyebrow,
  modelCardsTitle,
} from "../../site";
import { aichartsSocialImage } from "../../social-card";

export const dynamic = "force-static";

export function GET() {
  return aichartsSocialImage({
    description: modelCardsDescription,
    eyebrow: modelCardsEyebrow,
    title: modelCardsTitle,
  });
}
