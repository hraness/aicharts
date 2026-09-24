"use client";

import { useSyncExternalStore } from "react";
import { captureUsageAccountRead, subscribeUsageAccountInvalidation } from "@/lib/usage/account-generation";

const snapshot = () => captureUsageAccountRead().generation;
/** React checks this again before committing a private view. */
export function useAccountGeneration() {
  return useSyncExternalStore(subscribeUsageAccountInvalidation, snapshot, snapshot);
}
