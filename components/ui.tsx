"use client";

import { ThemeMenuButton as DesignThemeMenuButton } from "@hraness/design-kit/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";

import type { AnalyticsSurface } from "@/lib/analytics";

export type SegmentedItem<Value extends string> = Readonly<{
  id: Value;
  label: ReactNode;
}>;

export type ToggleItem<Value extends string> = Readonly<{
  id: Value;
  label: ReactNode;
  leading?: ReactNode;
  style?: CSSProperties;
}>;

export type BarListChartDatum = Readonly<{
  color: string;
  detail: string;
  id: string;
  label: string;
  value: number;
}>;

export type RangePlotChartDatum = Readonly<{
  color: string;
  detail: string;
  id: string;
  label: string;
  maximum: number;
  median: number;
  minimum: number;
}>;

export function Icon({
  icon,
  size,
  strokeWidth,
}: Readonly<{
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  size?: number;
  strokeWidth?: number;
}>) {
  return <HugeiconsIcon aria-hidden="true" icon={icon} size={size} strokeWidth={strokeWidth} />;
}

type IconButtonProps = Readonly<{
  "aria-label": string;
  children: ReactNode;
  className?: string;
  controlClassName?: string;
  onPress?: () => void;
  size?: "compact" | "regular";
  tooltip?: string;
}>;

export function IconButton({
  "aria-label": ariaLabel,
  children,
  className = "",
  controlClassName = "",
  onPress,
  size = "regular",
  tooltip,
}: IconButtonProps) {
  return (
    <span className={`ui-icon-button ui-surface ${className}`.trim()} data-size={size}>
      <button
        aria-label={ariaLabel}
        className={`ui-icon-button__control ${controlClassName}`.trim()}
        onClick={onPress}
        title={tooltip}
        type="button"
      >
        {children}
      </button>
    </span>
  );
}

type MenuState = Readonly<{
  close: () => void;
}>;

const MenuContext = createContext<MenuState | null>(null);

