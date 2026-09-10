/** Replace the current address-bar search without adding a history entry. */
export function replaceLocationSearch(search: string): void {
  const nextUrl = `${window.location.pathname}${search === "" ? "" : `?${search}`}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, "", nextUrl);
}
