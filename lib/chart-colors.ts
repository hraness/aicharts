import type { CodingAgentRecord } from "./coding-agent-data";
import { openAiEffortColors, providerColors } from "./chart-colors.generated";

const fallbackColor = "#d8d8d2";

export { openAiEffortColors, providerColors };

export function providerColor(providerId: string): string {
  return providerColors[providerId as keyof typeof providerColors] ?? fallbackColor;
}

export function recordColor(record: Pick<CodingAgentRecord, "providerId" | "setting">): string {
  if (record.providerId !== "openai") return providerColor(record.providerId);
  return openAiEffortColors[record.setting as keyof typeof openAiEffortColors] ?? providerColors.openai;
}

export function providerColorRange(providerId: string): { low: string; base: string; high: string } {
  const base = providerColor(providerId);
  if (providerId !== "openai") return { low: base, base, high: base };
  return { low: openAiEffortColors.none, base, high: openAiEffortColors.max };
}
