import Database from "better-sqlite3";
import {
  DEFAULT_DICTATION_PROMPT,
  DEFAULT_DICTIONARY_TERMS,
  DEFAULT_TRANSLATE_PROMPT,
  type HistoryRecord,
  type Mode,
  type ProviderConfig,
} from "@soto/core";
import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate.js";
import { SqliteStore, identityCrypto } from "./store.js";

// --- fixtures -------------------------------------------------------------

function makeMode(overrides: Partial<Mode> = {}): Mode {
  return {
    id: "mode.custom",
    name: "Custom",
    prompt_body: "body",
    hotkey: null,
    display_order: 5,
    built_in: false,
    created_at: BigInt(1000),
    updated_at: BigInt(1000),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    config_id: "provider.a",
    provider_id: "openai",
    display_name: null,
    model: "gpt-4",
    base_url: null,
    is_default: false,
    capability: "omni",
    validation: {
      last_validated_at: null,
      last_validated_latency_ms: null,
      last_validated_status: "unspecified",
      last_validated_note: null,
      last_validated_sample: null,
      last_validated_sample_result: null,
    },
    created_at: BigInt(2000),
    updated_at: BigInt(2000),
    ...overrides,
  };
}

function makeHistory(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: "hist.x",
    created_at: BigInt(0),
    raw_text: "hello",
    processed_text: null,
    injected_text: null,
    edited_text: null,
    edited_text_status: "pending",
    edited_text_status_reason: null,
    mode_id: null,
    status: "completed",
    injection_outcome: { kind: "paste_sent" },
    speaking_duration_ms: BigInt(1234),
    char_count: 5,
    target_app: null,
    target_app_name: null,
    target_window_title: null,
    target_control_type: null,
    ax_context_at_start: null,
    ax_context_at_end: null,
    audio_path: null,
    provider_id: null,
    model_id: null,
    llm_provider_id: null,
    llm_model_id: null,
    detected_language: null,
    mic_device_id: null,
    ...overrides,
  };
}

function freshStore(): SqliteStore {
  const db = new Database(":memory:");
  applyMigrations(db);
  return new SqliteStore(db, identityCrypto);
}

function withPlatform(platform: typeof process.platform, fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    fn();
  } finally {
    if (original !== undefined) Object.defineProperty(process, "platform", original);
  }
}

// --- tests ----------------------------------------------------------------

