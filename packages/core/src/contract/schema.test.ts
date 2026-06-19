import { describe, expect, it } from "vitest";
import * as schema from "./schema.js";
import {
  ChordSchema,
  ModeSchema,
  SessionStatusSchema,
  InjectionOutcomeSchema,
  HistoryRecordSchema,
  PostInsertObservationSchema,
  ProviderConfigSchema,
  ValidationStatusSchema,
  AppSettingsSchema,
  DictionaryEntrySchema,
  AxContextSchema,
  PERMISSION_UPDATED_EVENT,
  VOICE_RUNTIME_EVENT,
  HOTKEY_RUNTIME_ACTION_EVENT,
  ALERT_SHOW_EVENT,
  CAPTURE_CONTROL_EVENT,
  CaptureControlEventSchema,
} from "./schema.js";
import { PermissionUpdatedEventSchema } from "./events.js";

const validMode = {
  id: "polish",
  name: "Polish",
  prompt_body: "Tidy up the text.",
  hotkey: { chord: "RightMeta" },
  display_order: 0,
  built_in: true,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
};

describe("ModeSchema", () => {
  it("parses a valid mode and coerces timestamps to bigint", () => {
    const parsed = ModeSchema.parse(validMode);
    expect(parsed.id).toBe("polish");
    expect(parsed.hotkey).toEqual({ chord: "RightMeta" });
    expect(parsed.created_at).toBe(1_700_000_000_000n);
  });

  it("rejects a mode whose hotkey chord is not a valid chord", () => {
    expect(() =>
      ModeSchema.parse({ ...validMode, hotkey: { chord: "Bogus" } }),
    ).toThrow();
  });

  it("rejects a mode missing a required field", () => {
    const { name: _omitted, ...withoutName } = validMode;
    expect(() => ModeSchema.parse(withoutName)).toThrow();
  });

  it("accepts a null hotkey", () => {
    expect(ModeSchema.parse({ ...validMode, hotkey: null }).hotkey).toBeNull();
  });
});

describe("selection transform contract surface", () => {
  it("does not export selection action schemas or event channels", () => {
    const typeBase = `Selection${"Action"}`;
    expect(`${typeBase}Schema` in schema).toBe(false);
    expect(`${typeBase}SettingsSchema` in schema).toBe(false);
    expect(`${typeBase}StatusSchema` in schema).toBe(false);
    expect(["SELECTION", "ACTION", "STATUS", "EVENT"].join("_") in schema).toBe(false);
  });
});

describe("SessionStatusSchema", () => {
  it("accepts the known statuses", () => {
    expect(SessionStatusSchema.parse("completed")).toBe("completed");
  });
  it("rejects an unknown status", () => {
    expect(() => SessionStatusSchema.parse("done")).toThrow();
  });
});

describe("InjectionOutcomeSchema", () => {
  const legacyCopiedFallbackKind = `copied${"_fallback"}`;
  const legacyInsertedKind = `in${"serted"}`;

  it("parses a simple kind", () => {
    expect(InjectionOutcomeSchema.parse({ kind: "paste_sent" })).toEqual({ kind: "paste_sent" });
  });
  it("parses insertion metadata without foreground verification state", () => {
    expect(
      InjectionOutcomeSchema.parse({ kind: "paste_sent", method: "paste", verified: true }),
    ).toEqual({ kind: "paste_sent", method: "paste" });
  });
  it("parses manual fallback reasons", () => {
    expect(
      InjectionOutcomeSchema.parse({
        kind: "manual_copy_required",
        reason: "clipboard_unrestorable",
      }),
    ).toEqual({ kind: "manual_copy_required", reason: "clipboard_unrestorable" });
  });
  it("rejects legacy success kinds", () => {
    expect(() => InjectionOutcomeSchema.parse({ kind: legacyCopiedFallbackKind })).toThrow();
    expect(() => InjectionOutcomeSchema.parse({ kind: legacyInsertedKind })).toThrow();
  });
  it("rejects removed probe-tier fallback reasons", () => {
    for (const reason of ["un" + "trusted", "elev" + "ated", "no" + "_focus"]) {
      expect(() =>
        InjectionOutcomeSchema.parse({ kind: "manual_copy_required", reason }),
      ).toThrow();
    }
  });
  it("parses the focus_lost variant with its nested detail", () => {
    const outcome = {
      kind: "focus_lost",
      detail: { saved_app_name: "Notes", actual_app_name: "Terminal" },
    };
    expect(InjectionOutcomeSchema.parse(outcome)).toEqual(outcome);
  });
  it("rejects focus_lost without detail", () => {
    expect(() => InjectionOutcomeSchema.parse({ kind: "focus_lost" })).toThrow();
  });
});