export function MenuTrigger({
  children,
  isOpen,
  onOpenChange,
}: Readonly<{
  children: ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}>) {
  const childArray = Children.toArray(children);
  const trigger = childArray[0];
  const menu = childArray[1];
  const [internalOpen, setInternalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const open = isOpen ?? internalOpen;

  const setOpen = useCallback((next: boolean) => {
    if (isOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, setOpen]);

  const triggerElement = isValidElement<IconButtonProps>(trigger)
    ? cloneElement(trigger, {
      onPress: () => {
        trigger.props.onPress?.();
        setOpen(!open);
      },
    })
    : trigger;

  return (
    <div className="ui-menu-trigger" ref={containerRef}>
      {triggerElement}
      {open && (
        <MenuContext.Provider value={{ close: () => setOpen(false) }}>
          {menu}
        </MenuContext.Provider>
      )}
    </div>
  );
}

export function Menu({
  "aria-label": ariaLabel,
  children,
  className = "",
  footer,
  placement = "bottom start",
  popoverClassName = "",
}: Readonly<{
  "aria-label": string;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  placement?: "bottom start" | "bottom end";
  popoverClassName?: string;
  shouldCloseOnSelect?: boolean;
}>) {
  return (
    <div
      className={`ui-menu-popover ${popoverClassName}`.trim()}
      data-placement={placement}
      role="presentation"
    >
      <div aria-label={ariaLabel} className={`ui-menu ${className}`.trim()} role="menu">
        {children}
        {footer !== undefined && <div className="ui-menu__footer">{footer}</div>}
      </div>
    </div>
  );
}

export function MenuSection({ children, title }: Readonly<{ children: ReactNode; title: ReactNode }>) {
  return (
    <section className="ui-menu__section">
      <div className="ui-menu__header">{title}</div>
      {children}
    </section>
  );
}

export function MenuItem({
  children,
  description,
  href,
  id,
  isDisabled = false,
  leading,
  onAction,
  rel,
  target,
}: Readonly<{
  children: ReactNode;
  description?: ReactNode;
  href?: string;
  id: string;
  isDisabled?: boolean;
  leading?: ReactNode;
  onAction?: () => void;
  rel?: string;
  target?: string;
  textValue?: string;
}>) {
  const menu = useContext(MenuContext);
  const content = (
    <>
      {leading !== undefined && <span className="ui-menu__leading">{leading}</span>}
      <span className="ui-menu__copy">
        <span className="ui-menu__label">{children}</span>
        {description !== undefined && <span className="ui-menu__description">{description}</span>}
      </span>
    </>
  );
  const activate = () => {
    if (isDisabled) return;
    onAction?.();
    if (href !== undefined) menu?.close();
  };

  if (href !== undefined && !isDisabled) {
    return (
      <a className="ui-menu__item" href={href} id={id} onClick={activate} rel={rel} role="menuitem" target={target}>
        {content}
      </a>
    );
  }
  return (
    <button
      className="ui-menu__item"
      data-disabled={isDisabled || undefined}
      disabled={isDisabled}
      id={id}
      onClick={activate}
      role="menuitem"
      type="button"
    >
      {content}
    </button>
  );
}

export function PageCanvas({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> & Readonly<{ inset?: string; size?: string }>) {
  const { inset: _inset, size: _size, ...mainProps } = props;
  return <main className={className} data-inset={_inset} data-size={_size} {...mainProps}>{children}</main>;
}

export function TopBar({
  "data-analytics-surface": analyticsSurface,
  actions,
  className = "",
  isSticky = true,
  title,
}: Readonly<{
  actions?: ReactNode;
  className?: string;
  "data-analytics-surface"?: AnalyticsSurface;
  isSticky?: boolean;
  title: ReactNode;
}>) {
  return (
    <header
      className={`ui-top-bar ${className}`.trim()}
      data-analytics-surface={analyticsSurface}
      data-sticky={isSticky || undefined}
    >
      <div className="ui-top-bar__title">{title}</div>
      {actions !== undefined && <div className="ui-top-bar__actions">{actions}</div>}
    </header>
  );
}

export function SegmentedControl<Value extends string>({
  "aria-label": ariaLabel,
  className = "",
  items,
  onChange,
  value,
}: Readonly<{
  "aria-label": string;
  className?: string;
  items: readonly SegmentedItem<Value>[];
  onChange: (value: Value) => void;
  size?: "compact" | "regular";
  value: Value;
}>) {
  return (
    <div aria-label={ariaLabel} className={`ui-segmented-control ${className}`.trim()} role="radiogroup">
      {items.map((item) => (
        <button
          aria-checked={value === item.id}
          className="ui-segmented-control__item"
          data-selected={value === item.id || undefined}
          key={item.id}
          onClick={() => onChange(item.id)}
          role="radio"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function ToggleGroup<Value extends string>({
  "aria-label": ariaLabel,
  className = "",
  groupRef,
  items,
  onChange,
  onItemBlur,
  onItemFocus,
  onItemHoverEnd,
  onItemHoverStart,
  surfaceClassName = "",
  value,
}: Readonly<{
  "aria-label": string;
  className?: string;
  groupRef?: Ref<HTMLDivElement>;
  items: readonly ToggleItem<Value>[];
  onChange: (value: Value | null) => void;
  onItemBlur?: (value: Value) => void;
  onItemFocus?: (value: Value) => void;
  onItemHoverEnd?: (value: Value) => void;
  onItemHoverStart?: (value: Value) => void;
  surfaceClassName?: string;
  value: Value | null;
}>) {
  return (
    <div className={`ui-toggle-group__surface ui-surface ${surfaceClassName}`.trim()}>
      <div aria-label={ariaLabel} className={className} ref={groupRef} role="group">
        {items.map((item) => (
          <button
            aria-pressed={value === item.id}
            className="ui-toggle-group__item"
            data-selected={value === item.id || undefined}
            key={item.id}
            onBlur={() => onItemBlur?.(item.id)}
            onFocus={() => onItemFocus?.(item.id)}
            onMouseEnter={() => onItemHoverStart?.(item.id)}
            onMouseLeave={() => onItemHoverEnd?.(item.id)}
            onClick={() => onChange(value === item.id ? null : item.id)}
            style={item.style}
            type="button"
          >
            {item.leading}{item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ThemeMenuButton({
  "aria-label": ariaLabel,
}: Readonly<{
  "aria-label": string;
}>) {
  return <DesignThemeMenuButton aria-label={ariaLabel} />;
}

export function TextField({
  className = "",
  inputRef,
  isReadOnly,
  label,
  onFocus,
  value,
}: Readonly<{
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  isReadOnly?: boolean;
  label: string;
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  value: string;
}>) {
  return (
    <label className={`ui-field ${className}`.trim()}>
      <span className="ui-field__label">{label}</span>
      <input className="ui-field__input" onFocus={onFocus} readOnly={isReadOnly} ref={inputRef} value={value} />
    </label>
  );
}

function clampPercent(value: number, domain: readonly [number, number]): number {
  const span = domain[1] - domain[0];
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((value - domain[0]) / span) * 100));
}

export function BarListChart({
  "aria-label": ariaLabel,
  data,
  domain,
  formatValue,
  onSelectionChange,
  selectedId,
}: Readonly<{
  "aria-label": string;
  data: readonly BarListChartDatum[];
  domain: readonly [number, number];
  formatValue: (value: number) => string;
  onSelectionChange: (id: string) => void;
  selectedId: string | null;
}>) {
  return (
    <div aria-label={ariaLabel} className="ui-bar-list-chart" role="group">
      {data.map((row) => (
        <button
          aria-pressed={selectedId === row.id}
          className="ui-chart-row"
          data-selected={selectedId === row.id || undefined}
          key={row.id}
          onClick={() => onSelectionChange(row.id)}
          type="button"
        >
          <span className="ui-chart-row__copy"><strong>{row.label}</strong><small>{row.detail}</small></span>
          <span className="ui-bar-list-chart__track">
            <i style={{ background: row.color, width: `${clampPercent(row.value, domain)}%` }} />
          </span>
          <span className="ui-chart-row__value">{formatValue(row.value)}</span>
        </button>
      ))}
    </div>
  );
}

export function RangePlotChart({
  "aria-label": ariaLabel,
  data,
  domain,
  formatValue,
  onSelectionChange,
  selectedId,
}: Readonly<{
  "aria-label": string;
  data: readonly RangePlotChartDatum[];
  domain: readonly [number, number];
  formatValue: (value: number) => string;
  onSelectionChange: (id: string) => void;
  selectedId: string | null;
}>) {
  return (
    <div aria-label={ariaLabel} className="ui-range-plot-chart__rows" role="group">
      {data.map((row) => {
        const minimum = clampPercent(row.minimum, domain);
        const maximum = clampPercent(row.maximum, domain);
        const median = clampPercent(row.median, domain);
        return (
          <button
            aria-pressed={selectedId === row.id}
            className="ui-chart-row"
            data-selected={selectedId === row.id || undefined}
            key={row.id}
            onClick={() => onSelectionChange(row.id)}
            type="button"
          >
            <span className="ui-chart-row__copy"><strong>{row.label}</strong><small>{row.detail}</small></span>
            <span className="ui-range-plot-chart__track">
              <i style={{ background: row.color, left: `${minimum}%`, width: `${Math.max(1, maximum - minimum)}%` }} />
              <b style={{ background: row.color, left: `${median}%` }} />
            </span>
            <span className="ui-chart-row__value">{formatValue(row.median)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function LinkButton({
  children,
  className = "",
  href,
}: Readonly<{
  children: ReactNode;
  className?: string;
  href: string;
  size?: "compact";
  variant?: "quiet";
}>) {
  return <a className={`ui-link-button ${className}`.trim()} href={href}>{children}</a>;
}

export function SkipLink({ children, href }: Readonly<{ children: ReactNode; href: string }>) {
  return <a className="ui-skip-link" href={href}>{children}</a>;
}

export function Breadcrumbs({
  "aria-label": ariaLabel,
  className = "",
  items,
}: Readonly<{
  "aria-label": string;
  className?: string;
  items: readonly Readonly<{ href?: string; id: string; label: string }>[];
}>) {
  return (
    <nav aria-label={ariaLabel} className={className}>
      <ol>
        {items.map((item) => (
          <li key={item.id}>
            {item.href === undefined
              ? <span aria-current="page">{item.label}</span>
              : <a href={item.href}>{item.label}</a>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
