import { describe, expect, it, vi } from "vitest";
import {
  COMMAND_POLICY,
  CAPSULE_COMMANDS,
  ALL_COMMANDS,
  createIpcRegistry,
  type CommandName,
  type CommandHandler,
} from "./commands.js";
import { IpcRouter } from "./router.js";

type Handlers = Partial<Record<CommandName, CommandHandler>>;

describe("COMMAND_POLICY", () => {
  it("declares exactly the 28 Soto IPC commands", () => {
    // Control-plane commands + 2 mode CRUD commands + 1 confirm_dialog + 4
    // capture-lifecycle commands + 1 get_app_model + 1 repair_data. The
    // aggregated app model replaced the per-list reads
    // (list_modes/history/dictionary/providers and get_update_status),
    // create/set-default collapsed into save_provider_config, and the in-app
    // updater chain no longer exists.
    expect(ALL_COMMANDS).toHaveLength(28);
  });

  it("keeps repair_data main-only and no-argument", () => {
    expect(COMMAND_POLICY.repair_data.allowedWindows).toEqual(["main"]);
    expect(COMMAND_POLICY.repair_data.input.safeParse(undefined).success).toBe(true);
    expect(COMMAND_POLICY.repair_data.input.safeParse({}).success).toBe(false);
    expect(CAPSULE_COMMANDS).not.toContain("repair_data");
  });

  it("does not declare selection-action commands", () => {
    expect(ALL_COMMANDS.filter((name) => name.includes("selection"))).toEqual([]);
  });

  it("keeps delete_provider_config main-only and validates its config_id", () => {
    expect(COMMAND_POLICY.delete_provider_config.allowedWindows).toEqual(["main"]);
    expect(
      COMMAND_POLICY.delete_provider_config.input.safeParse({ config_id: "config.1" }).success,
    ).toBe(true);
    expect(COMMAND_POLICY.delete_provider_config.input.safeParse({}).success).toBe(false);
    expect(
      COMMAND_POLICY.delete_provider_config.input.safeParse({ config_id: 42 }).success,
    ).toBe(false);
  });

  it("registers create_mode and delete_mode as main-only", () => {
    expect(COMMAND_POLICY.create_mode.allowedWindows).toEqual(["main"]);
    expect(COMMAND_POLICY.delete_mode.allowedWindows).toEqual(["main"]);
    expect(CAPSULE_COMMANDS).not.toContain("create_mode");
    expect(CAPSULE_COMMANDS).not.toContain("delete_mode");
  });

  it("validates delete_mode input shape", () => {
    expect(COMMAND_POLICY.delete_mode.input.safeParse({ mode_id: "mode.x" }).success).toBe(true);
    expect(COMMAND_POLICY.delete_mode.input.safeParse({}).success).toBe(false);
  });

  it("validates create_mode input shape", () => {
    expect(COMMAND_POLICY.create_mode.input.safeParse({ request: { name: "x" } }).success).toBe(true);
    expect(COMMAND_POLICY.create_mode.input.safeParse({ request: {} }).success).toBe(false);
  });

  it("keeps get_app_model main-only and no-argument", () => {
    expect(COMMAND_POLICY.get_app_model.allowedWindows).toEqual(["main"]);
    expect(COMMAND_POLICY.get_app_model.input.safeParse(undefined).success).toBe(true);
    expect(COMMAND_POLICY.get_app_model.input.safeParse({}).success).toBe(false);
  });

  it("authorizes every command from the main window", () => {
    for (const name of ALL_COMMANDS) {
      expect(COMMAND_POLICY[name].allowedWindows).toContain("main");
    }
  });

  it("grants the capsule window least privilege: dictation capture only", () => {
    const capsule = ALL_COMMANDS.filter((n) =>
      COMMAND_POLICY[n].allowedWindows.includes("capsule"),
    );
    expect(new Set(capsule)).toEqual(
      new Set([
        "cancel_active_voice_runtime",
        "finish_active_voice_runtime",
        "capture_started",
        "push_capture_audio",
        "push_capture_level",
        "report_capture_error",
      ]),
    );
    expect(new Set(CAPSULE_COMMANDS)).toEqual(new Set(capsule));
  });

  it("validates command input: save_mode rejects an unknown conflict policy", () => {
    const ok = COMMAND_POLICY.save_mode.input.safeParse({
      request: {
        mode: {
          id: "m",
          name: "M",
          prompt_body: "",
          hotkey: null,
          display_order: 0,
          built_in: false,
          created_at: 0,
          updated_at: 0,
        },
        hotkey_conflict_policy: "reject",
      },
    });
    expect(ok.success).toBe(true);

    const bad = COMMAND_POLICY.save_mode.input.safeParse({
      request: { mode: {}, hotkey_conflict_policy: "steal-and-burn" },
    });
    expect(bad.success).toBe(false);
  });

  it("validates command input: open_permission_settings only accepts a known pane", () => {
    const removedPane = ["screen", "recording"].join("_");

    expect(COMMAND_POLICY.open_permission_settings.input.safeParse({ pane: "microphone" }).success).toBe(true);
    expect(COMMAND_POLICY.open_permission_settings.input.safeParse({ pane: removedPane }).success).toBe(false);
    expect(COMMAND_POLICY.open_permission_settings.input.safeParse({ pane: "automation" }).success).toBe(false);
    expect(COMMAND_POLICY.open_permission_settings.input.safeParse({ pane: "camera" }).success).toBe(false);
  });

  it("keeps confirm_dialog main-only and validates its schema", () => {
    expect(COMMAND_POLICY.confirm_dialog.allowedWindows).toEqual(["main"]);
    // Only `message` is required; the optional fields and a bare message both parse.
    expect(COMMAND_POLICY.confirm_dialog.input.safeParse({ message: "Clear all?" }).success).toBe(true);
    expect(
      COMMAND_POLICY.confirm_dialog.input.safeParse({
        message: "Clear all?",
        detail: "Cannot be undone.",
        confirmLabel: "Clear",
        cancelLabel: "Cancel",
      }).success,
    ).toBe(true);
    // A missing message (or a non-string one) is rejected at the boundary.
    expect(COMMAND_POLICY.confirm_dialog.input.safeParse({}).success).toBe(false);
    expect(COMMAND_POLICY.confirm_dialog.input.safeParse({ message: 42 }).success).toBe(false);
  });

});

describe("createIpcRegistry", () => {
  function stubHandlers() {
    return Object.fromEntries(ALL_COMMANDS.map((n) => [n, vi.fn()])) as Record<
      CommandName,
      ReturnType<typeof vi.fn>
    >;
  }

  it("throws if a handler is missing for any command", () => {
    const partial = stubHandlers();
    delete (partial as Record<string, unknown>).save_mode;
    expect(() => createIpcRegistry(partial as Handlers)).toThrow(/save_mode/);
  });

  it("produces a router that enforces capsule least-privilege", async () => {
    const handlers = stubHandlers();
    handlers.cancel_active_voice_runtime.mockReturnValue(undefined);
    const router = new IpcRouter(createIpcRegistry(handlers as Handlers));

    const forbidden = await router.dispatch("get_app_settings", undefined, { window: "capsule" });
    expect(forbidden).toEqual({ ok: false, error: "forbidden" });
    expect(handlers.get_app_settings).not.toHaveBeenCalled();

    const allowed = await router.dispatch("cancel_active_voice_runtime", undefined, { window: "capsule" });
    expect(allowed.ok).toBe(true);
    expect(handlers.cancel_active_voice_runtime).toHaveBeenCalled();
  });
});
