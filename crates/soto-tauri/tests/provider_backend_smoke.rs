use soto_tauri::{CreateOmniConfigRequest, ProviderBackend, SaveModeRequest};

#[test]
fn provider_backend_new_uses_requested_storage_directory() {
    let temp = tempfile::tempdir().unwrap();
    let backend = ProviderBackend::new(temp.path()).unwrap();

    assert!(
        backend.storage().root().starts_with(temp.path()),
        "provider backend test storage should stay inside the requested temp dir"
    );
}

#[test]
fn create_omni_config_keeps_secret_separate_defaults_model_and_marks_active_default() {
    let temp = tempfile::tempdir().unwrap();
    let backend = ProviderBackend::new(temp.path()).unwrap();

    let config = backend
        .create_omni_config(CreateOmniConfigRequest {
            provider_id: "mimo-plan-sea".into(),
            display_name: Some("Mimo-Plan-SEA".into()),
            model: "".into(),
            base_url: None,
            api_key: Some("secret-omni-key".into()),
            is_default: true,
        })
        .unwrap();

    assert!(config.is_default);
    let config_id = config.config_id.clone();
    assert_eq!(
        config.model, "mimo-v2.5",
        "empty Mimo model defaults to mimo-v2.5"
    );

    // The provider-configs row must not carry the secret bytes.
    let configs = backend.storage().read_provider_configs().unwrap();
    let dumped = serde_json::to_string(&configs).unwrap();
    assert!(
        !dumped.contains("secret-omni-key"),
        "secrets must not be persisted alongside provider configs"
    );

    let secrets = backend.storage().read_provider_secrets(&config_id).unwrap();
    assert_eq!(
        secrets.get("api_key").map(String::as_str),
        Some("secret-omni-key")
    );

    let listed = backend.list_omni_configs().unwrap();
    assert_eq!(listed.len(), 1);

    let settings = backend.get_app_settings().unwrap();
    assert_eq!(
        settings.active_provider_config_id.as_deref(),
        Some(config_id.as_str())
    );
}

#[test]
fn list_supported_providers_returns_builtin_catalog() {
    let temp = tempfile::tempdir().unwrap();
    let backend = ProviderBackend::new(temp.path()).unwrap();

    let catalog = backend.list_supported_providers();
    assert_eq!(catalog.providers.len(), 5);
    assert!(!catalog.providers.iter().any(|p| p.provider_id == "openai"));
    assert!(
        catalog
            .providers
            .iter()
            .any(|p| p.provider_id == "mimo-plan-sea"
                && p.default_endpoint.as_deref()
                    == Some("https://token-plan-sgp.xiaomimimo.com/v1"))
    );
    assert!(
        catalog
            .providers
            .iter()
            .any(|p| p.provider_id == "mimo-plan-cn"
                && p.default_endpoint.as_deref()
                    == Some("https://token-plan-cn.xiaomimimo.com/v1"))
    );
    assert!(catalog.providers.iter().any(|p| p.provider_id == "mimo-api"
        && p.default_endpoint.as_deref() == Some("https://api.xiaomimimo.com/v1")));
    assert!(
        catalog
            .providers
            .iter()
            .any(|p| p.provider_id == "doubao-ark"
                && p.default_endpoint.as_deref()
                    == Some("https://ark.cn-beijing.volces.com/api/v3")
                && p.suggested_models
                    == ["doubao-seed-2-0-lite-260428", "doubao-seed-2-0-mini-260428"])
    );
}

#[test]
fn create_mimo_omni_config_defaults_to_mimo_model() {
    let temp = tempfile::tempdir().unwrap();
    let backend = ProviderBackend::new(temp.path()).unwrap();

    let config = backend
        .create_omni_config(CreateOmniConfigRequest {
            provider_id: "mimo-plan-sea".into(),
            display_name: Some("Mimo-Plan-SEA".into()),
            model: "".into(),
            base_url: None,
            api_key: Some("mimo-key".into()),
            is_default: true,
        })
        .unwrap();

    assert_eq!(config.model, "mimo-v2.5");
}

