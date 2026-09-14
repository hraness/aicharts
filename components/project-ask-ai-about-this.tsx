import { AskAiAboutThis } from "@hraness/ui";

import { site } from "@/app/site";

export const AI_CHARTS_MODELS_URL = `${site.origin}/models` as const;

export function ProjectAskAiAboutThis({
  url,
}: Readonly<{ url: typeof site.origin | typeof AI_CHARTS_MODELS_URL }>) {
  return <AskAiAboutThis className="aicharts-ask-ai" url={url} />;
}
