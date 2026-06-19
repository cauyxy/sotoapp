// Native OS confirmation dialog, injected into the IPC handlers (handlers.ts
// is electron-free). Parents the sheet to the given window when alive. Button
// order is [cancel, confirm]: Cancel is both the default (Enter) and the
// cancel (Esc / window-close) action so an irreversible action is never the
// accidental default. Resolves true only when the user explicitly picks
// Confirm.

import { dialog, type BrowserWindow } from "electron";
import type { ConfirmDialogInput } from "@soto/core";

export async function showNativeConfirmDialog(
  opts: ConfirmDialogInput,
  parentWindow: BrowserWindow | null,
): Promise<boolean> {
  const confirmLabel = opts.confirmLabel ?? "OK";
  const cancelLabel = opts.cancelLabel ?? "Cancel";
  const CANCEL_INDEX = 0;
  const CONFIRM_INDEX = 1;
  const messageBoxOptions = {
    type: "warning" as const,
    buttons: [cancelLabel, confirmLabel],
    defaultId: CANCEL_INDEX,
    cancelId: CANCEL_INDEX,
    message: opts.message,
    ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
  };
  // Two overloads: parent the sheet to the window when one is alive, otherwise
  // show a free-standing dialog (passing `undefined` doesn't satisfy the
  // (window, options) overload, so branch instead of coalescing).
  const parent = parentWindow !== null && !parentWindow.isDestroyed() ? parentWindow : null;
  const { response } = parent
    ? await dialog.showMessageBox(parent, messageBoxOptions)
    : await dialog.showMessageBox(messageBoxOptions);
  return response === CONFIRM_INDEX;
}
