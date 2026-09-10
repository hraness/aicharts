const LOCATION_SEARCH_EVENT = "aicharts:location-search";

/** Replace the current address-bar search without adding a history entry. */
export function replaceLocationSearch(search: string): void {
  const nextUrl = `${window.location.pathname}${search === "" ? "" : `?${search}`}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  window.history.replaceState(window.history.state, "", nextUrl);
  window.dispatchEvent(new Event(LOCATION_SEARCH_EVENT));
}

export function subscribeLocationSearch(onStoreChange: () => void): () => void {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(LOCATION_SEARCH_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener(LOCATION_SEARCH_EVENT, onStoreChange);
  };
}

export function readLocationSearch(): string {
  return window.location.search;
}

export function serverLocationSearch(): string {
  return "";
}
