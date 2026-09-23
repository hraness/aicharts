import { expect, test } from "bun:test";

import { identityTokenCovers } from "./index-model-pages";
import { assertProperty, fc } from "./property-test";

const modelArb = fc.constantFrom(
  "Claude Opus 5",
  "Claude Fable 5.1",
  "GPT-6 Astra",
  "MiMo-V2.6-Pro",
  "Grok 4.7",
);

const separatorArb = fc.constantFrom("", " ", "-", "  ", "_", ".", " · ");

test("property: identity coverage ignores case and punctuation", () => {
  assertProperty(fc.property(modelArb, separatorArb, fc.boolean(), (model, separator, upper) => {
    const spelled = model.replace(/[\s.-]/gu, separator);
    const variant = upper ? spelled.toUpperCase() : spelled.toLowerCase();
    expect(identityTokenCovers(variant, model)).toBeTrue();
    expect(identityTokenCovers(`${variant} (max)`, model)).toBeTrue();
  }));
});

test("property: a digit continuation is a different model", () => {
  assertProperty(fc.property(modelArb, fc.integer({ min: 0, max: 9 }), (model, digit) => {
    expect(identityTokenCovers(`${model}.${digit}`, model)).toBeFalse();
    expect(identityTokenCovers(`${model}${digit}`, model)).toBeFalse();
    expect(identityTokenCovers(`${model}-${digit}`, model)).toBeFalse();
  }));
});
