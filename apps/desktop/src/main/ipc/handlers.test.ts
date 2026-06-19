import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { IpcRouter, createIpcRegistry } from "@soto/ipc";
import { applyMigrations } from "../db/migrate.js";
import { SqliteStore, identityCrypto } from "../db/store.js";
import { createHandlers } from "./handlers.js";
import { createStubNativeBridge, type NativeBridge } from "@soto/native-bridge";

// End-to-end wiring test: real SqliteStore (in-memory) behind the real handlers
// behind the real IpcRouter — exactly the main-process path, minus Electron.
function makeRouter(
  sessionController: Parameters<typeof createHandlers>[2] = undefined,
  runtimeOptions: Parameters<typeof createHandlers>[3] = {},
  native: NativeBridge = createStubNativeBridge(),
) {
  const db = new Database(":memory:");
  applyMigrations(db);
  const store = new SqliteStore(db, identityCrypto);
  store.seedIfNeeded();
  const handlers = createHandlers(store, native, sessionController, runtimeOptions);
  return { router: new IpcRouter(createIpcRegistry(handlers)), store };
}

const main = { window: "main" as const };

describe("IPC handlers over the real store", () => {
  it("get_app_model returns the seeded built-in modes", async () => {
    const { router } = makeRouter();
    const res = await router.dispatch("get_app_model", undefined, main);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const model = res.value as {
        modes: { id: string }[];
      };
      const removedKeys = [`selection${"Actions"}`, `selection${"Action"}Settings`];
      expect(model.modes.map((m) => m.id)).toEqual(["default", "translate"]);
      for (const key of removedKeys) expect(key in model).toBe(false);
    }
  });

  it("repair_data invokes the injected repairData capability", async () => {
    let repaired = 0;
    const { router } = makeRouter(undefined, {
      repairData: () => {
        repaired += 1;
      },
    });
    const res = await router.dispatch("repair_data", undefined, main);
    expect(res.ok).toBe(true);
    expect(repaired).toBe(1);
  });

  it("save_app_settings persists and get_app_settings reads it back", async () => {
    const { router } = makeRouter();
    let savedSettings: unknown = null;
    const withHook = makeRouter(undefined, {
      onSettingsSaved: (settings: unknown) => {
        savedSettings = settings;
      },
    } as Parameters<typeof createHandlers>[3] & {
      onSettingsSaved: (settings: unknown) => void;
    });
    const settings = {
      locale: "en",
      active_provider_config_id: null,
      transcription_language_hint: "",
      microphone_device_id: null,
      input_level: 0,
      history_enabled: false,
      theme: "dark",
      use_proxy: false,
      history_retention_days: 7,
      current_mode_id: null,
      audio_retention_enabled: false,
      hide_app_icon: true,
    };
    await router.dispatch("save_app_settings", { settings }, main);
    const res = await router.dispatch("get_app_settings", undefined, main);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toMatchObject({
        locale: "en",
        theme: "dark",
        history_retention_days: 7,
        hide_app_icon: true,
      });
    }

    await withHook.router.dispatch("save_app_settings", { settings }, main);
    expect(savedSettings).toMatchObject({ hide_app_icon: true });
  });

  it("save_provider_config (config_id: null) creates the config and never returns the api_key", async () => {
    const { router, store } = makeRouter();
    const res = await router.dispatch(
      "save_provider_config",
      {
        request: {
          config_id: null,
          provider_id: "mimo-api",
          display_name: null,
          model: "mimo-v2.5",
          base_url: null,
          api_key: "super-secret",
          is_default: true,
        },
      },
      main,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const config = res.value as { config_id: string };
    expect(config).not.toHaveProperty("api_key");
    // The secret is persisted (encrypted) and retrievable only main-side.
    expect(store.getProviderSecrets(config.config_id)?.api_key).toBe("super-secret");
    const model = await router.dispatch("get_app_model", undefined, main);
    // bigint-safe serialization (Electron IPC uses structured clone, not JSON).
    const dump = JSON.stringify(
      model.ok ? (model.value as { providerConfigs: unknown }).providerConfigs : null,
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    );
    expect(dump).not.toContain("super-secret");
    expect(dump).not.toContain("api_key");
  });

  it("open_permission_settings returns native success without fallback", async () => {
    const fallback = vi.fn(() => true);
    const native = {
      ...createStubNativeBridge(),
      openPermissionSettings: vi.fn(() => true),
    };
    const { router } = makeRouter(undefined, { openPermissionSettingsFallback: fallback }, native);

    const result = await router.dispatch(
      "open_permission_settings",
      { pane: "accessibility" },
      main,
    );

    expect(result).toEqual({ ok: true, value: true });
    expect(native.openPermissionSettings).toHaveBeenCalledWith("accessibility");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("open_permission_settings falls back when native cannot open the pane", async () => {
    const fallback = vi.fn(() => true);
    const native = {
      ...createStubNativeBridge(),
      openPermissionSettings: vi.fn(() => false),
    };
    const { router } = makeRouter(undefined, { openPermissionSettingsFallback: fallback }, native);

    const result = await router.dispatch(
      "open_permission_settings",
      { pane: "accessibility" },
      main,
    );

    expect(result).toEqual({ ok: true, value: true });
    expect(native.openPermissionSettings).toHaveBeenCalledWith("accessibility");
    expect(fallback).toHaveBeenCalledWith("accessibility");
  });

  it("test_provider_config stamps the persisted validation (impl-log decision 3)", async () => {
    const { router, store } = makeRouter();
    const saved = await router.dispatch(
      "save_provider_config",
      {
        request: {
          config_id: null,
          provider_id: "mimo-api",
          display_name: null,
          model: "mimo-v2.5",
          base_url: null,
          api_key: "super-secret",
          is_default: true,
        },
      },
      main,
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const { config_id } = saved.value as { config_id: string };
    expect(store.getProviderConfig(config_id)?.validation.last_validated_status).toBe(
      "unspecified",
    );

    // The handler reads the runtime's global fetch; stub it with a 200 reply-ok.
    vi.stubGlobal("fetch", async () => ({
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
    }));
    try {
      const res = await router.dispatch(
        "test_provider_config",
        { request: { config_id, sample: null } },
        main,
      );
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toMatchObject({ config_id, status: "ok" });
    } finally {
      vi.unstubAllGlobals();
    }

    // The result is persisted, not just returned: readiness + the 模型 page
    // badges read this stamp from the store after a restart.
    const validation = store.getProviderConfig(config_id)?.validation;
    expect(validation?.last_validated_status).toBe("ok");
    expect(validation?.last_validated_at).not.toBeNull();
    expect(validation?.last_validated_note).toBeNull();
    expect(typeof validation?.last_validated_latency_ms).toBe("number");
  });

  it("test_provider_config stamps the persisted validation with err on a 401 response", async () => {
    const { router, store } = makeRouter();
    const saved = await router.dispatch(
      "save_provider_config",
      {
        request: {
          config_id: null,
          provider_id: "mimo-api",
          display_name: null,
          model: "mimo-v2.5",
          base_url: null,
          api_key: "bad-key",
          is_default: true,
        },
      },
      main,
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const { config_id } = saved.value as { config_id: string };

    // Stub fetch to return a 401 so validation fails.
    vi.stubGlobal("fetch", async () => ({
      status: 401,
      text: async () => JSON.stringify({ error: { message: "Unauthorized" } }),
    }));
    try {
      const res = await router.dispatch(
        "test_provider_config",
        { request: { config_id, sample: null } },
        main,
      );
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toMatchObject({ config_id, status: "err" });
    } finally {
      vi.unstubAllGlobals();
    }

    // The err result is persisted: the store stamp reflects the failure.
    const validation = store.getProviderConfig(config_id)?.validation;
    expect(validation?.last_validated_status).toBe("err");
    expect(validation?.last_validated_at).not.toBeNull();
    expect(validation?.last_validated_note).not.toBeNull();
    expect(typeof validation?.last_validated_latency_ms).toBe("number");
  });

  it("delete_provider_config removes the config row and cascades its secret", async () => {
    const { router, store } = makeRouter();
    const saved = await router.dispatch(
      "save_provider_config",
      {
        request: {
          config_id: null,
          provider_id: "mimo-api",
          display_name: null,
          model: "mimo-v2.5",
          base_url: null,
          api_key: "super-secret",
          is_default: true,
        },
      },
      main,
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const { config_id } = saved.value as { config_id: string };
    expect(store.getProviderConfig(config_id)).not.toBeNull();
    expect(store.getProviderSecrets(config_id)?.api_key).toBe("super-secret");

    const res = await router.dispatch("delete_provider_config", { config_id }, main);
    expect(res.ok).toBe(true);

    // The row is gone and the ON DELETE CASCADE dropped the encrypted secret too.
    expect(store.getProviderConfig(config_id)).toBeNull();
    expect(store.getProviderSecrets(config_id)).toBeNull();
  });

  it("forbids the capsule window from deleting a provider config", async () => {
    const { router } = makeRouter();
    const res = await router.dispatch(
      "delete_provider_config",
      { config_id: "config.x" },
      { window: "capsule" },
    );
    expect(res).toEqual({ ok: false, error: "forbidden" });
  });

  it("save_mode enforces the hotkey conflict policy and notifies onModesChanged", async () => {
    let modesChanged = 0;
    const { router, store } = makeRouter(undefined, {
      onModesChanged: () => {
        modesChanged += 1;
      },
    });
    const [defaultMode, translateMode] = store.listModes();

    // Seed a chord on "translate", then save "default" with a conflicting
    // (same-modifier) chord under the "steal" policy: translate loses its
    // hotkey and default gains it.
    store.saveMode({ ...translateMode!, hotkey: { chord: "RightCtrl" } });
    const stolen = await router.dispatch(
      "save_mode",
      { request: { mode: { ...defaultMode!, hotkey: { chord: "RightCtrl" } }, hotkey_conflict_policy: "steal" } },
      main,
    );
    expect(stolen.ok).toBe(true);
    expect(modesChanged).toBe(1);
    expect(store.getMode(translateMode!.id)?.hotkey).toBeNull();
    expect(store.getMode(defaultMode!.id)?.hotkey).toEqual({ chord: "RightCtrl" });

    // "reject" fails the save and leaves both modes untouched.
    store.saveMode({ ...translateMode!, hotkey: { chord: "Fn" } });
    const rejected = await router.dispatch(
      "save_mode",
      { request: { mode: { ...defaultMode!, hotkey: { chord: "Fn+RightShift" } }, hotkey_conflict_policy: "reject" } },
      main,
    );
    expect(rejected.ok).toBe(false);
    expect(store.getMode(translateMode!.id)?.hotkey).toEqual({ chord: "Fn" });
    expect(store.getMode(defaultMode!.id)?.hotkey).toEqual({ chord: "RightCtrl" });
  });

  it("save_mode preserves the existing display_order", async () => {
    const { router, store } = makeRouter();
    const [defaultMode] = store.listModes();
    const res = await router.dispatch(
      "save_mode",
      {
        request: {
          mode: { ...defaultMode!, name: "Renamed", display_order: 99 },
          hotkey_conflict_policy: "reject",
        },
      },
      main,
    );
    expect(res.ok).toBe(true);
    expect(store.getMode("default")?.name).toBe("Renamed");
    expect(store.getMode("default")?.display_order).toBe(defaultMode!.display_order);
  });

  it("create_mode inserts a custom mode with built_in:false and next display_order", async () => {
    const { router, store } = makeRouter();
    const res = await router.dispatch("create_mode", { request: { name: "Email" } }, main);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const mode = res.value as {
        id: string;
        name: string;
        built_in: boolean;
        display_order: number;
        prompt_body: string;
        hotkey: unknown;
      };
      expect(mode.id.startsWith("mode.")).toBe(true);
      expect(mode.name).toBe("Email");
      expect(mode.built_in).toBe(false);
      expect(mode.prompt_body).toBe("");
      expect(mode.hotkey).toBeNull();
      expect(mode.display_order).toBe(2);
      expect(store.getMode(mode.id)).not.toBeNull();
    }
  });

  it("delete_mode removes a custom mode but no-ops a built-in", async () => {
    const { router, store } = makeRouter();
    const created = await router.dispatch("create_mode", { request: { name: "Temp" } }, main);
    const id = created.ok ? (created.value as { id: string }).id : "";
    const del = await router.dispatch("delete_mode", { mode_id: id }, main);
    expect(del.ok).toBe(true);
    expect(store.getMode(id)).toBeNull();
    await router.dispatch("delete_mode", { mode_id: "default" }, main);
    expect(store.getMode("default")).not.toBeNull();
  });

  it("delete_mode repoints current_mode_id to default when deleting the active mode", async () => {
    const { router, store } = makeRouter();
    const created = await router.dispatch("create_mode", { request: { name: "Active" } }, main);
    const id = created.ok ? (created.value as { id: string }).id : "";
    store.saveSettings({ ...store.getSettings(), current_mode_id: id });
    await router.dispatch("delete_mode", { mode_id: id }, main);
    expect(store.getSettings().current_mode_id).toBe("default");
  });

  it("delete_mode does not repoint when asked to delete an active built-in", async () => {
    const { router, store } = makeRouter();
    store.saveSettings({ ...store.getSettings(), current_mode_id: "translate" });
    const res = await router.dispatch("delete_mode", { mode_id: "translate" }, main);
    expect(res.ok).toBe(true);
    expect(store.getMode("translate")).not.toBeNull();
    expect(store.getSettings().current_mode_id).toBe("translate");
  });

  it("save_mode rejects an unknown mode id (update-only)", async () => {
    const { router } = makeRouter();
    const res = await router.dispatch(
      "save_mode",
      {
        request: {
          mode: {
            id: "mode.ghost",
            name: "Ghost",
            prompt_body: "",
            hotkey: null,
            display_order: 9,
            built_in: false,
            created_at: 0,
            updated_at: 0,
          },
          hotkey_conflict_policy: "reject",
        },
      },
      main,
    );
    expect(res.ok).toBe(false);
  });

  it("forbids the capsule window from calling a main-only command", async () => {
    const { router } = makeRouter();
    const res = await router.dispatch("get_app_settings", undefined, { window: "capsule" });
    expect(res).toEqual({ ok: false, error: "forbidden" });
  });

  it("returns the runtime package version through health", async () => {
    const { router } = makeRouter(undefined, { version: "0.2.0" });
    const res = await router.dispatch("health", undefined, main);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toMatchObject({ version: "0.2.0" });
  });

  it("exposes the core provider catalog through get_app_model", async () => {
    const { router } = makeRouter();
    const res = await router.dispatch("get_app_model", undefined, main);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const providers = (res.value as { providerCatalog: { provider_id: string; models: string[] }[] })
      .providerCatalog;
    expect(providers.map((p) => p.provider_id)).toContain("mimo-api");
    expect(providers.find((p) => p.provider_id === "dashscope")?.models).toContain(
      "qwen3.5-omni-flash",
    );
  });

  it("delegates microphone enumeration to the runtime device seam", async () => {
    const { router } = makeRouter(undefined, {
      listMicrophoneDevices: () => [
        { id: "default", label: "System default", is_default: true },
        { id: "mic-1", label: "Studio Mic", is_default: false },
      ],
    });
    const res = await router.dispatch("list_microphone_devices", undefined, main);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toEqual([
        { id: "default", label: "System default", is_default: true },
        { id: "mic-1", label: "Studio Mic", is_default: false },
      ]);
    }
  });

});
