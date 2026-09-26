import type { Metadata } from "next";
import Link from "next/link";
import { ChartPageFooter } from "@/components/chart-navigation";
import { SiteHeader } from "@/components/site-header";
import { SessionDashboard } from "@/components/usage/session-dashboard";
import "@/styles/usage.css";
import "@/styles/usage-dashboard.css";
import "@/styles/usage-stats.css";
import "@/styles/usage-sessions.css";

export const metadata: Metadata = {
  title: "Session usage | AI Charts",
  description: "Inspect local session usage, model mix, and measured time without uploading a transcript.",
  robots: { index: false, follow: true },
  alternates: { canonical: "https://aicharts.io/usage/sessions" },
};

export default function SessionUsagePage() {
  return <><SiteHeader current="/usage" /><main className="usage-home usage-home--stats" id="main-content">
    <nav className="usage-stats-nav" aria-label="Usage views"><Link href="/dashboard">Account overview</Link><Link href="/usage/details">Detailed reports</Link><Link href="/usage/sessions" aria-current="page">Sessions</Link><Link href="/leaderboard">Leaderboard</Link></nav>
    <SessionDashboard /><ChartPageFooter />
  </main></>;
}
