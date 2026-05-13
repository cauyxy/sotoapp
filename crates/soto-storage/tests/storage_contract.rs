use chrono::Utc;
use soto_core::{
    DictionaryEntry, DictionarySource, DictionaryStatus, HistoryRecord, InjectionOutcome,
    ProviderConfig, ProviderConfigValidation, SessionStatus, ValidationStatus,
};
use soto_storage::SqliteStorage;

fn open_storage(dir: &tempfile::TempDir) -> SqliteStorage {
    SqliteStorage::open(dir.path().join("soto.db")).expect("open storage")
}

#[test]
fn legacy_new_uses_requested_storage_directory() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = SqliteStorage::new(temp.path());

    assert_eq!(storage.root(), temp.path().join("soto.db").as_path());
}

#[test]
fn storage_seeds_canonical_modes_on_first_run() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = open_storage(&temp);
    let modes = storage.read_modes().expect("read modes");

    assert!(temp.path().join("soto.db").exists());
    assert_eq!(
        modes
            .iter()
            .map(|mode| mode.id.as_str())
            .collect::<Vec<_>>(),
        ["default", "translate"]
    );
}

#[test]
fn seed_is_idempotent_across_reopens() {
    let temp = tempfile::tempdir().expect("tempdir");
    let first = open_storage(&temp);
    let initial = first.read_modes().expect("read modes");
    drop(first);

    let second = open_storage(&temp);
    let again = second.read_modes().expect("read modes again");
    assert_eq!(
        initial.iter().map(|m| &m.id).collect::<Vec<_>>(),
        again.iter().map(|m| &m.id).collect::<Vec<_>>(),
        "second open does not re-seed",
    );
}

#[test]
fn builtin_modes_cannot_be_deleted() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = open_storage(&temp);
    // The store-level delete returns NotFound-style error for the built-in row;
    // SQLite trigger backs it up at the DB level for raw deletes.
    let err = storage.delete_mode("default").err();
    let still_there = storage
        .read_modes()
        .expect("read modes after delete attempt");
    // Either the delete returned an error or the row was preserved by the trigger.
    if err.is_none() {
        assert!(
            still_there.iter().any(|m| m.id == "default"),
            "default mode must persist",
        );
    }
}

#[test]
fn builtin_prompts_cannot_be_deleted() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = open_storage(&temp);
    let res = storage.delete_prompt("default");
    assert!(res.is_err(), "deleting built-in prompt should fail");
    storage
        .read_prompt("default")
        .expect("default prompt still readable");
}

#[test]
fn app_settings_default_theme_is_system_and_persists() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = open_storage(&temp);

    let initial = storage.read_settings().unwrap();
    assert_eq!(initial.theme, "system");

    let mut next = initial.clone();
    next.theme = "dark".to_string();
    storage.write_settings(&next).unwrap();
    let loaded = storage.read_settings().unwrap();
    assert_eq!(loaded.theme, "dark");
}

#[test]
fn settings_round_trip_preserves_privacy_and_active_provider_field() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = open_storage(&temp);

    let mut settings = storage.default_settings();
    settings.history_enabled = false;
    settings.store_target_metadata = false;
    settings.active_provider_config_id = Some("config.omni".into());

    storage.write_settings(&settings).expect("write settings");

    assert_eq!(storage.read_settings().expect("read settings"), settings);
}

#[test]
fn history_append_and_read_round_trip_all_session_statuses() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = open_storage(&temp);

    let mut completed = history_record("history.completed", "completed");
    completed.status = SessionStatus::Completed;
    let mut failed = history_record("history.failed", "failed");
    failed.status = SessionStatus::Failed;
    let mut cancelled = history_record("history.cancelled", "cancelled");
    cancelled.status = SessionStatus::Cancelled;
    let mut empty = history_record("history.empty", "");
    empty.status = SessionStatus::Empty;

    for record in [&completed, &failed, &cancelled, &empty] {
        storage.append_history(record).expect("append history");
    }
    let history = storage.read_history().expect("read history");
    assert!(history.iter().any(|r| r.status == SessionStatus::Completed));
    assert!(history.iter().any(|r| r.status == SessionStatus::Failed));
    assert!(history.iter().any(|r| r.status == SessionStatus::Cancelled));
    assert!(history.iter().any(|r| r.status == SessionStatus::Empty));
}

#[test]
fn history_delete_and_clear() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = open_storage(&temp);

    storage
        .append_history(&history_record("history.one", "first"))
        .expect("append first");
    storage
        .append_history(&history_record("history.two", "second"))
        .expect("append second");
    storage
        .append_history(&history_record("history.three", "third"))
        .expect("append third");

    storage
        .delete_history_record("history.two")
        .expect("delete history");

    let history = storage.read_history().expect("read history");
    let ids: Vec<&str> = history.iter().map(|r| r.id.as_str()).collect();
    assert!(ids.contains(&"history.one"));
    assert!(ids.contains(&"history.three"));
    assert!(!ids.contains(&"history.two"));

    storage.clear_history().expect("clear history");
    assert!(storage.read_history().expect("read history").is_empty());
}

