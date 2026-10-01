import type { Page } from "playwright-core";

export function verifySettledConsentFlow(page: Page, options?: {
  allowHidden?: boolean;
  screenshot?: (sample: { page: Page; state: string; scale: number; position: string }) => Promise<void>;
}): Promise<unknown>;
