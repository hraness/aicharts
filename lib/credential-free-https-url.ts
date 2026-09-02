import { z } from "./schema";

export function isCredentialFreeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.username === ""
      && url.password === "";
  } catch {
    return false;
  }
}

export const credentialFreeHttpsUrlSchema = z.string().url().refine(
  isCredentialFreeHttpsUrl,
  "URL must use HTTPS and must not contain credentials.",
);
