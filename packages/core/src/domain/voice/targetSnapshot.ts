import type { AxContext } from "../../contract/schema.js";

/**
 * The selected substring of a focused-control AX context (full_text between
 * selection_start and selection_end). Empty string when there is no selection
 * (start === end) or no context. Pure; no clamping needed (native always
 * reports valid offsets).
 */
export function selectedTextOf(ax: AxContext | null): string {
  if (ax === null) return "";
  return ax.full_text.slice(ax.selection_start, ax.selection_end);
}