#[test]
fn read_recent_history_limits_to_latest_appended_records() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = open_storage(&temp);

    for (i, id) in ["history.one", "history.two", "history.three"]
        .into_iter()
        .enumerate()
    {
        let mut rec = history_record(id, id);
        // Stagger created_at so the recency ordering is deterministic.
        rec.created_at = Utc::now() + chrono::Duration::milliseconds(i as i64);
        storage.append_history(&rec).expect("append history");
    }

    let recent = storage.read_recent_history(2).expect("read recent history");
    let ids: Vec<&str> = recent.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, ["history.two", "history.three"]);
}

#[test]
fn provider_and_dictionary_round_trip() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = open_storage(&temp);
    let now = Utc::now();

    let provider = ProviderConfig {
        config_id: "config.omni".into(),
        provider_id: "mimo-plan-sea".into(),
        display_name: Some("Mimo-Plan-SEA".into()),
        model: "mimo-v2.5".into(),
        base_url: Some("https://token-plan-sgp.xiaomimimo.com/v1".into()),
        is_default: true,
        validation: ProviderConfigValidation {
            last_validated_at: Some(now),
            last_validated_latency_ms: Some(180),
            last_validated_status: ValidationStatus::Ok,
            last_validated_note: None,
            last_validated_sample: None,
            last_validated_sample_result: None,
        },
        created_at: now,
        updated_at: now,
    };
    storage
        .write_provider_configs(std::slice::from_ref(&provider))
        .expect("write providers");
    let read_back = storage.read_provider_configs().expect("read providers");
    assert_eq!(read_back.len(), 1);
    assert_eq!(read_back[0].config_id, provider.config_id);
    assert_eq!(read_back[0].provider_id, provider.provider_id);
    assert_eq!(read_back[0].model, provider.model);
    assert_eq!(read_back[0].is_default, provider.is_default);

    let entry = DictionaryEntry {
        id: "dict.1".into(),
        term: "Soto".into(),
        aliases: vec!["sotto".into()],
        note: "Product name".into(),
        source: DictionarySource::UserAdded,
        status: DictionaryStatus::Active,
        enabled: true,
        created_at: now,
        updated_at: now,
        last_used_at: None,
        hit_count: 0,
    };
    storage
        .write_dictionary(std::slice::from_ref(&entry))
        .expect("write dictionary");
    let read_back = storage.read_dictionary().expect("read dictionary");
    assert_eq!(read_back.len(), 1);
    assert_eq!(read_back[0].id, entry.id);
    assert_eq!(read_back[0].term, entry.term);
    assert_eq!(read_back[0].aliases, entry.aliases);
}

#[test]
fn dictionary_upsert_and_delete() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = open_storage(&temp);
    let now = Utc::now();
    let mut first = dictionary_entry("dict.one", "Soto", now);
    let second = dictionary_entry("dict.two", "Tauri", now);

    storage
        .upsert_dictionary_entry(first.clone())
        .expect("insert first");
    storage
        .upsert_dictionary_entry(second.clone())
        .expect("insert second");
    first.aliases.push("sotto".into());
    first.note = "Product name".into();
    storage
        .upsert_dictionary_entry(first.clone())
        .expect("update first");

    let entries = storage.read_dictionary().expect("read dictionary");
    let ids: Vec<&str> = entries.iter().map(|e| e.id.as_str()).collect();
    assert!(ids.contains(&"dict.one") && ids.contains(&"dict.two"));
    let updated = entries.iter().find(|e| e.id == "dict.one").unwrap();
    assert_eq!(updated.aliases, ["sotto"]);

    storage
        .delete_dictionary_entry("dict.one")
        .expect("delete first");
    let entries = storage.read_dictionary().expect("read dictionary");
    let ids: Vec<&str> = entries.iter().map(|e| e.id.as_str()).collect();
    assert!(!ids.contains(&"dict.one"));
    assert!(ids.contains(&"dict.two"));
    assert!(
        ids.iter().any(|id| id.starts_with("preset-dict-")),
        "deleting a user entry should not remove seeded dictionary entries"
    );
}

#[test]
fn collect_hotwords_reads_dictionary_through_storage() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = open_storage(&temp);
    let now = Utc::now();
    let first = dictionary_entry("dict.one", "Soto", now);
    let mut disabled = dictionary_entry("dict.two", "Disabled", now);
    disabled.enabled = false;
    let mut suggested = dictionary_entry("dict.three", "Suggested", now);
    suggested.status = DictionaryStatus::Suggested;
    let second = dictionary_entry("dict.four", "Tauri", now);

    storage
        .write_dictionary(&[first, disabled, suggested, second])
        .expect("write dictionary");

    let hotwords = soto_core::collect_hotwords(&storage).expect("collect hotwords");

    assert_eq!(hotwords, ["Soto", "Tauri"]);
}

