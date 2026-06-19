import { describe, expect, it } from "vitest";
import type {
  DictionaryEntry,
  HistoryRecord,
  Mode,
  ProviderConfig,
} from "../../contract/schema.js";
import {
  dictionaryEntryRowToDto,
  dictionaryEntryToRow,
  historyRecordRowToDto,
  historyRecordToRow,
  modeRowToDto,
  modeToRow,
  providerConfigRowToDto,
  providerConfigToRow,
} from "./codec.js";

// --- Mode -----------------------------------------------------------------

const modeWithHotkey: Mode = {
  id: "mode-1",
  name: "Default",
  prompt_body: "transcribe",
  hotkey: { chord: "LeftShift+LeftCtrl" },
  display_order: 0,
  built_in: true,
  created_at: 1_700_000_000_000n,
  updated_at: 1_700_000_001_000n,
};

const modeNullHotkey: Mode = {
  ...modeWithHotkey,
  id: "mode-2",
  hotkey: null,
  built_in: false,
};

describe("mode codec", () => {
  it("round-trips a mode with a hotkey", () => {
    expect(modeRowToDto(modeToRow(modeWithHotkey))).toEqual(modeWithHotkey);
  });

  it("round-trips a mode with a null hotkey", () => {
    expect(modeRowToDto(modeToRow(modeNullHotkey))).toEqual(modeNullHotkey);
  });

  it("stores a null hotkey as SQL NULL, not the string 'null'", () => {
    const row = modeToRow(modeNullHotkey);
    expect(row.hotkey_json).toBeNull();
    expect(row.hotkey_json).not.toBe("null");
  });

  it("serializes a present hotkey to a JSON string", () => {
    const row = modeToRow(modeWithHotkey);
    expect(typeof row.hotkey_json).toBe("string");
    expect(JSON.parse(row.hotkey_json as string)).toEqual({
      chord: "LeftShift+LeftCtrl",
    });
  });

  it("maps booleans to 0/1 and bigints to numbers", () => {
    const row = modeToRow(modeWithHotkey);
    expect(row.built_in).toBe(1);
    expect(row.created_at).toBe(1_700_000_000_000);
    expect(typeof row.created_at).toBe("number");
    expect(modeToRow(modeNullHotkey).built_in).toBe(0);
  });

  it("throws when a row fails schema validation", () => {
    const bad = { ...modeToRow(modeWithHotkey), display_order: "nope" };
    expect(() => modeRowToDto(bad as never)).toThrow();
  });
});

// --- DictionaryEntry ------------------------------------------------------

const dictUser: DictionaryEntry = {
  id: "dict-1",
  term: "Soto",
  source: "user_added",
  hit_count: 3,
  last_used_at: 1_700_000_500_000n,
  created_at: 1_700_000_000_000n,
};

const dictAutoNullUsed: DictionaryEntry = {
  ...dictUser,
  id: "dict-2",
  source: "auto_learned",
  last_used_at: null,
};

describe("dictionary entry codec", () => {
  it("round-trips a user-added entry", () => {
    expect(dictionaryEntryRowToDto(dictionaryEntryToRow(dictUser))).toEqual(
      dictUser,
    );
  });

  it("round-trips an auto-learned entry with null last_used_at", () => {
    expect(
      dictionaryEntryRowToDto(dictionaryEntryToRow(dictAutoNullUsed)),
    ).toEqual(dictAutoNullUsed);
  });

  it("stores null last_used_at as SQL NULL", () => {
    expect(dictionaryEntryToRow(dictAutoNullUsed).last_used_at).toBeNull();
  });

  it("round-trips every dictionary source enum value", () => {
    for (const source of ["user_added", "auto_learned"] as const) {
      const dto: DictionaryEntry = { ...dictUser, source };
      expect(dictionaryEntryRowToDto(dictionaryEntryToRow(dto))).toEqual(dto);
    }
  });
});

// --- HistoryRecord --------------------------------------------------------

const axContext = {
  full_text: "hello world",
  selection_start: 0,
  selection_end: 5,
  before: "",
  after: " world",
  ax_role: "AXTextArea",
  app_bundle_id: "com.apple.Notes",
  app_name: "Notes",
  window_title: "Untitled",
  web_url: "https://mail.google.com/mail/u/0/#inbox",
  web_domain: "mail.google.com",
};

