/** A deferred image may finish after its view or account authority has ended. */
export async function exportCurrentStatsImage<T>(current: () => boolean, prepare: () => Promise<T>, download: (image: T) => void): Promise<boolean> {
  if (!current()) return false;
  const image = await prepare();
  if (!current()) return false;
  download(image);
  return true;
}
