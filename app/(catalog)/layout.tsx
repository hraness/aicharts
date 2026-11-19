import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./catalog.css";

export default function CatalogLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="catalog-shell">
      <SiteHeader />
      <main className="catalog-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