const baseHistory: HistoryRecord = {
  id: "hist-1",
  created_at: 1_700_000_000_000n,
  raw_text: "hello",
  processed_text: "Hello.",
  injected_text: "Hello.",
  edited_text: null,
  edited_text_status: "pending",
  edited_text_status_reason: null,
  mode_id: "mode-1",
  status: "completed",
  injection_outcome: { kind: "paste_sent" },
  speaking_duration_ms: 2500n,
  char_count: 5,
  target_app: "com.apple.Notes",
  target_app_name: "Notes",
  target_window_title: "Untitled",
  target_control_type: "AXTextArea",
  ax_context_at_start: axContext,
  ax_context_at_end: { ...axContext, ax_role: null, app_bundle_id: null },
  audio_path: "/tmp/a.wav",
  provider_id: "openai",
  model_id: "whisper-1",
  llm_provider_id: null,
  llm_model_id: null,
  detected_language: "en",
  mic_device_id: "mic-0",
};

const historyFocusLostNullAx: HistoryRecord = {
  ...baseHistory,
  id: "hist-2",
  processed_text: null,
  injected_text: null,
  status: "failed",
  injection_outcome: {
    kind: "focus_lost",
    detail: { saved_app_name: "Notes", actual_app_name: "Terminal" },
  },
  ax_context_at_start: null,
  ax_context_at_end: null,
};

describe("history record codec", () => {
  it("round-trips a completed record with full ax context", () => {
    expect(historyRecordRowToDto(historyRecordToRow(baseHistory))).toEqual(
      baseHistory,
    );
  });

  it("round-trips a focus_lost record with null ax context", () => {
    expect(
      historyRecordRowToDto(historyRecordToRow(historyFocusLostNullAx)),
    ).toEqual(historyFocusLostNullAx);
  });

  it("stores null ax context columns as SQL NULL, not 'null'", () => {
    const row = historyRecordToRow(historyFocusLostNullAx);
    expect(row.ax_context_at_start_json).toBeNull();
    expect(row.ax_context_at_end_json).toBeNull();
    expect(row.ax_context_at_start_json).not.toBe("null");
  });

  it("serializes injection_outcome to a JSON string column", () => {
    const row = historyRecordToRow(historyFocusLostNullAx);
    expect(JSON.parse(row.injection_outcome_json)).toEqual({
      kind: "focus_lost",
      detail: { saved_app_name: "Notes", actual_app_name: "Terminal" },
    });
  });

  it("maps bigint durations and timestamps to numbers", () => {
    const row = historyRecordToRow(baseHistory);
    expect(row.created_at).toBe(1_700_000_000_000);
    expect(row.speaking_duration_ms).toBe(2500);
  });

  it("round-trips every injection outcome variant", () => {
    const variants: HistoryRecord["injection_outcome"][] = [
      { kind: "paste_sent" },
      { kind: "manual_copy_required", reason: "clipboard_unrestorable" },
      { kind: "no_op" },
      { kind: "failed", detail: "boom" },
      {
        kind: "focus_lost",
        detail: { saved_app_name: "A", actual_app_name: "B" },
      },
    ];
    for (const injection_outcome of variants) {
      const dto: HistoryRecord = { ...baseHistory, injection_outcome };
      expect(historyRecordRowToDto(historyRecordToRow(dto))).toEqual(dto);
    }
  });

  it("round-trips every session status and edited-text status enum value", () => {
    for (const status of ["completed", "empty", "failed", "cancelled"] as const) {
      const dto: HistoryRecord = { ...baseHistory, status };
      expect(historyRecordRowToDto(historyRecordToRow(dto))).toEqual(dto);
    }
    for (const edited_text_status of [
      "pending",
      "captured",
      "failed",
      "unavailable",
      "not_observed",
    ] as const) {
      const dto: HistoryRecord = { ...baseHistory, edited_text_status };
      expect(historyRecordRowToDto(historyRecordToRow(dto))).toEqual(dto);
    }
  });

  it("round-trips the edited-text status reason", () => {
    const dto: HistoryRecord = {
      ...baseHistory,
      edited_text_status: "not_observed",
      edited_text_status_reason: "observer_not_attached",
    };
    const row = historyRecordToRow(dto);
    expect(row.edited_text_status_reason).toBe("observer_not_attached");
    expect(historyRecordRowToDto(row)).toEqual(dto);
  });

  it("throws when a row fails schema validation", () => {
    const bad = { ...historyRecordToRow(baseHistory), char_count: "nope" };
    expect(() => historyRecordRowToDto(bad as never)).toThrow();
  });

  it("round-trips the llm provider/model stamp", () => {
    const dto: HistoryRecord = {
      ...baseHistory,
      llm_provider_id: "openai-compat",
      llm_model_id: "gpt-4o-mini",
    };
    const row = historyRecordToRow(dto);
    expect(row.llm_provider_id).toBe("openai-compat");
    expect(row.llm_model_id).toBe("gpt-4o-mini");
    expect(historyRecordRowToDto(row)).toEqual(dto);
  });

  it("stores null llm stamp columns as SQL NULL", () => {
    const row = historyRecordToRow(baseHistory);
    expect(row.llm_provider_id).toBeNull();
    expect(row.llm_model_id).toBeNull();
  });
});

