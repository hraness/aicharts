"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { searchBenchmarks, type BenchmarkChoice } from "@/lib/benchmark-search";
import type { BenchmarkId } from "@/lib/benchmarks";

const ICON_PATHS = {
  chart: "M3 3v14h14M6 13l4-4 3 2 4-5",
  chevron: "m5 8 5 5 5-5",
  search: "m13 13 4 4M14.5 9a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z",
  clear: "m6 6 8 8m0-8-8 8",
  check: "m4 10 4 4 8-8",
} as const;

function PickerIcon({ name }: Readonly<{ name: keyof typeof ICON_PATHS }>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" focusable="false">
      <path d={ICON_PATHS[name]} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BenchmarkPicker({
  choices,
  value,
  onSelect,
}: Readonly<{
  choices: readonly BenchmarkChoice<BenchmarkId>[];
  value: BenchmarkId;
  onSelect: (id: BenchmarkId) => void;
}>) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<BenchmarkId | null>(null);
  const selected = choices.find((choice) => choice.id === value);
  const results = searchBenchmarks(choices, query);
  const active = results.find((choice) => choice.id === highlighted) ?? results[0];

  const optionId = (choice: BenchmarkId) => `${id}-option-${choice}`;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }

    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [open]);

  function openPicker() {
    setQuery("");
    setHighlighted(value);
    setOpen(true);
  }

  function closePicker() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(next: BenchmarkId) {
    if (next !== value) onSelect(next);
    closePicker();
  }

  function changeQuery(next: string, highlight: BenchmarkId | null = null) {
    if (listRef.current) listRef.current.scrollTop = 0;
    setQuery(next);
    setHighlighted(highlight);
  }

  function moveHighlight(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const { key } = event;
    if (key === "Enter") {
      event.preventDefault();
      if (active) choose(active.id);
      return;
    }
    if (key !== "ArrowDown" && key !== "ArrowUp") return;
    event.preventDefault();
    if (!active) return;
    const direction = key === "ArrowDown" ? 1 : -1;
    const next = results[(results.indexOf(active) + direction + results.length) % results.length]!;
    setHighlighted(next.id);
    document.getElementById(optionId(next.id))?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div
      ref={rootRef}
      className="benchmark-picker"
      onBlur={(event) => {
        if (open && event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          closePicker();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="benchmark-picker__trigger"
        aria-label={selected ? `Benchmark: ${selected.label}` : "Benchmark"}
        aria-describedby={`${id}-selection-summary`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => open ? setOpen(false) : openPicker()}
      >
        <span className="benchmark-picker__symbol"><PickerIcon name="chart" /></span>
        <span className="benchmark-picker__selection">
          <span className="benchmark-picker__label">Benchmark</span>
          <strong>{selected?.label ?? "Choose a benchmark"}</strong>
          <span id={`${id}-selection-summary`} className="benchmark-picker__summary">{selected?.summary}</span>
        </span>
        <span className="benchmark-picker__chevron"><PickerIcon name="chevron" /></span>
      </button>

      {open && (
        <div id={`${id}-panel`} role="dialog" aria-label="Choose a benchmark" className="benchmark-picker__panel">
          <div className="benchmark-picker__search">
            <PickerIcon name="search" />
            <input
              ref={inputRef}
              role="combobox"
              aria-label="Search benchmarks"
              aria-autocomplete="list"
              aria-expanded={true}
              aria-controls={`${id}-list`}
              aria-activedescendant={active ? optionId(active.id) : undefined}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Search benchmarks…"
              value={query}
              onChange={(event) => changeQuery(event.currentTarget.value)}
              onKeyDown={moveHighlight}
            />
            {query && (
              <button
                type="button"
                className="benchmark-picker__clear"
                aria-label="Clear search"
                onClick={() => {
                  inputRef.current?.focus();
                  changeQuery("", value);
                }}
              >
                <PickerIcon name="clear" />
              </button>
            )}
          </div>

          <div ref={listRef} role="listbox" id={`${id}-list`} aria-label="Benchmarks" className="benchmark-picker__results">
            {results.map((choice) => {
              const row = optionId(choice.id);
              return (
                <div
                  id={row}
                  key={choice.id}
                  role="option"
                  aria-labelledby={`${row}-name`}
                  aria-describedby={`${row}-summary`}
                  aria-selected={choice.id === value}
                  className="benchmark-picker__option"
                  data-highlighted={choice.id === active?.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(choice.id)}
                >
                  <span className="benchmark-picker__option-copy">
                    <strong id={`${row}-name`}>{choice.label}</strong>
                    <span id={`${row}-summary`} className="benchmark-picker__summary">{choice.summary}</span>
                  </span>
                  {choice.id === value && <span className="benchmark-picker__check"><PickerIcon name="check" /></span>}
                </div>
              );
            })}
          </div>
          {results.length === 0 && <p className="benchmark-picker__empty" role="status">No benchmarks found.</p>}
        </div>
      )}
    </div>
  );
}
