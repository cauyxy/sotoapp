import { describe, expect, it } from "vitest";

import {
  SETTINGS_COMMANDS,
  applyLanguageSettingsDraft,
  applyMicrophoneSettingsDraft,
  applyPrivacySettingsDraft,
  createLanguageSettingsDraft,
  createMicrophoneSettingsDraft,
  createPrivacySettingsDraft,
  mergePermissionStatus,
  permissionStatusRows,
  permissionStatusesAreSatisfied,
  permissionSettingsRequest,
  PERMISSION_UPDATED_EVENT,
  type AppSettings,
  type PermissionStatusRecord
} from "./settings";

describe("settings IPC model", () => {
  it("matches backend settings command names", () => {
    expect(SETTINGS_COMMANDS).toEqual({
      getAppSettings: "get_app_settings",
      listMicrophoneDevices: "list_microphone_devices",
      listPermissionStatuses: "list_permission_statuses",
      openPermissionSettings: "open_permission_settings",
      requestPermissionAuthorization: "request_permission_authorization",
      saveAppSettings: "save_app_settings"
    });
  });

  it("builds stable permission settings requests", () => {
    expect(permissionSettingsRequest("microphone")).toEqual({ pane: "microphone" });
    expect(permissionSettingsRequest("accessibility")).toEqual({ pane: "accessibility" });
  });

  it("exposes the permission updated event name", () => {
    expect(PERMISSION_UPDATED_EVENT).toBe("permission://updated");
  });

  it("merges a refreshed permission status by pane", () => {
    const microphone = permissionStatus("microphone", "needs_review");
    const accessibility = permissionStatus("accessibility", "needs_review");
    const grantedAccessibility = permissionStatus("accessibility", "granted");

    expect(mergePermissionStatus([], microphone)).toEqual([microphone]);
    expect(mergePermissionStatus([microphone, accessibility], grantedAccessibility)).toEqual([
      microphone,
      grantedAccessibility
    ]);
  });

  it("builds permission rows with stable copy and tones", () => {
    const records: PermissionStatusRecord[] = [
      {
        pane: "microphone",
        kind: "granted",
        label: "Granted",
        detail: "Microphone access is allowed."
      },
      {
        pane: "accessibility",
        kind: "needs_review",
        label: "Needs review",
        detail: "Accessibility access is not allowed yet."
      }
    ];

    expect(permissionStatusRows(records)).toEqual([
      {
        pane: "microphone",
        kind: "granted",
        title: "Microphone",
        description: "Required for recording audio while the hotkey is active.",
        statusLabel: "Granted",
        detail: "Microphone access is allowed.",
        tone: "ok",
        actionLabel: "Request microphone access",
        isSatisfied: true
      },
      {
        pane: "accessibility",
        kind: "needs_review",
        title: "Accessibility",
        description: "Required for inserting final text into the current app and enabling global shortcuts on macOS.",
        statusLabel: "Needs review",
        detail: "Accessibility access is not allowed yet.",
        tone: "warn",
        actionLabel: "Open accessibility settings",
        isSatisfied: false
      }
    ]);
  });

  it("uses a settings action when microphone access has already been denied", () => {
    expect(
      permissionStatusRows([
        {
          pane: "microphone",
          kind: "not_determined",
          label: "Not requested",
          detail: "Soto needs your permission to capture audio."
        }
      ] satisfies PermissionStatusRecord[])[0].actionLabel
    ).toBe("Request microphone access");

    expect(
      permissionStatusRows([
        {
          pane: "microphone",
          kind: "denied",
          label: "Denied",
          detail: "Microphone access was denied. Enable it in System Settings."
        }
      ] satisfies PermissionStatusRecord[])[0].actionLabel
    ).toBe("Open microphone settings");
  });

  it("treats granted and not-required permissions as onboarding-satisfied", () => {
    expect(
      permissionStatusesAreSatisfied([
        {
          pane: "microphone",
          kind: "granted",
          label: "Granted",
          detail: "Microphone access is allowed."
        },
        {
          pane: "accessibility",
          kind: "not_required",
          label: "Not required",
          detail: "Windows does not require a separate Accessibility approval for this path."
        }
      ] satisfies PermissionStatusRecord[])
    ).toBe(true);
  });

  it("builds microphone drafts and preserves unrelated settings when applying them", () => {
    const settings = appSettings();
    const draft = createMicrophoneSettingsDraft(settings);

    expect(draft).toEqual({
      microphone_device_id: null,
      input_level: 100
    });
    expect(
      applyMicrophoneSettingsDraft(settings, {
        microphone_device_id: "Built-in Microphone",
        input_level: 72
      })
    ).toEqual({
      ...settings,
      microphone_device_id: "Built-in Microphone",
      input_level: 72
    });
  });

  it("builds privacy drafts and preserves unrelated settings when applying them", () => {
    const settings = appSettings();
    const draft = createPrivacySettingsDraft(settings);

    expect(draft).toEqual({
      history_enabled: true,
      store_target_metadata: true
    });
    expect(
      applyPrivacySettingsDraft(settings, {
        history_enabled: false,
        store_target_metadata: false
      })
    ).toEqual({
      ...settings,
      history_enabled: false,
      store_target_metadata: false
    });
  });

  it("builds language drafts and preserves unrelated settings when applying them", () => {
    const settings = appSettings();
    const draft = createLanguageSettingsDraft(settings);

    expect(draft).toEqual({
      locale: "en-US",
      transcription_language_hint: "auto"
    });
    expect(
      applyLanguageSettingsDraft(settings, {
        locale: "zh-CN",
        transcription_language_hint: "mixed"
      })
    ).toEqual({
      ...settings,
      locale: "zh-CN",
      transcription_language_hint: "mixed"
    });
  });
});

function appSettings(): AppSettings {
  return {
    locale: "en-US",
    active_provider_config_id: "config.omni",
    transcription_language_hint: "auto",
    microphone_device_id: null,
    input_level: 100,
    history_enabled: true,
    store_target_metadata: true,
    theme: "system",
    use_proxy: true
  };
}

function permissionStatus(
  pane: PermissionStatusRecord["pane"],
  kind: PermissionStatusRecord["kind"]
): PermissionStatusRecord {
  return {
    pane,
    kind,
    label: kind,
    detail: `${pane} ${kind}`
  };
}
