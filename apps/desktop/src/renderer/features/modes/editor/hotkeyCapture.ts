// DOM-keyboard fallback for hotkey binding capture. The preferred source is the
// main-process native hook in capture mode; when that is unavailable, this
// adapter emits the same HotkeyCaptureKey edges from window keydown/keyup.

import { modifierFromCode, type HotkeyCaptureKey } from "@soto/core";

export interface HotkeyCaptureOptions {
  onKey: (key: HotkeyCaptureKey) => void;
}

function captureKeyFromKeyboardEvent(
  event: KeyboardEvent,
  down: boolean,
): HotkeyCaptureKey | null {
  const modifier = modifierFromCode(event.code, event.key);
  if (modifier !== null) return { kind: "modifier", modifier, down };
  if (!down) return null;
  if (event.key === "Escape") return { kind: "escape" };
  if (event.key === "Enter") return { kind: "confirm" };
  return { kind: "other" };
}

export function bindHotkeyCapture(options: HotkeyCaptureOptions): () => void {
  function feed(event: KeyboardEvent, down: boolean): void {
    event.preventDefault();
    event.stopPropagation();
    const key = captureKeyFromKeyboardEvent(event, down);
    if (key !== null) options.onKey(key);
  }

  function onKeyDown(event: KeyboardEvent): void {
    feed(event, true);
  }

  function onKeyUp(event: KeyboardEvent): void {
    feed(event, false);
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);

  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
  };
}
