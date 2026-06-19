import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { IconButton } from "./IconButton";

export type PopoverAlign = "start" | "end";
export const POPOVER_VIEW_CHANGE_EVENT = "soto:popover-view-change";

const POPOVER_OFFSET = 6;
const POPOVER_VIEWPORT_MARGIN = 8;
const POPOVER_MIN_HEIGHT = 80;
const POPOVER_MIN_WIDTH = 180;

export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon?: ReactNode;
}

interface PopoverGeometry {
  top: number;
  left: number;
  maxHeight: number;
  minWidth: number;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function viewportSize(): { width: number; height: number } {
  const visualViewport = window.visualViewport;
  return {
    width: visualViewport?.width ?? window.innerWidth,
    height: visualViewport?.height ?? window.innerHeight,
  };
}

function isAnchorVisible(anchor: HTMLElement, viewport: { width: number; height: number }): boolean {
  if (!anchor.isConnected || anchor.getClientRects().length === 0) return false;
  const rect = anchor.getBoundingClientRect();
  return rect.bottom > 0 && rect.right > 0 && rect.top < viewport.height && rect.left < viewport.width;
}

function computePopoverGeometry(
  trigger: HTMLElement,
  panel: HTMLElement,
  align: PopoverAlign,
): PopoverGeometry | null {
  const viewport = viewportSize();
  if (!isAnchorVisible(trigger, viewport)) return null;

  const triggerRect = trigger.getBoundingClientRect();
  const maxPanelWidth = Math.max(0, viewport.width - POPOVER_VIEWPORT_MARGIN * 2);
  const minWidth = Math.min(
    Math.max(POPOVER_MIN_WIDTH, Math.ceil(triggerRect.width)),
    maxPanelWidth,
  );
  const measuredWidth = Math.max(panel.offsetWidth, minWidth);
  const panelWidth = Math.min(measuredWidth, maxPanelWidth);

  let left = align === "end" ? triggerRect.right - panelWidth : triggerRect.left;
  left = clamp(left, POPOVER_VIEWPORT_MARGIN, viewport.width - panelWidth - POPOVER_VIEWPORT_MARGIN);

  const naturalHeight = panel.scrollHeight || panel.offsetHeight || 280;
  const belowSpace = viewport.height - triggerRect.bottom - POPOVER_OFFSET - POPOVER_VIEWPORT_MARGIN;
  const aboveSpace = triggerRect.top - POPOVER_OFFSET - POPOVER_VIEWPORT_MARGIN;
  const openAbove = naturalHeight > belowSpace && aboveSpace > belowSpace;
  const availableHeight = openAbove ? aboveSpace : belowSpace;
  const maxHeight = Math.max(POPOVER_MIN_HEIGHT, Math.floor(availableHeight));
  const panelHeight = Math.min(naturalHeight, maxHeight);

  let top = openAbove
    ? triggerRect.top - POPOVER_OFFSET - panelHeight
    : triggerRect.bottom + POPOVER_OFFSET;
  top = clamp(top, POPOVER_VIEWPORT_MARGIN, viewport.height - panelHeight - POPOVER_VIEWPORT_MARGIN);

  return {
    top: Math.round(top),
    left: Math.round(left),
    maxHeight,
    minWidth,
  };
}

export function popoverOverlayRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("overlay-root");
}

export function usePopoverPosition(
  open: boolean,
  align: PopoverAlign,
  triggerRef: RefObject<HTMLElement>,
  panelRef: RefObject<HTMLElement>,
  onClose: () => void,
): CSSProperties {
  const [geometry, setGeometry] = useState<PopoverGeometry | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const update = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (trigger === null || panel === null) return;

    const next = computePopoverGeometry(trigger, panel, align);
    if (next === null) {
      setGeometry(null);
      onCloseRef.current();
      return;
    }
    setGeometry(next);
  }, [align, panelRef, triggerRef]);

  useLayoutEffect(() => {
    if (!open || typeof window === "undefined") {
      setGeometry(null);
      return;
    }

    let frame: number | null = null;
    const scheduleUpdate = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        update();
      });
    };

    update();
    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleUpdate);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
    };
  }, [open, update]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (trigger === null || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined && !entry.isIntersecting) {
        onCloseRef.current();
      }
    }, { threshold: 0.01 });
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const close = () => onCloseRef.current();
    window.addEventListener(POPOVER_VIEW_CHANGE_EVENT, close);
    return () => window.removeEventListener(POPOVER_VIEW_CHANGE_EVENT, close);
  }, [open]);

  return geometry === null
    ? { visibility: "hidden" }
    : {
        top: geometry.top,
        left: geometry.left,
        maxHeight: geometry.maxHeight,
        minWidth: geometry.minWidth,
      };
}

export function usePopoverDismiss(
  open: boolean,
  rootRef: RefObject<HTMLElement>,
  panelRef: RefObject<HTMLElement>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent): void {
      const root = rootRef.current;
      const panel = panelRef.current;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (root?.contains(target) || panel?.contains(target)) return;
      onClose();
    }

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open, panelRef, rootRef]);
}

export function focusPopoverItem(
  root: HTMLElement | null,
  target: "first" | "last" | "next" | "previous",
): void {
  if (root === null) return;
  const items = Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-popover-item]:not(:disabled)"),
  );
  if (items.length === 0) return;

  const active = document.activeElement;
  const currentIndex = active instanceof HTMLButtonElement ? items.indexOf(active) : -1;
  const nextIndex =
    target === "first"
      ? 0
      : target === "last"
        ? items.length - 1
        : target === "next"
          ? (currentIndex + 1 + items.length) % items.length
          : (currentIndex - 1 + items.length) % items.length;
  items[nextIndex]?.focus();
}

export function MoreIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="12.5" cy="8" r="1.25" />
    </svg>
  );
}

export function ChevronIcon(): JSX.Element {
  return (
    <svg width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden="true">
      <path
        d="M1.5 1.5 6 6l4.5-4.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Menu({
  label,
  items,
  align = "end",
  className,
}: {
  label: string;
  items: MenuItem[];
  align?: PopoverAlign;
  className?: string;
}): JSX.Element {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

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
    window.requestAnimationFrame(() => focusPopoverItem(panelRef.current, "first"));
  }, [open]);

  const target = popoverOverlayRoot();

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
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
    }
  }

  return (
    <div className={`popover-root menu-root ${className ?? ""}`} ref={rootRef}>
      <IconButton
        ref={triggerRef}
        icon={<MoreIcon />}
        label={label}
        className="menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((next) => !next)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      {open && target !== null ? createPortal(
        <div
          ref={panelRef}
          id={listId}
          className={`popover-panel popover-panel-${align} menu-panel`}
          role="menu"
          style={panelStyle}
          onKeyDown={handleListKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-popover-item
              className={`menu-item${item.danger ? " menu-item-danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                close();
              }}
            >
              {item.icon ? <span className="menu-item-icon">{item.icon}</span> : null}
              <span className="menu-item-label">{item.label}</span>
            </button>
          ))}
        </div>,
        target,
      ) : null}
    </div>
  );
}
