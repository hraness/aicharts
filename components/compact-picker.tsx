"use client";

import { SearchPicker } from "./benchmark-picker";

export type PickerOption = { value: string; label: string; group?: string; description?: string; keywords?: readonly string[]; icon?: import("@/lib/device-kind").DeviceKind };
export function CompactPicker({ label, value, options, onChange, disabled }: {
  label: string; value: string; options: PickerOption[]; onChange: (value: string) => void; disabled?: boolean;
}) {
  const choices = options.map(o => ({ id: o.value, label: o.label, summary: o.description ?? "", group: o.group, icon:o.icon, keywords:[...(o.keywords ?? []),...(o.group ? [o.group] : [])] }));
  return <SearchPicker choices={choices} value={value} onSelect={onChange} compactLabel={label} disabled={disabled} />;
}
