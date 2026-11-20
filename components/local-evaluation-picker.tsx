"use client";
import { useRouter } from "next/navigation";
import { CompactPicker, type PickerOption } from "./compact-picker";

export function LocalEvaluationPicker({ options, value }: { options: PickerOption[]; value: string }) {
  const router = useRouter();
  return <CompactPicker label="Benchmark" value={value} options={options} onChange={url => router.push(url + "#quality")} />;
}
