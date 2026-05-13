import { hotkeyCaptureFromModifierRelease, modifierKeyId } from "./modes.hotkey";
import type { ModeEditorDraft } from "./modes.draft";

export interface HotkeyCaptureOptions {
  onCapture: (patch: Partial<ModeEditorDraft>) => void;
  onCancel: () => void;
}

// Attaches keydown/keyup window listeners that resolve either:
//   - a single-modifier press (e.g. Right Cmd alone), invoking onCapture on release, or
//   - Escape, invoking onCancel.
// Non-modifier keys (letters, digits, Fn-row keys, etc.) are ignored so the
// user can keep trying without leaving capture mode. Returns a cleanup
// function. Call from inside an `$effect` when capture is active.
export function bindHotkeyCapture({ onCapture, onCancel }: HotkeyCaptureOptions): () => void {
  const heldModifierIds = new Set<string>();
  let committed = false;

  function commit(captured: Partial<ModeEditorDraft> | null) {
    if (committed) return;
    if (!captured) return;
    committed = true;
    onCapture(captured);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (committed) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      committed = true;
      onCancel();
      return;
    }

    const modifierId = modifierKeyId(event.code, event.key);
    if (modifierId !== null) {
      heldModifierIds.add(modifierId);
    }
    // Non-modifier keys are silently ignored — bindings are modifier-only.
  }

  function onKeyUp(event: KeyboardEvent) {
    if (committed) return;
    const modifierId = modifierKeyId(event.code, event.key);
    if (modifierId === null) return;

    const wasHeld = heldModifierIds.delete(modifierId);
    if (!wasHeld) return;

    // Commit only when the just-released modifier was held alone. If the user
    // was holding a combo, releasing one of them leaves the other(s) held —
    // don't commit either.
    if (heldModifierIds.size === 0) {
      commit(hotkeyCaptureFromModifierRelease({ code: event.code, key: event.key }));
    }
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);

  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
  };
}
