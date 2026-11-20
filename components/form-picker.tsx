"use client";
import { useEffect, useState } from "react";
import { CompactPicker, type PickerOption } from "./compact-picker";

export function FormPicker({ name, label, initial, options }: {name:string; label:string; initial:string; options:PickerOption[]}) {
  const [value, setValue] = useState(initial);
  const [interactive,setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  return <>
    <div className="enhanced-form-picker"><CompactPicker label={label} value={value} options={options} onChange={setValue}/><input type="hidden" name={name} value={value} disabled={!interactive || value === ""}/></div>
    <noscript><label>{label}<select name={name} defaultValue={initial}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label></noscript>
  </>;
}