describe("SqliteStore.seedIfNeeded", () => {
  it("seeds the two built-in voice modes once and is idempotent", () => {
    const store = freshStore();
    store.seedIfNeeded();
    let modes = store.listModes();
    expect(modes.map((m) => m.id)).toEqual(["default", "translate"]);
    expect(modes.every((m) => m.built_in)).toBe(true);
    expect(store.getMode("default")?.hotkey).toEqual({
      chord: process.platform === "win32" ? "RightCtrl" : "RightMeta",
    });
    expect(store.getMode("default")?.prompt_body).toBe(DEFAULT_DICTATION_PROMPT);
    expect(store.getMode("translate")?.prompt_body).toBe(DEFAULT_TRANSLATE_PROMPT);

    // Second call must not duplicate.
    store.seedIfNeeded();
    modes = store.listModes();
    expect(modes).toHaveLength(2);
  });

  it("uses RightCtrl as the Windows default hotkey on a fresh seed", () => {
    withPlatform("win32", () => {
      const store = freshStore();
      store.seedIfNeeded();

      expect(store.getMode("default")?.hotkey).toEqual({ chord: "RightCtrl" });
      expect(store.getMode("translate")?.hotkey).toBeNull();
    });
  });

  it("upgrades Windows profiles that already ran the previous default-hotkey repair", () => {
    withPlatform("win32", () => {
      const db = new Database(":memory:");
      applyMigrations(db);
      const now = 1_700_000_000_000;
      db.prepare(
        `INSERT INTO modes
           (id, name, prompt_body, hotkey_json, display_order, built_in, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("default", "Default", DEFAULT_DICTATION_PROMPT, '{"chord":"RightAlt"}', 0, 1, now, now);
      db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run(
        "windows_default_hotkey_v2",
        "1",
      );

      const store = new SqliteStore(db, identityCrypto);
      store.seedIfNeeded();

      expect(store.getMode("default")?.hotkey).toEqual({ chord: "RightCtrl" });
      expect(
        db.prepare("SELECT value FROM app_meta WHERE key = ?").get("windows_default_hotkey_v3"),
      ).toEqual({ value: "1" });
    });
  });

  it("fills empty built-in prompt bodies in an already-seeded database", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const now = 1_700_000_000_000;
    db.prepare(
      `INSERT INTO modes
         (id, name, prompt_body, hotkey_json, display_order, built_in, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("default", "Default", "", '{"chord":"LeftMeta"}', 0, 1, now, now);
    db.prepare(
      `INSERT INTO modes
         (id, name, prompt_body, hotkey_json, display_order, built_in, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("translate", "Translate", "", null, 1, 1, now, now);
    db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run(
      "initial_seed_complete",
      "1",
    );

    const store = new SqliteStore(db, identityCrypto);
    store.seedIfNeeded();

    expect(store.getMode("default")?.prompt_body).toBe(DEFAULT_DICTATION_PROMPT);
    expect(store.getMode("translate")?.prompt_body).toBe(DEFAULT_TRANSLATE_PROMPT);
    expect(
      db.prepare("SELECT value FROM app_meta WHERE key = ?").get("builtin_mode_prompts_v1_complete"),
    ).toEqual({ value: "1" });
  });

  it("repairs old built-in defaults after initial seeding already completed", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const now = 1_700_000_000_000;
    db.prepare(
      `INSERT INTO modes
         (id, name, prompt_body, hotkey_json, display_order, built_in, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("default", "Default", "", '{"chord":"RightMeta"}', 0, 1, now, now);
    db.prepare(
      `INSERT INTO modes
         (id, name, prompt_body, hotkey_json, display_order, built_in, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("translate", "Translate", "", '{"chord":"LeftAlt"}', 1, 1, now, now);
    db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run(
      "initial_seed_complete",
      "1",
    );

    const store = new SqliteStore(db, identityCrypto);
    store.seedIfNeeded();

    expect(store.getMode("default")?.hotkey).toEqual({
      chord: process.platform === "win32" ? "RightCtrl" : "RightMeta",
    });
    expect(store.getMode("translate")?.hotkey).toEqual({ chord: "LeftAlt" });
    expect(store.getMode("rewrite")).toBeNull();
  });

  it("upgrades v2-repaired built-in defaults to the platform default", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const now = 1_700_000_000_000;
    db.prepare(
      `INSERT INTO modes
         (id, name, prompt_body, hotkey_json, display_order, built_in, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("default", "Default", "", '{"chord":"RightMeta"}', 0, 1, now, now);
    db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run(
      "initial_seed_complete",
      "1",
    );
    db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run(
      "builtin_modes_v2_complete",
      "1",
    );

    const store = new SqliteStore(db, identityCrypto);
    store.seedIfNeeded();

    expect(store.getMode("default")?.hotkey).toEqual({
      chord: process.platform === "win32" ? "RightCtrl" : "RightMeta",
    });
    expect(
      db.prepare("SELECT value FROM app_meta WHERE key = ?").get("builtin_modes_v3_complete"),
    ).toEqual({ value: "1" });
  });

  it("does not repair a customized default mode", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const now = 1_700_000_000_000;
    db.prepare(
      `INSERT INTO modes
         (id, name, prompt_body, hotkey_json, display_order, built_in, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("default", "Default", "custom command", '{"chord":"RightMeta"}', 0, 1, now, now);
    db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run(
      "initial_seed_complete",
      "1",
    );

    const store = new SqliteStore(db, identityCrypto);
    store.seedIfNeeded();

    expect(store.getMode("default")?.hotkey).toEqual({ chord: "RightMeta" });
    expect(store.getMode("default")?.prompt_body).toBe("custom command");
    expect(store.getMode("translate")?.prompt_body).toBe(DEFAULT_TRANSLATE_PROMPT);
  });

  it("seeds default dictionary terms once as user-added entries", () => {
    // Inline construction (mirrors freshStore) because this test needs the raw
    // db handle to read the app_meta seed flag.
    const db = new Database(":memory:");
    applyMigrations(db);
    const store = new SqliteStore(db, identityCrypto);

    store.seedIfNeeded();

    const seeded = store.listDictionary();
    expect(seeded.map((entry) => entry.term)).toEqual(
      DEFAULT_DICTIONARY_TERMS.map((entry) => entry.term),
    );
    expect(seeded.every((entry) => entry.source === "user_added")).toBe(true);
    expect(seeded.every((entry) => entry.hit_count === 0)).toBe(true);
    expect(seeded.every((entry) => entry.last_used_at === null)).toBe(true);
    expect(
      db.prepare("SELECT value FROM app_meta WHERE key = ?").get(
        "default_dictionary_v1_complete",
      ),
    ).toEqual({ value: "1" });

    store.seedIfNeeded();
    expect(store.listDictionary().map((entry) => entry.term)).toEqual(
      DEFAULT_DICTIONARY_TERMS.map((entry) => entry.term),
    );
  });

  it("does not recreate a default dictionary term after the user deletes it", () => {
    const store = freshStore();
    store.seedIfNeeded();

    const soto = store.listDictionary().find((entry) => entry.term === "Soto");
    expect(soto).toBeDefined();
    store.deleteDictionaryEntry(soto!.id);
    expect(store.listDictionary().some((entry) => entry.term === "Soto")).toBe(false);

    store.seedIfNeeded();
    expect(store.listDictionary().some((entry) => entry.term === "Soto")).toBe(false);
  });

  it("preserves an existing manual duplicate when seeding default dictionary terms", () => {
    const store = freshStore();
    store.saveDictionaryEntry({
      id: "dict.custom.soto",
      term: "Soto",
      source: "user_added",
      hit_count: 3,
      last_used_at: 123n,
      created_at: 10n,
    });

    store.seedIfNeeded();

    const sotoEntries = store.listDictionary().filter((entry) => entry.term === "Soto");
    expect(sotoEntries).toHaveLength(1);
    expect(sotoEntries[0]).toMatchObject({
      id: "dict.custom.soto",
      source: "user_added",
      hit_count: 3,
      last_used_at: 123n,
      created_at: 10n,
    });
  });

  it("promotes an existing auto-learned duplicate when seeding default dictionary terms", () => {
    const store = freshStore();
    store.saveDictionaryEntry({
      id: "dict.auto.soto",
      term: "Soto",
      source: "auto_learned",
      hit_count: 7,
      last_used_at: 456n,
      created_at: 10n,
    });

    store.seedIfNeeded();

    const sotoEntries = store.listDictionary().filter((entry) => entry.term === "Soto");
    expect(sotoEntries).toHaveLength(1);
    expect(sotoEntries[0]).toMatchObject({
      id: "dict.auto.soto",
      source: "user_added",
      hit_count: 7,
      last_used_at: 456n,
      created_at: 10n,
    });
  });
});

describe("SqliteStore modes", () => {
  it("saveMode upsert preserves created_at and built_in on update", () => {
    const store = freshStore();
    const created = store.saveMode(makeMode({ created_at: BigInt(1000) }));
    expect(created.created_at).toBe(BigInt(1000));

    // Renderer tries to rewrite created_at + mark built_in: both ignored.
    const updated = store.saveMode(
      makeMode({
        name: "Renamed",
        created_at: BigInt(9999),
        built_in: true,
      }),
    );
    expect(updated.name).toBe("Renamed");
    expect(updated.created_at).toBe(BigInt(1000));
    expect(updated.built_in).toBe(false);
    expect(updated.updated_at).toBeGreaterThan(BigInt(1000));

    const fetched = store.getMode("mode.custom");
    expect(fetched?.created_at).toBe(BigInt(1000));
    expect(fetched?.built_in).toBe(false);
  });

  it("deleteMode no-ops a built-in mode but removes a custom one", () => {
    const store = freshStore();
    store.seedIfNeeded();

    // Built-in: silent no-op (no throw from the trigger).
    expect(() => store.deleteMode("default")).not.toThrow();
    expect(store.getMode("default")).not.toBeNull();

    store.saveMode(makeMode({ id: "mode.custom" }));
    store.deleteMode("mode.custom");
    expect(store.getMode("mode.custom")).toBeNull();
  });
});

describe("SqliteStore dictionary", () => {
  it("upserts by id and lists by created_at (ascending), matching Rust read_dictionary", () => {
    const store = freshStore();
    store.saveDictionaryEntry({
      id: "d1",
      term: "Soto",
      source: "user_added",
      hit_count: 1,
      last_used_at: null,
      created_at: BigInt(1),
    });
    store.saveDictionaryEntry({
      id: "d2",
      term: "Kubernetes",
      source: "auto_learned",
      hit_count: 5,
      last_used_at: null,
      created_at: BigInt(2),
    });
    const listed = store.listDictionary();
    expect(listed.map((d) => d.id)).toEqual(["d1", "d2"]); // created_at ASC

    // Upsert d1 to a new term.
    const updated = store.saveDictionaryEntry({
      id: "d1",
      term: "SotoApp",
      source: "user_added",
      hit_count: 1,
      last_used_at: null,
      created_at: BigInt(1),
    });
    expect(updated.term).toBe("SotoApp");
    expect(store.listDictionary()).toHaveLength(2);
  });
});

describe("SqliteStore history", () => {
  it("listRecentHistory caps at 250 newest, newest first", () => {
    const store = freshStore();
    for (let i = 0; i < 300; i++) {
      store.appendHistory(
        makeHistory({ id: `h${i}`, created_at: BigInt(i) }),
      );
    }
    const recent = store.listRecentHistory();
    expect(recent).toHaveLength(250);
    expect(recent[0]?.created_at).toBe(BigInt(299)); // newest first
    expect(recent[249]?.created_at).toBe(BigInt(50)); // 300 - 250

    const all = store.listHistory();
    expect(all).toHaveLength(300);
    expect(all[0]?.created_at).toBe(BigInt(0)); // ASC
  });

  it("round-trips the llm provider/model stamp through appendHistory", () => {
    const store = freshStore();
    store.appendHistory(
      makeHistory({
        id: "h-llm",
        llm_provider_id: "openai-compat",
        llm_model_id: "gpt-4o-mini",
      }),
    );
    const stored = store.listHistory().find((h) => h.id === "h-llm");
    expect(stored?.llm_provider_id).toBe("openai-compat");
    expect(stored?.llm_model_id).toBe("gpt-4o-mini");

    // A record without the stamp persists nulls.
    store.appendHistory(makeHistory({ id: "h-plain" }));
    const plain = store.listHistory().find((h) => h.id === "h-plain");
    expect(plain?.llm_provider_id).toBeNull();
    expect(plain?.llm_model_id).toBeNull();
  });

  it("round-trips the edited-text observation status reason", () => {
    const store = freshStore();
    store.appendHistory(
      makeHistory({
        id: "h-unobserved",
        edited_text_status: "not_observed",
        edited_text_status_reason: "observer_not_attached",
      }),
    );

    const stored = store.listHistory().find((h) => h.id === "h-unobserved");
    expect(stored?.edited_text_status).toBe("not_observed");
    expect(stored?.edited_text_status_reason).toBe("observer_not_attached");
  });

  it("updates only the post-insert observation fields", async () => {
    const store = freshStore();
    store.appendHistory(
      makeHistory({
        id: "h-observed",
        raw_text: "dictated",
        processed_text: "polished",
        injected_text: "polished",
        target_app: "com.example.App",
      }),
    );

    const accepted = await store.recordPostInsertObservation("h-observed", {
      edited_text: "polished!",
      edited_text_status: "captured",
      edited_text_status_reason: null,
      ax_context_at_end: {
        full_text: "polished!",
        selection_start: 9,
        selection_end: 9,
        before: "polished!",
        after: "",
        ax_role: "AXTextArea",
        app_bundle_id: "com.example.App",
        app_name: "Example",
        window_title: "Doc",
        web_url: null,
        web_domain: null,
      },
    });
    const duplicateAccepted = await store.recordPostInsertObservation("h-observed", {
      edited_text: null,
      edited_text_status: "unavailable",
      edited_text_status_reason: "observer_timeout",
      ax_context_at_end: null,
    });

    const stored = store.listHistory().find((h) => h.id === "h-observed");
    expect(accepted).toBe(true);
    expect(duplicateAccepted).toBe(false);
    expect(stored?.raw_text).toBe("dictated");
    expect(stored?.processed_text).toBe("polished");
    expect(stored?.injected_text).toBe("polished");
    expect(stored?.target_app).toBe("com.example.App");
    expect(stored?.edited_text).toBe("polished!");
    expect(stored?.edited_text_status).toBe("captured");
    expect(stored?.edited_text_status_reason).toBeNull();
    expect(stored?.ax_context_at_end?.full_text).toBe("polished!");
  });

  it("sweeps only stale pending observation rows to observer_timeout", () => {
    const store = freshStore();
    store.appendHistory(
      makeHistory({
        id: "h-old-pending",
        created_at: BigInt(1_700_000_000_000),
      }),
    );
    store.appendHistory(
      makeHistory({
        id: "h-fresh-pending",
        created_at: BigInt(1_700_000_400_000),
      }),
    );
    store.appendHistory(
      makeHistory({
        id: "h-captured",
        created_at: BigInt(1_700_000_000_000),
        edited_text_status: "captured",
      }),
    );

    const changed = store.sweepTimedOutPendingObservations(
      1_700_000_600_000,
      5 * 60_000,
    );

    expect(changed).toBe(1);
    const byId = new Map(store.listHistory().map((h) => [h.id, h]));
    expect(byId.get("h-old-pending")?.edited_text_status).toBe("unavailable");
    expect(byId.get("h-old-pending")?.edited_text_status_reason).toBe(
      "observer_timeout",
    );
    expect(byId.get("h-fresh-pending")?.edited_text_status).toBe("pending");
    expect(byId.get("h-captured")?.edited_text_status).toBe("captured");
  });

  it("deleteHistoryRecord and clearHistory work", () => {
    const store = freshStore();
    store.appendHistory(makeHistory({ id: "a", created_at: BigInt(1) }));
    store.appendHistory(makeHistory({ id: "b", created_at: BigInt(2) }));
    store.deleteHistoryRecord("a");
    expect(store.listHistory().map((h) => h.id)).toEqual(["b"]);
    store.clearHistory();
    expect(store.listHistory()).toHaveLength(0);
  });
});

describe("SqliteStore provider configs", () => {
  it("upsertProviderConfig with is_default flips existing defaults to 0", () => {
    const store = freshStore();
    store.upsertProviderConfig(makeConfig({ config_id: "a", is_default: true }));
    store.upsertProviderConfig(makeConfig({ config_id: "b", is_default: true }));
    const defaults = store
      .listProviderConfigs()
      .filter((c) => c.is_default)
      .map((c) => c.config_id);
    expect(defaults).toEqual(["b"]);
  });

  it("upsert preserves created_at and validation on update", () => {
    const store = freshStore();
    store.upsertProviderConfig(makeConfig({ config_id: "a", created_at: BigInt(2000) }));
    store.updateProviderValidation("a", {
      last_validated_at: BigInt(5),
      last_validated_latency_ms: 42,
      last_validated_status: "ok",
      last_validated_note: "fine",
      last_validated_sample: null,
      last_validated_sample_result: null,
    });
    // Re-upsert (e.g. user edits model) must not clobber validation/created_at.
    const updated = store.upsertProviderConfig(
      makeConfig({ config_id: "a", model: "gpt-5", created_at: BigInt(9999) }),
    );
    expect(updated.model).toBe("gpt-5");
    expect(updated.created_at).toBe(BigInt(2000));
    expect(updated.validation.last_validated_status).toBe("ok");
    expect(updated.validation.last_validated_at).toBe(BigInt(5));
  });

  it("round-trips a non-omni capability through upsert", () => {
    const store = freshStore();
    store.upsertProviderConfig(makeConfig({ config_id: "asr-1", capability: "asr" }));
    expect(store.getProviderConfig("asr-1")?.capability).toBe("asr");

    // Re-upsert (e.g. user edits the model) keeps the capability change.
    const existing = store.getProviderConfig("asr-1")!;
    store.upsertProviderConfig({ ...existing, capability: "llm", model: "gpt-4o-mini" });
    expect(store.getProviderConfig("asr-1")?.capability).toBe("llm");
  });

  it("deleteProviderConfig cascades to provider_secrets", () => {
    const store = freshStore();
    store.upsertProviderConfig(makeConfig({ config_id: "a" }));
    store.putProviderSecrets({
      config_id: "a",
      api_key: "sk-123",
      endpoint: null,
    });
    expect(store.getProviderSecrets("a")).not.toBeNull();

    store.deleteProviderConfig("a");
    expect(store.getProviderConfig("a")).toBeNull();
    expect(store.getProviderSecrets("a")).toBeNull(); // cascaded away
  });
});

describe("seed + saveMode mode storage", () => {
  it("seeds only public voice modes", () => {
    const store = freshStore();
    store.seedIfNeeded();
    expect(store.getMode("rewrite")).toBeNull();
  });

  it("default + translate do not expose is_command on public DTOs", () => {
    const store = freshStore();
    store.seedIfNeeded();
    expect("is_command" in store.getMode("default")!).toBe(false);
    expect("is_command" in store.getMode("translate")!).toBe(false);
  });

});

describe("SqliteStore provider secrets round-trip", () => {
  it("encrypts on write and decrypts on read via CryptoPort", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    // Spy crypto: prefix ciphertext so we can assert the stored value is the
    // ciphertext, while the read path returns the original plaintext.
    const crypto = {
      encrypt: (p: string) => `enc(${p})`,
      decrypt: (c: string) =>
        c.startsWith("enc(") ? c.slice(4, -1) : c,
    };
    const store = new SqliteStore(db, crypto);
    store.upsertProviderConfig(makeConfig({ config_id: "a" }));
    store.putProviderSecrets({
      config_id: "a",
      api_key: "sk-secret",
      endpoint: "https://api.example.com",
    });

    // Raw column holds ciphertext.
    const raw = db
      .prepare("SELECT api_key FROM provider_secrets WHERE config_id = ?")
      .get("a") as { api_key: string };
    expect(raw.api_key).toBe("enc(sk-secret)");

    // Read path decrypts.
    const got = store.getProviderSecrets("a");
    expect(got?.api_key).toBe("sk-secret");
    expect(got?.endpoint).toBe("https://api.example.com");

    // Upsert overwrites.
    store.putProviderSecrets({
      config_id: "a",
      api_key: "sk-rotated",
      endpoint: null,
    });
    expect(store.getProviderSecrets("a")?.api_key).toBe("sk-rotated");

    store.deleteProviderSecrets("a");
    expect(store.getProviderSecrets("a")).toBeNull();
  });
});
