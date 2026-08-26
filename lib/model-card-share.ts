import {
  downloadBlob,
  shareFileNatively,
  type NativeFileShareResult,
} from "@hraness/design-kit/browser";

export type PreparedModelCardImage = Readonly<{
  blob: Blob;
  file: File;
  imageUrl: string;
}>;

type FetchImage = (input: string, init: RequestInit) => Promise<Response>;

export async function prepareModelCardImage({
  fetchImage = globalThis.fetch,
  filename,
  imageUrl,
  signal,
}: Readonly<{
  fetchImage?: FetchImage;
  filename: string;
  imageUrl: string;
  signal: AbortSignal;
}>): Promise<PreparedModelCardImage> {
  const response = await fetchImage(imageUrl, { signal });
  if (!response.ok) throw new Error(`Card image request failed with ${String(response.status)}.`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "image/png") throw new Error("Card image response was not a PNG.");
  const blob = await response.blob();
  return {
    blob,
    file: new File([blob], filename, { type: "image/png" }),
    imageUrl,
  };
}

export async function sharePreparedModelCardImage(
  prepared: PreparedModelCardImage,
  filename: string,
  dependencies: Readonly<{
    download?: (blob: Blob, filename: string) => void;
    share?: (file: File) => Promise<NativeFileShareResult>;
  }> = {},
): Promise<"shared" | "cancelled" | "downloaded"> {
  const result = await (dependencies.share ?? shareFileNatively)(prepared.file);
  if (result.kind === "shared" || result.kind === "cancelled") return result.kind;
  (dependencies.download ?? downloadBlob)(prepared.blob, filename);
  return "downloaded";
}