describe("HistoryRecordSchema", () => {
  it("parses a record with null optional fields and bigint durations", () => {
    const record = HistoryRecordSchema.parse({
      id: "h1",
      created_at: 1_700_000_000_000,
      raw_text: "hi",
      processed_text: null,
      injected_text: null,
      edited_text: null,
      edited_text_status: "pending",
      edited_text_status_reason: null,
      mode_id: null,
      status: "completed",
      injection_outcome: { kind: "paste_sent" },
      speaking_duration_ms: 1234,
      char_count: 2,
      target_app: null,
      target_app_name: null,
      target_window_title: null,
      target_control_type: null,
      ax_context_at_start: null,
      ax_context_at_end: null,
      audio_path: null,
      provider_id: null,
      model_id: null,
      detected_language: null,
      mic_device_id: null,
    });
    expect(record.speaking_duration_ms).toBe(1234n);
    expect(record.injection_outcome).toEqual({ kind: "paste_sent" });
  });

  it("parses an intentionally unobserved record with a reason", () => {
    const record = HistoryRecordSchema.parse({
      id: "h1",
      created_at: 1_700_000_000_000,
      raw_text: "hi",
      processed_text: null,
      injected_text: null,
      edited_text: null,
      edited_text_status: "not_observed",
      edited_text_status_reason: "observer_not_attached",
      mode_id: null,
      status: "completed",
      injection_outcome: { kind: "paste_sent" },
      speaking_duration_ms: 1234,
      char_count: 2,
      target_app: null,
      target_app_name: null,
      target_window_title: null,
      target_control_type: null,
      ax_context_at_start: null,
      ax_context_at_end: null,
      audio_path: null,
      provider_id: null,
      model_id: null,
      detected_language: null,
      mic_device_id: null,
    });

    expect(record.edited_text_status).toBe("not_observed");
    expect(record.edited_text_status_reason).toBe("observer_not_attached");
  });
});

describe("PostInsertObservationSchema", () => {
  it("parses terminal observation results", () => {
    const observation = PostInsertObservationSchema.parse({
      edited_text: "hello!",
      edited_text_status: "captured",
      edited_text_status_reason: null,
      ax_context_at_end: null,
    });

    expect(observation.edited_text_status).toBe("captured");
  });

  it("rejects pending because it is not a completed observation", () => {
    expect(() =>
      PostInsertObservationSchema.parse({
        edited_text: null,
        edited_text_status: "pending",
        edited_text_status_reason: null,
        ax_context_at_end: null,
      }),
    ).toThrow();
  });

  it("parses unsupported observer terminal results", () => {
    const observation = PostInsertObservationSchema.parse({
      edited_text: null,
      edited_text_status: "unavailable",
      edited_text_status_reason: "observer_unsupported",
      ax_context_at_end: null,
    });

    expect(observation.edited_text_status_reason).toBe("observer_unsupported");
  });
});

describe("ProviderConfigSchema", () => {
  it("parses a config with nested validation", () => {
    const parsed = ProviderConfigSchema.parse({
      config_id: "c1",
      provider_id: "mimo-api",
      display_name: null,
      model: "mimo-v2.5",
      base_url: null,
      is_default: true,
      validation: {
        last_validated_at: null,
        last_validated_latency_ms: null,
        last_validated_status: "unspecified",
        last_validated_note: null,
        last_validated_sample: null,
        last_validated_sample_result: null,
      },
      created_at: 1,
      updated_at: 1,
    });
    expect(parsed.validation.last_validated_status).toBe("unspecified");
  });
});

describe("DictionaryEntrySchema", () => {
  it("parses an entry and rejects an unknown source", () => {
    const entry = {
      id: "d1",
      term: "Soto",
      source: "user_added",
      hit_count: 3,
      last_used_at: null,
      created_at: 1,
    };
    expect(DictionaryEntrySchema.parse(entry).source).toBe("user_added");
    expect(() => DictionaryEntrySchema.parse({ ...entry, source: "imported" })).toThrow();
  });
});

describe("AxContextSchema", () => {
  it("parses an AX context", () => {
    const ctx = {
      full_text: "hello",
      selection_start: 0,
      selection_end: 5,
      before: "",
      after: "",
      ax_role: null,
      app_bundle_id: null,
    };
    expect(AxContextSchema.parse(ctx)).toEqual({
      ...ctx,
      app_name: null,
      window_title: null,
      web_url: null,
      web_domain: null,
    });
  });

  it("parses the enhanced context signals", () => {
    const ctx = {
      full_text: "hello",
      selection_start: 0,
      selection_end: 5,
      before: "",
      after: "",
      ax_role: "AXTextArea",
      app_bundle_id: "com.apple.Notes",
      app_name: "Notes",
      window_title: "Quick update - Notes",
      web_url: "https://mail.google.com/mail/u/0/#inbox",
      web_domain: "mail.google.com",
    };
    expect(AxContextSchema.parse(ctx)).toEqual(ctx);
  });
});

describe("IPC event channels", () => {
  it("exposes the shared event channel names", () => {
    expect(VOICE_RUNTIME_EVENT).toBe("soto://voice-runtime");
    expect(HOTKEY_RUNTIME_ACTION_EVENT).toBe("soto://hotkey-runtime-action");
    expect(PERMISSION_UPDATED_EVENT).toBe("permission://updated");
    expect(ALERT_SHOW_EVENT).toBe("alert:show");
    expect(CAPTURE_CONTROL_EVENT).toBe("soto://capture-control");
  });
});

