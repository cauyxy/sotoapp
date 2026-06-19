import { describe, expect, it } from "vitest";
import { MAC_SIGNATURES, WIN_SIGNATURES } from "./koffiAbi.js";

function argCount(sig: string): number {
  const inside = sig.slice(sig.indexOf("(") + 1, sig.lastIndexOf(")")).trim();
  if (inside === "" || inside === "void") return 0;
  return inside.split(",").length;
}

const MAC_EXPECTED: Record<keyof typeof MAC_SIGNATURES, number> = {
  hook_install: 2,
  hook_shutdown: 1,
  hook_next_event: 1,
  focus_probe: 0,
  send_paste: 0,
  clipboard_prepare_paste_text: 2,
  clipboard_restore_after_paste: 0,
  clipboard_copy_user_text: 2,
  ax_is_trusted: 1,
  ax_capture_focused: 1,
  ax_context_free: 1,
  window_title: 3,
  permission_status_kind: 1,
  request_permission: 1,
  open_permission_settings: 1,
  app_frontmost: 4,
  app_frontmost_window_bounds: 1,
  app_activate: 1,
  audio_is_output_muted: 0,
  audio_set_output_muted: 1,
};

const WIN_EXPECTED: Record<keyof typeof WIN_SIGNATURES, number> = {
  hook_install: 2,
  hook_shutdown: 1,
  hook_next_event: 1,
  focus_probe: 0,
  send_paste: 0,
  clipboard_read_text: 0,
  clipboard_write_text: 2,
  clipboard_snapshot_kind: 0,
  clipboard_capture: 0,
  clipboard_restore: 0,
  clipboard_set_excluded: 2,
  ax_is_trusted: 1,
  ax_capture_focused: 1,
  ax_context_free: 1,
  frontmost_pid: 0,
  frontmost_localized_name: 0,
  frontmost_window_title: 0,
  frontmost_window_bounds: 0,
  activate_app: 1,
  permission_status_kind: 1,
  request_permission: 1,
  audio_is_output_muted: 0,
  audio_set_output_muted: 1,
  free_string: 1,
};

describe("koffi ABI signature arity", () => {
  it("macOS signatures match the expected C arity", () => {
    for (const [key, expected] of Object.entries(MAC_EXPECTED)) {
      expect(argCount(MAC_SIGNATURES[key as keyof typeof MAC_SIGNATURES])).toBe(expected);
    }
  });

  it("Windows signatures match the expected C arity", () => {
    for (const [key, expected] of Object.entries(WIN_EXPECTED)) {
      expect(argCount(WIN_SIGNATURES[key as keyof typeof WIN_SIGNATURES])).toBe(expected);
    }
  });

  it("covers every exported signature", () => {
    expect(Object.keys(MAC_EXPECTED).sort()).toEqual(Object.keys(MAC_SIGNATURES).sort());
    expect(Object.keys(WIN_EXPECTED).sort()).toEqual(Object.keys(WIN_SIGNATURES).sort());
  });
});
