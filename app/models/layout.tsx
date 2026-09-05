import {
  AI_CHARTS_MODELS_URL,
  ProjectAskAiAboutThis,
} from "@/components/project-ask-ai-about-this";
import { SiteHeader } from "@/components/site-header";
import Link from "next/link";
import type { ReactNode } from "react";

export default function ModelsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="model-cards-site">
      <SiteHeader
        className="model-cards-header"
        current="/models"
        skipLabel="Skip to model cards"
        skipTarget="#model-cards-content"
      />
      {children}
      <ProjectAskAiAboutThis url={AI_CHARTS_MODELS_URL} />
      <aside aria-label="Model card resources" className="model-cards-footer">
        <p>aicharts.io</p>
        <nav aria-label="Model card links" className="model-cards-footer__links">
          <Link href="/data">Data and method</Link>
        </nav>
      </aside>
    </div>
  );
}