describe("PermissionUpdatedEventSchema", () => {
  it("parses the permission update snapshot without screen recording", () => {
    expect(
      PermissionUpdatedEventSchema.parse({
        accessibility: true,
        microphone: true,
        hotkey_installed: true,
      }),
    ).toEqual({
      accessibility: true,
      microphone: true,
      hotkey_installed: true,
    });
  });
});

describe("ModeSchema public shape", () => {
  const base = {
    id: "m1",
    name: "Mode 1",
    prompt_body: "",
    hotkey: null,
    display_order: 0,
    built_in: false,
    created_at: 1,
    updated_at: 1,
  };

  it("does not expose stale is_command input on parsed modes", () => {
    const mode = ModeSchema.parse(base);
    expect("is_command" in mode).toBe(false);
    const stale = ModeSchema.parse({ ...base, is_command: true });
    expect("is_command" in stale).toBe(false);
  });
});

describe("zero-consumer schema exports", () => {
  it("keeps ChordSchema and ValidationStatusSchema parseable", () => {
    expect(ChordSchema.safeParse("RightAlt").success).toBe(true);
    expect(ValidationStatusSchema.safeParse("ok").success).toBe(true);
  });
});

describe("engine-mode fields", () => {
  it("defaults ProviderConfig.capability to omni and AppSettings engine fields", () => {
    const config = ProviderConfigSchema.parse({
      config_id: "c", provider_id: "mimo-api", display_name: null, model: "m",
      base_url: null, is_default: true,
      validation: {
        last_validated_at: null, last_validated_latency_ms: null,
        last_validated_status: "unspecified", last_validated_note: null,
        last_validated_sample: null, last_validated_sample_result: null,
      },
      created_at: 1, updated_at: 1,
    });
    expect(config.capability).toBe("omni");

    const settings = AppSettingsSchema.parse({
      locale: "zh", active_provider_config_id: null, transcription_language_hint: "",
      microphone_device_id: null, input_level: 0, history_enabled: true,
      theme: "system", use_proxy: false,
      history_retention_days: 0, current_mode_id: null, audio_retention_enabled: false,
    });
    expect(settings.engine_mode).toBe("omni");
    expect(settings.active_asr_config_id).toBeNull();
    expect(settings.active_llm_config_id).toBeNull();
    expect(settings.hide_app_icon).toBe(false);
    expect(settings.include_window_context_in_requests).toBe(true);
    expect(settings.launch_at_login).toBe(true);
  });

  it('defaults AppSettings base_text_scale to "default"', () => {
    const settings = AppSettingsSchema.parse({
      locale: "zh", active_provider_config_id: null, transcription_language_hint: "",
      microphone_device_id: null, input_level: 0, history_enabled: true,
      theme: "system", use_proxy: false,
      history_retention_days: 0, current_mode_id: null, audio_retention_enabled: false,
    });
    expect(settings.base_text_scale).toBe("default");
  });

  it("defaults HistoryRecord llm columns to null", () => {
    // Reuse the existing valid-record literal from the HistoryRecordSchema block
    // (above) WITHOUT the llm fields; parse must fill them with nulls.
    const record = HistoryRecordSchema.parse({
      id: "h1",
      created_at: 1_700_000_000_000,
      raw_text: "hi",
      processed_text: null,
      injected_text: null,
      edited_text: null,
      edited_text_status: "pending",
      mode_id: null,
      status: "completed",
      injection_outcome: { kind: "paste_sent" },
      speaking_duration_ms: 1234,
      char_count: 2,
      target_app: null,
      target_app_name: null,
      target_window_title: null,
      target_control_type: null,
      ax_context_at_start: null,
      ax_context_at_end: null,
      audio_path: null,
      provider_id: null,
      model_id: null,
      detected_language: null,
      mic_device_id: null,
    });
    expect(record.llm_provider_id).toBeNull();
    expect(record.llm_model_id).toBeNull();
  });
});

describe("CaptureControlEventSchema", () => {
  it("parses begin with mode/device + finish/cancel carrying a session id", () => {
    expect(
      CaptureControlEventSchema.parse({
        kind: "begin",
        session_id: "s1",
        mode_id: "dictate",
        device_id: null,
      }),
    ).toMatchObject({ kind: "begin", device_id: null });

    // finish is the hotkey-toggle stop: same shape as cancel (session_id only).
    expect(
      CaptureControlEventSchema.parse({ kind: "finish", session_id: "s1" }),
    ).toEqual({ kind: "finish", session_id: "s1" });

    expect(
      CaptureControlEventSchema.parse({ kind: "cancel", session_id: "s1" }),
    ).toEqual({ kind: "cancel", session_id: "s1" });
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      CaptureControlEventSchema.parse({ kind: "stop", session_id: "s1" }),
    ).toThrow();
  });
});
