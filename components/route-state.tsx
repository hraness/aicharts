"use client";

import { useEffect } from "react";
import Link from "next/link";

import { notFoundRecoveryLinks } from "@/app/site";

export type RouteErrorProps = Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>;

export function RouteErrorState({ error, reset }: RouteErrorProps) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="route-state">
      <p>Something went wrong while drawing the chart.</p>
      <button onClick={reset} type="button">Try again</button>
    </main>
  );
}

export function RouteLoadingState() {
  return <main aria-busy="true" className="route-state"><p>Loading chart…</p></main>;
}

export function RouteNotFoundState() {
  return (
    <main className="route-state">
      <h1>Page not found</h1>
      <p>This path does not exist on AI Charts.</p>
      <nav aria-label="Where to look next">
        <ul>
          {notFoundRecoveryLinks.map(link => (
            <li key={link.href}>
              <Link href={link.href}>{link.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
