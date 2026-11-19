import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./journal.css";

export default function JournalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="journal-shell">
      <SiteHeader />
      <main className="journal-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
