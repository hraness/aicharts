"use client";

import { useEffect } from "react";
import Link from "next/link";

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
  return <main className="route-state"><h1>Page not found</h1><Link href="/">Return to the chart</Link></main>;
}
