// Pure context-menu policy (no electron import). windows.ts turns these roles
// into an Electron Menu for the main-window context-menu event.

export type ContextMenuRole = "cut" | "copy" | "paste" | "selectAll";

export interface ContextMenuParams {
  isEditable: boolean;
  selectionText: string;
}

export function contextMenuRoles(params: ContextMenuParams): ContextMenuRole[] {
  if (params.isEditable) {
    return ["cut", "copy", "paste", "selectAll"];
  }
  if (params.selectionText.trim().length > 0) {
    return ["copy"];
  }
  return [];
}
