"use client";

import { useState } from "react";
import { CompactPicker } from "@/components/compact-picker";

type ModelPair = {
  first: string;
  second: string;
  path: string;
};

export function ChooseModelPair({ models, pairs }: {
  models: { slug: string; name: string }[];
  pairs: ModelPair[];
}) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const choices = models.map(({ slug, name }) => ({ value: slug, label: name }));
  const compatible = new Map<string, string>();

  for (const pair of pairs) {
    if (pair.first === first) compatible.set(pair.second, pair.path);
    if (pair.second === first) compatible.set(pair.first, pair.path);
  }

  const path = compatible.get(second);
  return <section className="choose-model-pair" aria-label="Choose a model comparison">
    <CompactPicker label="First model" value={first}
      options={[{ value: "", label: "Choose first model" }, ...choices]}
      onChange={value => { setFirst(value); setSecond(""); }} />
    <CompactPicker label="Second model" value={second} disabled={!first}
      options={[{ value: "", label: "Choose second model" }, ...choices.filter(choice => compatible.has(choice.value))]}
      onChange={setSecond} />
    {path && <a href={path}>Open side-by-side comparison</a>}
  </section>;
}
