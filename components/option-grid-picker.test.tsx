import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { OptionGridPicker, type OptionGridPickerItem } from "./option-grid-picker";

const options: readonly OptionGridPickerItem[] = [
  {
    chipColor: "#3b9cff",
    description: "OpenAI",
    glyphColor: "#f7f6f2",
    iconUrl: "data:image/svg+xml;base64,AAAA",
    id: "astra",
    label: "GPT-6 Astra (max)",
    monogram: "O",
  },
  {
    chipColor: "#6f6962",
    description: "Thinking Machines",
    glyphColor: "#f7f6f2",
    iconUrl: null,
    id: "inkling",
    label: "Inkling (xhigh)",
    monogram: "TM",
  },
  { description: "Guide", id: "plain", label: "Plain option" },
];

const render = (value = "astra") => renderToStaticMarkup(
  <OptionGridPicker
    label="Choose a model configuration"
    onChange={() => undefined}
    options={options}
    searchLabel="Search model configurations"
    searchPlaceholder="Model or provider"
    value={value}
  />,
);

describe("option grid picker", () => {
  test("replaces the native select with a labelled trigger showing the selection", () => {
    const html = render();
    expect(html).not.toContain("<select");
    expect(html).toContain("Choose a model configuration");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    const trigger = html.match(/<button[\s\S]*?<\/button>/u)?.[0] ?? "";
    expect(trigger).toContain("GPT-6 Astra (max)");
    expect(trigger).toContain("OpenAI");
    expect(trigger).toContain("--option-picker-chip:#3b9cff");
  });

  test("server-renders every option inside the closed searchable panel", () => {
    const html = render();
    const panel = html.match(/<div aria-label="Choose a model configuration"[\s\S]*$/u)?.[0] ?? "";
    expect(panel).toContain('hidden=""');
    expect(panel).toContain('role="combobox"');
    expect(panel).toContain('type="search"');
    expect(panel).toContain('aria-label="Search model configurations"');
    expect(panel).toContain('placeholder="Model or provider"');
    expect(panel).toContain('role="listbox"');
    expect(panel.match(/role="option"/gu)).toHaveLength(options.length);
    expect(panel).toContain("3 options");
    for (const option of options) expect(panel).toContain(option.label);
  });

  test("marks only the current value as selected", () => {
    const html = render("inkling");
    const selected = html.match(/<div aria-selected="true"[\s\S]*?<\/div>/u)?.[0] ?? "";
    expect(html.match(/aria-selected="true"/gu)).toHaveLength(1);
    expect(selected).toContain("Inkling");
    expect(selected).toContain("xhigh");
  });

  test("renders icon chips through a recolorable mask and monogram chips as text", () => {
    const html = render();
    expect(html).toContain("--option-picker-icon:url(");
    expect(html).toMatch(/--option-picker-chip:#6f6962[^>]*>TM</u);
    const plain = html.match(/<div aria-selected="false"[^>]*>(?:(?!<\/div>)[\s\S])*Plain option[\s\S]*?<\/span><\/div>/u)?.[0] ?? "";
    expect(plain).not.toContain("option-picker__chip");
  });

  test("renders a compact list without search when the option set is short", () => {
    const html = renderToStaticMarkup(
      <OptionGridPicker
        label="Benchmark"
        layout="list"
        onChange={() => undefined}
        options={options}
        searchLabel="Search benchmarks"
        value="astra"
      />,
    );
    expect(html).toContain("option-picker--list");
    expect(html).not.toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain("<strong>GPT-6 Astra</strong>");
    expect(html).toContain("option-picker__qualifier");
    expect(html).toContain("max");
  });

  test("keeps keyboard, pointer, and dismissal behavior wired to the shared pure logic", async () => {
    const source = await Bun.file(new URL("./option-grid-picker.tsx", import.meta.url)).text();
    expect(source).toContain("filterPickerOptions(options, query)");
    expect(source).toContain("pickerNavigationIndex(key, activeIndex, filtered.length, resolvedColumns)");
    expect(source).toContain("aria-activedescendant");
    expect(source).toContain('scrollIntoView({ block: "nearest" })');
    expect(source).toContain('document.addEventListener("pointerdown", closeOnOutsidePress)');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("localTriggerRef.current?.focus()");
    expect(source).toContain("No matches for");
    expect(source).toContain("Clear search");
  });

  test("keeps the panel compact, layered, and touch-reachable in both themes", async () => {
    const css = await Bun.file(new URL("../styles/option-picker.css", import.meta.url)).text();
    expect(css).toMatch(/\.option-picker__panel\s*\{[^}]*position:\s*absolute;/su);
    expect(css).toMatch(/\.option-picker__panel\[hidden\]\s*\{[^}]*display:\s*none;/su);
    expect(css).toMatch(/\.option-picker__grid\s*\{[^}]*overflow-y:\s*auto;/su);
    expect(css).toMatch(/\.option-picker__option\[data-active\]\s*\{[^}]*outline:\s*2px solid/su);
    expect(css).toMatch(/\.option-picker__value strong,[\s\S]*?line-clamp:\s*2;/u);
    expect(css).toMatch(/\.option-picker--list \.option-picker__panel\s*\{[^}]*padding:\s*4px 1px;/su);
    expect(css).toMatch(/\.option-picker--list \.option-picker__panel\s*\{[^}]*width:\s*max\(100%, min\(280px, 86vw\)\);/su);
    expect(css).toContain("--option-picker-row-inline: 10px");
    expect(css).toMatch(/\.option-picker \.option-picker__trigger\s*\{[^}]*align-items:\s*center;/su);
    expect(css).toMatch(/\.option-picker \.option-picker__trigger\s*\{[^}]*padding:\s*7px var\(--option-picker-row-inline\);/su);
    expect(css).toMatch(/\.option-picker__option\s*\{[^}]*align-items:\s*center;/su);
    expect(css).toMatch(/\.option-picker--list \.option-picker__option\s*\{[^}]*padding:\s*7px var\(--option-picker-row-inline\);/su);
    expect(css).toMatch(/\.option-picker__leading svg,[\s\S]*?display:\s*block;/u);
    expect(css).not.toMatch(/\.option-picker__copy strong\s*\{[^}]*white-space:\s*nowrap;/su);
    expect(css).toMatch(/@media \(hover: none\), \(pointer: coarse\)[\s\S]*?\.option-picker__option\s*\{[^}]*min-height:\s*var\(--interactive-target-min, 44px\);/u);
  });
});