#[test]
fn create_doubao_omni_config_defaults_to_lite_model() {
    let temp = tempfile::tempdir().unwrap();
    let backend = ProviderBackend::new(temp.path()).unwrap();

    let config = backend
        .create_omni_config(CreateOmniConfigRequest {
            provider_id: "doubao-ark".into(),
            display_name: Some("Doubao Ark".into()),
            model: "".into(),
            base_url: None,
            api_key: Some("ark-key".into()),
            is_default: true,
        })
        .unwrap();

    assert_eq!(config.model, "doubao-seed-2-0-lite-260428");
}

#[test]
fn create_omni_config_rejects_openai_provider_id() {
    let temp = tempfile::tempdir().unwrap();
    let backend = ProviderBackend::new(temp.path()).unwrap();

    let openai = backend.create_omni_config(CreateOmniConfigRequest {
        provider_id: "openai".into(),
        display_name: Some("OpenAI".into()),
        model: "gpt-4o-audio-preview".into(),
        base_url: None,
        api_key: Some("key".into()),
        is_default: true,
    });
    assert!(openai.is_err(), "OpenAI should not be configurable");
}

#[test]
fn create_omni_config_accepts_custom_model_for_known_provider() {
    let temp = tempfile::tempdir().unwrap();
    let backend = ProviderBackend::new(temp.path()).unwrap();

    let config = backend
        .create_omni_config(CreateOmniConfigRequest {
            provider_id: "doubao-ark".into(),
            display_name: Some("Doubao Ark".into()),
            model: "doubao-seed-2-0-pro-260428".into(),
            base_url: None,
            api_key: Some("ark-key".into()),
            is_default: true,
        })
        .unwrap();

    assert_eq!(config.model, "doubao-seed-2-0-pro-260428");
}

#[test]
fn create_omni_config_accepts_custom_mimo_model_for_known_provider() {
    let temp = tempfile::tempdir().unwrap();
    let backend = ProviderBackend::new(temp.path()).unwrap();

    let config = backend
        .create_omni_config(CreateOmniConfigRequest {
            provider_id: "mimo-plan-sea".into(),
            display_name: Some("Mimo-Plan-SEA".into()),
            model: "mimo-v2.5-pro".into(),
            base_url: None,
            api_key: Some("key".into()),
            is_default: true,
        })
        .unwrap();

    assert_eq!(config.model, "mimo-v2.5-pro");
}

#[test]
fn list_modes_returns_two_canonical_seeds_only() {
    let temp = tempfile::tempdir().unwrap();
    let backend = ProviderBackend::new(temp.path()).unwrap();

    let modes = backend.list_modes().unwrap();
    let ids: Vec<&str> = modes.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["default", "translate"]);
    for mode in &modes {
        // Mode references its prompt by id; the actual body lives in the
        // PromptStore (read via `storage.read_prompt(&mode.prompt_id)`).
        assert!(
            !mode.prompt_id.is_empty(),
            "{} mode has a prompt_id",
            mode.id
        );
        let prompt = backend
            .storage()
            .read_prompt(&mode.prompt_id)
            .unwrap_or_else(|_| panic!("{} mode prompt is readable", mode.id));
        assert!(!prompt.body.is_empty(), "{} prompt body non-empty", mode.id);
    }
}

#[test]
fn save_mode_rejects_hotkey_conflict_under_reject_policy() {
    use soto_core::{HotkeyBinding, HotkeyStyle};
    use soto_keyboard_hook::Chord;
    let temp = tempfile::tempdir().unwrap();
    let backend = ProviderBackend::new(temp.path()).unwrap();

    let mut modes = backend.list_modes().unwrap();
    modes[0].hotkey = Some(HotkeyBinding {
        chord: Chord::parse("RightAlt").unwrap(),
        style: HotkeyStyle::Hold,
    });
    backend
        .save_mode(SaveModeRequest {
            mode: modes[0].clone(),
            hotkey_conflict_policy: soto_tauri::HotkeyConflictPolicy::Reject,
        })
        .unwrap();

    // Now try to assign the same hotkey to mode index 1; should fail.
    modes[1].hotkey = Some(HotkeyBinding {
        chord: Chord::parse("RightAlt").unwrap(),
        style: HotkeyStyle::Hold,
    });
    let result = backend.save_mode(SaveModeRequest {
        mode: modes[1].clone(),
        hotkey_conflict_policy: soto_tauri::HotkeyConflictPolicy::Reject,
    });
    assert!(result.is_err(), "expected reject: {result:?}");
}
