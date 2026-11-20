"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { DeviceIcon } from "./device-icon";
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
  return <SearchPicker choices={choices} value={value} onSelect={next => {
    const choice = choices.find(c => c.id === next);
    if (choice) onSelect(choice.id);
  }} />;
}

export function SearchPicker({ choices, value, onSelect, compactLabel, disabled }: {
  choices: readonly (BenchmarkChoice & { group?: string })[];
  value: string;
  onSelect: (id: string) => void;
  compactLabel?: string;
  disabled?: boolean;
}) {
  const label = compactLabel ?? "Benchmark";
  const [group, setGroup] = useState("");
  const [panelLeft,setPanelLeft] = useState(0);
  const wide = Boolean(compactLabel && choices.length >= 9);
  const [alignEnd, setAlignEnd] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const selected = choices.find((choice) => choice.id === value);
  const groups = [...new Set(choices.map(c => c.group).filter((g): g is string => Boolean(g)))];
  const layers = groups.length > 1 && choices.length > 7;
  const browsingGroups = layers && !group && !query.trim();
  const groupPrefix = "group:";
  const results: readonly BenchmarkChoice[] = browsingGroups ? [
    ...choices.filter(c => !c.group),
    ...groups.map(g => {
      const members=choices.filter(choice=>choice.group===g);
      return {id:groupPrefix+g,label:g,summary:members.length+(members.length===1?" choice":" choices"),icon:members[0]?.icon};
    }),
  ] : searchBenchmarks(group && !query.trim() ? choices.filter(c => c.group === group) : choices, query);
  const active = results.find((choice) => choice.id === highlighted) ?? results[0];

  const optionId = (choice: string) => `${id}-option-${encodeURIComponent(choice)}`;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function positionPanel() {
      const bounds = rootRef.current?.getBoundingClientRect();
      if (bounds) {
        const width = Math.min(window.innerWidth-24, choices.length >= 24 ? 680 : 464);
        setPanelLeft(Math.min(0,window.innerWidth - 12 - width - bounds.left));
      }
    }
    positionPanel();
    window.addEventListener("resize",positionPanel);
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }

    document.addEventListener("pointerdown", dismissOutside);
    return () => {window.removeEventListener("resize",positionPanel);document.removeEventListener("pointerdown", dismissOutside);};
  }, [open,choices.length]);

  function openPicker() {
    const bounds = triggerRef.current?.getBoundingClientRect();
    setAlignEnd(Boolean(bounds && bounds.left + Math.max(bounds.width, 304) > window.innerWidth - 8));
    setQuery("");
    setGroup("");
    setHighlighted(value);
    setOpen(true);
  }

  function closePicker() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(next: string) {
    if (browsingGroups && next.startsWith(groupPrefix)) {
      setGroup(next.slice(groupPrefix.length));
      changeQuery("");
      inputRef.current?.focus();
      return;
    }
    if (next !== value) onSelect(next);
    closePicker();
  }

  function changeQuery(next: string, highlight: string | null = null) {
    if (listRef.current) listRef.current.scrollTop = 0;
    setQuery(next);
    setHighlighted(highlight);
  }

  function moveHighlight(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const { key } = event;
    const columns = listRef.current ? getComputedStyle(listRef.current).gridTemplateColumns.split(" ").length : 1;
    const atStart = active === results[0];
    if (key === "ArrowLeft" && group && !query && (columns===1 || atStart)) {
      event.preventDefault();
      setGroup("");
      setHighlighted(groupPrefix + group);
      return;
    }
    if (key === "ArrowRight" && browsingGroups && active?.id.startsWith(groupPrefix) && !query && columns===1) {
      event.preventDefault();
      choose(active.id);
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      if (active) choose(active.id);
      return;
    }
    const horizontal = key === "ArrowLeft" || key === "ArrowRight";
    if (horizontal ? columns===1 || !!query : key!=="ArrowDown" && key!=="ArrowUp") return;
    event.preventDefault();
    if (!active) return;
    const direction = horizontal ? key==="ArrowRight"?1:-1 : key==="ArrowDown"?columns:-columns;
    const next = results[((results.indexOf(active) + direction) % results.length + results.length) % results.length]!;
    setHighlighted(next.id);
    document.getElementById(optionId(next.id))?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div
      ref={rootRef}
      data-grid={wide ? choices.length >= 24 ? "large" : "medium" : undefined}
      style={{"--panel-offset":panelLeft+"px"} as React.CSSProperties}
      data-align-end={alignEnd || undefined}
      className={compactLabel ? "benchmark-picker compact-picker" : "benchmark-picker"}
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
        aria-label={compactLabel ?? (selected ? `Benchmark: ${selected.label}` : "Benchmark")}
        data-value={value}
        disabled={disabled}
        aria-describedby={compactLabel ? `${id}-value` : `${id}-selection-summary`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => open ? setOpen(false) : openPicker()}
      >
        <span className="benchmark-picker__symbol"><PickerIcon name="chart" /></span>
        <span className="benchmark-picker__selection">
          <span className="benchmark-picker__label">{label}</span>
          <strong id={`${id}-value`}>{selected?.icon && <DeviceIcon kind={selected.icon}/>} {selected?.label ?? "Choose a benchmark"}</strong>
          <span id={`${id}-selection-summary`} className="benchmark-picker__summary">{selected?.summary}</span>
        </span>
        <span className="benchmark-picker__chevron"><PickerIcon name="chevron" /></span>
      </button>

      {open && (
        <div id={`${id}-panel`} role="dialog" aria-label={compactLabel ? "Choose " + label : "Choose a benchmark"} className="benchmark-picker__panel">
          <div className="benchmark-picker__search">
            <PickerIcon name="search" />
            <input
              ref={inputRef}
              role="combobox"
              aria-label={compactLabel ? "Search " + label : "Search benchmarks"}
              aria-autocomplete="list"
              aria-expanded={true}
              aria-controls={`${id}-list`}
              aria-activedescendant={active ? optionId(active.id) : undefined}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder={compactLabel ? "Search all choices…" : "Search benchmarks…"}
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

          {group && !query.trim() && <button type="button" className="compact-picker__back" onClick={() => { setGroup(""); changeQuery(""); inputRef.current?.focus(); }}>‹ All groups · {group}</button>}
          <div ref={listRef} role="listbox" id={`${id}-list`} aria-label={compactLabel ?? "Benchmarks"} className="benchmark-picker__results">
            {results.map((choice) => {
              const row = optionId(choice.id);
              return (
                <div
                  id={row}
                  key={choice.id}
                  data-value={choice.id}
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
                    <strong id={`${row}-name`}>{choice.icon && <DeviceIcon kind={choice.icon}/>} {choice.label}</strong>
                    <span id={`${row}-summary`} className="benchmark-picker__summary">{choice.summary}</span>
                  </span>
                  {choice.id === value && <span className="benchmark-picker__check"><PickerIcon name="check" /></span>}
                </div>
              );
            })}
          </div>
          {results.length === 0 && <p className="benchmark-picker__empty" role="status">{compactLabel ? "No matches." : "No benchmarks found."}</p>}
        </div>
      )}
    </div>
  );
}
