import type { Metadata } from "next";
import { connection } from "next/server";
import { ChartPageFooter } from "@/components/chart-navigation";
import { SiteHeader } from "@/components/site-header";
import { PairingApproval } from "@/components/usage/pairing-approval";
import { usagePairingAvailable } from "@/lib/usage/pairing-route";
import "@/styles/usage.css";
import "./pairing.css";

export const metadata: Metadata = { title: "Connect your collector | AI Charts", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function PairingPage() {
  await connection();
  const available = usagePairingAvailable();
  return <><SiteHeader current="/usage" /><main className="usage-home" id="main-content">
    <PairingApproval key={available ? "available" : "closed"} available={available} /><ChartPageFooter />
  </main></>;
}
