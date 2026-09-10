"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import {
  filterPickerOptions,
  isPickerNavigationKey,
  pickerColumnCount,
  pickerNavigationIndex,
  type PickerOption,
} from "@/lib/option-picker";

import "@/styles/option-picker.css";

export type OptionGridPickerItem = PickerOption & Readonly<{
  chipColor?: string;
  glyphColor?: string;
  iconUrl?: string | null;
  monogram?: string;
}>;

type ChipStyle = CSSProperties & Readonly<{ "--option-picker-chip": string; "--option-picker-glyph": string }>;
type GlyphStyle = CSSProperties & Readonly<{ "--option-picker-icon": string }>;

const OPTION_GAP = 4;
const MAX_COLUMNS = 4;

function OptionChip({ option }: Readonly<{ option: OptionGridPickerItem }>) {
  if (option.chipColor === undefined) return null;
  const chipStyle: ChipStyle = {
    "--option-picker-chip": option.chipColor,
    "--option-picker-glyph": option.glyphColor ?? "#f7f6f2",
  };
  if (option.iconUrl != null) {
    const glyphStyle: GlyphStyle = { "--option-picker-icon": `url("${option.iconUrl}")` };
    return (
      <span aria-hidden="true" className="option-picker__chip" style={chipStyle}>
        <i className="option-picker__glyph" style={glyphStyle} />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="option-picker__chip" style={chipStyle}>
      {option.monogram ?? ""}
    </span>
  );
}

/**
 * Compact searchable replacement for long native model, configuration, and
 * provider selects. The trigger opens a panel whose search input keeps real
 * focus while arrow keys move a virtually focused option through the grid;
 * Enter picks it, Escape returns to the trigger, and pointer or touch selects
 * directly. The full option grid is server-rendered so every choice stays in
 * the document, and the search filter runs through `filterPickerOptions`.
 */
export function OptionGridPicker({
  className = "",
  label,
  minimumOptionWidth = 180,
  onChange,
  options,
  searchLabel,
  searchPlaceholder,
  triggerRef,
  value,
}: Readonly<{
  className?: string;
  label: string;
  minimumOptionWidth?: number;
  onChange: (id: string) => void;
  options: readonly OptionGridPickerItem[];
  searchLabel: string;
  searchPlaceholder?: string;
  triggerRef?: (element: HTMLButtonElement | null) => void;
  value: string;
}>) {
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [columns, setColumns] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const localTriggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterPickerOptions(options, query), [options, query]);
  const selected = options.find(option => option.id === value) ?? null;
  const listId = `${baseId}-list`;
  const activeOption = activeIndex >= 0 ? filtered[activeIndex] : undefined;
  const activeOptionDomId = activeOption === undefined ? undefined : `${baseId}-option-${String(activeIndex)}`;

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) localTriggerRef.current?.focus();
  }

  function openPanel(): void {
    setQuery("");
    setActiveIndex(Math.max(0, options.findIndex(option => option.id === value)));
    setOpen(true);
  }

  function select(id: string): void {
    close(true);
    onChange(id);
  }

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        localTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!open || grid === null || typeof ResizeObserver === "undefined") return;
    const updateColumns = (width: number) => {
      setColumns(pickerColumnCount(width, minimumOptionWidth, OPTION_GAP, MAX_COLUMNS));
    };
    updateColumns(grid.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry !== undefined) updateColumns(entry.contentRect.width);
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [minimumOptionWidth, open]);

  useEffect(() => {
    if (!open || activeOptionDomId === undefined) return;
    document.getElementById(activeOptionDomId)?.scrollIntoView({ block: "nearest" });
  }, [activeOptionDomId, open]);

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (isPickerNavigationKey(event.key)) {
      event.preventDefault();
      setActiveIndex(pickerNavigationIndex(event.key, activeIndex, filtered.length, columns));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeOption !== undefined) select(activeOption.id);
      return;
    }
    if (event.key === "Tab") setOpen(false);
  }

  return (
    <div className={`option-picker ${className}`.trim()} ref={containerRef}>
      <span className="option-picker__label" id={`${baseId}-label`}>{label}</span>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-labelledby={`${baseId}-label ${baseId}-value`}
        className="option-picker__trigger"
        onClick={() => {
          if (open) close(false);
          else openPanel();
        }}
        ref={element => {
          localTriggerRef.current = element;
          triggerRef?.(element);
        }}
        type="button"
      >
        {selected === null ? null : <OptionChip option={selected} />}
        <span className="option-picker__value" id={`${baseId}-value`}>
          <strong>{selected?.label ?? "Choose an option"}</strong>
          {selected?.description === undefined ? null : <small>{selected.description}</small>}
        </span>
      </button>
      <div aria-label={label} className="option-picker__panel" hidden={!open} role="dialog">
        <input
          aria-activedescendant={open ? activeOptionDomId : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-label={searchLabel}
          autoComplete="off"
          className="option-picker__search"
          onChange={event => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleSearchKeyDown}
          placeholder={searchPlaceholder}
          ref={searchRef}
          role="combobox"
          type="search"
          value={query}
        />
        <p aria-live="polite" className="option-picker__status">
          {filtered.length === options.length
            ? `${String(options.length)} options`
            : `${String(filtered.length)} of ${String(options.length)} options`}
        </p>
        {filtered.length === 0 ? (
          <div className="option-picker__empty">
            <p>No matches for “{query.trim()}”.</p>
            <button
              onClick={() => {
                setQuery("");
                setActiveIndex(Math.max(0, options.findIndex(option => option.id === value)));
                searchRef.current?.focus();
              }}
              type="button"
            >
              Clear search
            </button>
          </div>
        ) : (
          <div
            aria-labelledby={`${baseId}-label`}
            className="option-picker__grid"
            id={listId}
            ref={gridRef}
            role="listbox"
            style={{ gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))` }}
          >
            {filtered.map((option, index) => (
              <div
                aria-selected={option.id === value}
                className="option-picker__option"
                data-active={index === activeIndex || undefined}
                id={`${baseId}-option-${String(index)}`}
                key={option.id}
                onClick={() => select(option.id)}
                onMouseMove={() => {
                  if (index !== activeIndex) setActiveIndex(index);
                }}
                role="option"
              >
                <OptionChip option={option} />
                <span className="option-picker__copy">
                  <strong>{option.label}</strong>
                  {option.description === undefined ? null : <small>{option.description}</small>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
