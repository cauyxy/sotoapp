import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  ChevronIcon,
  focusPopoverItem,
  popoverOverlayRoot,
  type PopoverAlign,
  usePopoverDismiss,
  usePopoverPosition,
} from "./Menu";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  content?: ReactNode;
  textValue?: string;
}

export function Select({
  id,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  align = "end",
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  align?: PopoverAlign;
  className?: string;
  "aria-label"?: string;
}): JSX.Element {
  const generatedId = useId();
  const triggerId = id ?? `${generatedId}-trigger`;
  const listId = `${generatedId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<{ text: string; timer: number | null }>({ text: "", timer: null });
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.value === value) ?? null;

  const close = useCallback((): void => {
    setOpen(false);
  }, []);

  const closeAndFocusTrigger = useCallback((): void => {
    close();
    triggerRef.current?.focus();
  }, [close]);

  usePopoverDismiss(open, rootRef, panelRef, closeAndFocusTrigger);
  const panelStyle = usePopoverPosition(open, align, triggerRef, panelRef, close);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      const selectedItem = panelRef.current?.querySelector<HTMLButtonElement>(
        `[aria-selected="true"]:not(:disabled)`,
      );
      if (selectedItem !== undefined && selectedItem !== null) {
        selectedItem.focus();
      } else {
        focusPopoverItem(panelRef.current, "first");
      }
    });
  }, [open, value]);

  useEffect(
    () => () => {
      if (searchRef.current.timer !== null) {
        window.clearTimeout(searchRef.current.timer);
      }
    },
    [],
  );

  function pick(option: SelectOption): void {
    if (option.disabled) return;
    onChange(option.value);
    closeAndFocusTrigger();
  }

  const target = popoverOverlayRoot();

  function focusByText(nextChar: string): void {
    if (searchRef.current.timer !== null) {
      window.clearTimeout(searchRef.current.timer);
    }
    searchRef.current.text = `${searchRef.current.text}${nextChar.toLowerCase()}`;
    searchRef.current.timer = window.setTimeout(() => {
      searchRef.current.text = "";
      searchRef.current.timer = null;
    }, 650);

    const needle = searchRef.current.text;
    const match = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>("[data-popover-item]:not(:disabled)") ??
        [],
    ).find((item) => item.dataset.textValue?.toLowerCase().startsWith(needle) ?? false);
    match?.focus();
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusPopoverItem(panelRef.current, "next");
        break;
      case "ArrowUp":
        event.preventDefault();
        focusPopoverItem(panelRef.current, "previous");
        break;
      case "Home":
        event.preventDefault();
        focusPopoverItem(panelRef.current, "first");
        break;
      case "End":
        event.preventDefault();
        focusPopoverItem(panelRef.current, "last");
        break;
      case "Escape":
        event.preventDefault();
        closeAndFocusTrigger();
        break;
      default:
        if (event.key.length === 1) {
          event.preventDefault();
          focusByText(event.key);
        }
    }
  }

  return (
    <div className={`popover-root select-root ${className ?? ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((next) => !next)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={`select-value${selected === null ? " select-value-placeholder" : ""}`}>
          {selected?.content ?? selected?.label ?? placeholder ?? ""}
        </span>
        <span className="select-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>
      {open && target !== null ? createPortal(
        <div
          ref={panelRef}
          id={listId}
          className={`popover-panel popover-panel-${align} select-panel`}
          role="listbox"
          aria-labelledby={triggerId}
          style={panelStyle}
          onKeyDown={handleListKeyDown}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              data-popover-item
              data-select-value={option.value}
              data-text-value={option.textValue ?? option.label}
              className="select-option"
              disabled={option.disabled}
              onClick={() => pick(option)}
            >
              <span className="select-option-content">{option.content ?? option.label}</span>
            </button>
          ))}
        </div>,
        target,
      ) : null}
    </div>
  );
}