// --- ProviderConfig -------------------------------------------------------

const providerValidated: ProviderConfig = {
  config_id: "cfg-1",
  provider_id: "openai",
  display_name: "My OpenAI",
  model: "whisper-1",
  base_url: "https://api.openai.com/v1",
  is_default: true,
  capability: "omni",
  validation: {
    last_validated_at: 1_700_000_000_000n,
    last_validated_latency_ms: 120,
    last_validated_status: "ok",
    last_validated_note: "fine",
    last_validated_sample: "sample in",
    last_validated_sample_result: "sample out",
  },
  created_at: 1_700_000_000_000n,
  updated_at: 1_700_000_001_000n,
};

const providerUnvalidated: ProviderConfig = {
  ...providerValidated,
  config_id: "cfg-2",
  display_name: null,
  base_url: null,
  is_default: false,
  validation: {
    last_validated_at: null,
    last_validated_latency_ms: null,
    last_validated_status: "unspecified",
    last_validated_note: null,
    last_validated_sample: null,
    last_validated_sample_result: null,
  },
};

describe("provider config codec", () => {
  it("round-trips a validated provider config", () => {
    expect(providerConfigRowToDto(providerConfigToRow(providerValidated))).toEqual(
      providerValidated,
    );
  });

  it("round-trips an unvalidated provider config with null fields", () => {
    expect(
      providerConfigRowToDto(providerConfigToRow(providerUnvalidated)),
    ).toEqual(providerUnvalidated);
  });

  it("serializes validation to a JSON string column", () => {
    const row = providerConfigToRow(providerValidated);
    expect(typeof row.validation_json).toBe("string");
    expect(JSON.parse(row.validation_json).last_validated_status).toBe("ok");
  });

  it("maps is_default boolean to 0/1", () => {
    expect(providerConfigToRow(providerValidated).is_default).toBe(1);
    expect(providerConfigToRow(providerUnvalidated).is_default).toBe(0);
  });

  it("round-trips every validation status enum value", () => {
    for (const last_validated_status of [
      "unspecified",
      "ok",
      "warn",
      "err",
    ] as const) {
      const dto: ProviderConfig = {
        ...providerValidated,
        validation: { ...providerValidated.validation, last_validated_status },
      };
      expect(providerConfigRowToDto(providerConfigToRow(dto))).toEqual(dto);
    }
  });

  it("throws when a row fails schema validation", () => {
    const bad = { ...providerConfigToRow(providerValidated), is_default: 2 };
    // is_default 2 is not a valid boolean mapping; rowToDto should reject it.
    expect(() => providerConfigRowToDto(bad as never)).toThrow();
  });

  it("round-trips every capability enum value", () => {
    for (const capability of ["omni", "asr", "llm"] as const) {
      const dto: ProviderConfig = { ...providerValidated, capability };
      const row = providerConfigToRow(dto);
      expect(row.capability).toBe(capability);
      expect(providerConfigRowToDto(row)).toEqual(dto);
    }
  });
});