#[test]
fn provider_config_upsert_keeps_one_default() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = open_storage(&temp);
    let now = Utc::now();

    storage
        .upsert_provider_config(provider_config("config.omni.one", true, now))
        .expect("insert first provider config");
    storage
        .upsert_provider_config(provider_config("config.omni.two", true, now))
        .expect("insert second provider config");

    let configs = storage.read_provider_configs().expect("read configs");
    assert_eq!(configs.iter().filter(|config| config.is_default).count(), 1);
    assert!(
        configs
            .iter()
            .any(|config| config.config_id == "config.omni.two" && config.is_default)
    );
}

#[test]
fn provider_secrets_are_written_separately_from_provider_configs() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = open_storage(&temp);
    let now = Utc::now();

    storage
        .upsert_provider_config(provider_config("config.omni.secret", true, now))
        .expect("insert config");
    storage
        .upsert_provider_secret("config.omni.secret", "api_key", "secret-value")
        .expect("write secret");

    // Read back via the legacy map shape used by the existing provider_backend.
    let secrets = storage
        .read_provider_secrets("config.omni.secret")
        .expect("read secrets");
    assert_eq!(
        secrets.get("api_key").map(String::as_str),
        Some("secret-value")
    );

    // Provider config row should not leak the secret bytes.
    let configs = storage.read_provider_configs().expect("read configs");
    let cfg = configs
        .iter()
        .find(|c| c.config_id == "config.omni.secret")
        .expect("config present");
    let dumped = serde_json::to_string(cfg).expect("serialize config");
    assert!(!dumped.contains("secret-value"));
}

#[test]
fn provider_validation_update_preserves_config_metadata() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage = open_storage(&temp);
    let now = Utc::now();

    storage
        .upsert_provider_config(provider_config("config.omni.validate", true, now))
        .expect("insert config");
    storage
        .update_provider_validation(
            "config.omni.validate",
            ProviderConfigValidation {
                last_validated_at: Some(now),
                last_validated_latency_ms: Some(42),
                last_validated_status: ValidationStatus::Ok,
                last_validated_note: Some("Stub validation passed.".into()),
                last_validated_sample: None,
                last_validated_sample_result: None,
            },
        )
        .expect("update validation");

    let configs = storage.read_provider_configs().expect("read configs");
    assert!(configs.iter().any(|config| {
        config.config_id == "config.omni.validate"
            && config.provider_id == "mimo-plan-sea"
            && config.model == "mimo-v2.5"
            && matches!(
                config.validation,
                ProviderConfigValidation {
                    last_validated_status: ValidationStatus::Ok,
                    last_validated_latency_ms: Some(42),
                    ..
                }
            )
    }));
}

fn dictionary_entry(id: &str, term: &str, now: chrono::DateTime<Utc>) -> DictionaryEntry {
    DictionaryEntry {
        id: id.into(),
        term: term.into(),
        aliases: Vec::new(),
        note: String::new(),
        source: DictionarySource::UserAdded,
        status: DictionaryStatus::Active,
        enabled: true,
        created_at: now,
        updated_at: now,
        last_used_at: None,
        hit_count: 0,
    }
}

fn provider_config(
    config_id: &str,
    is_default: bool,
    now: chrono::DateTime<Utc>,
) -> ProviderConfig {
    ProviderConfig {
        config_id: config_id.into(),
        provider_id: "mimo-plan-sea".into(),
        display_name: Some("Mimo-Plan-SEA".into()),
        model: "mimo-v2.5".into(),
        base_url: Some("https://token-plan-sgp.xiaomimimo.com/v1".into()),
        is_default,
        validation: ProviderConfigValidation {
            last_validated_at: None,
            last_validated_latency_ms: None,
            last_validated_status: ValidationStatus::Unspecified,
            last_validated_note: None,
            last_validated_sample: None,
            last_validated_sample_result: None,
        },
        created_at: now,
        updated_at: now,
    }
}

fn history_record(id: &str, text: &str) -> HistoryRecord {
    HistoryRecord {
        id: id.into(),
        created_at: Utc::now(),
        raw_text: text.into(),
        processing_mode: "default".into(),
        processed_text: None,
        final_text: text.into(),
        status: SessionStatus::Completed,
        injection_outcome: InjectionOutcome::Inserted,
        speaking_duration_ms: 1200,
        char_count: text.chars().count() as u32,
        target_app: "Notes".into(),
        target_window_title: "Draft".into(),
        target_control_type: "text".into(),
        provider_id: Some("mimo-plan-sea".into()),
        model_id: Some("mimo-v2.5".into()),
    }
}
