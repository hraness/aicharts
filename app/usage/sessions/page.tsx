import type { Metadata } from "next";
import { ChartPageFooter } from "@/components/chart-navigation";
import { SiteHeader } from "@/components/site-header";
import { SessionDashboard } from "@/components/usage/session-dashboard";
import "@/styles/usage.css";
import "@/styles/usage-dashboard.css";
import "@/styles/usage-sessions.css";

export const metadata: Metadata = {
  title: "Session usage | AI Charts",
  description: "Inspect local session usage, model mix, and measured time without uploading a transcript.",
  robots: { index: false, follow: true },
  alternates: { canonical: "https://aicharts.io/usage/sessions" },
};

export default function SessionUsagePage() {
  return <><SiteHeader current="/usage" /><main tabIndex={-1} className="usage-home" id="main-content">
    <SessionDashboard /><ChartPageFooter />
  </main></>;
}
