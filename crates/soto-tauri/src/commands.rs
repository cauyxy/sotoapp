use serde::Serialize;
use soto_audio::MicrophoneDevice;
use soto_core::{
    AppSettings, DictionaryEntry, HistoryRecord, Mode, ProviderCatalog, ProviderConfig,
};
use soto_platform::{PermissionPane, PermissionSettingsCommand, PermissionStatusReport};
use tauri::{AppHandle, State, Wry};

use crate::{
    AppState, CancelVoiceSessionRequest, CompleteFinalTranscriptRequest,
    CompleteFinalTranscriptResult, CompleteVoiceSessionRequest, CreateOmniConfigRequest,
    HotkeyRuntimeAction, ProviderBackend, ProviderTestResult, SaveDictionaryEntryRequest,
    SaveModeRequest, SaveOmniConfigRequest, StartVoiceSessionRequest, TestProviderRequest,
    VoiceSessionHandle,
};

// All commands that hit disk or network are `async fn` and dispatch the
// blocking work via `tokio::task::spawn_blocking`, so a slow IPC handler
// can't serialise the Tauri IPC executor behind it. Trivial commands
// (state reads, queue pushes, process exit) stay sync.
pub const BOOT_HISTORY_LIMIT: usize = 250;

fn task_failed(name: &'static str, error: tokio::task::JoinError) -> String {
    format!("{name} task failed: {error}")
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthStatus {
    pub ok: bool,
    pub version: &'static str,
    pub storage_path: String,
}

#[tauri::command]
pub fn health(state: State<'_, AppState>) -> HealthStatus {
    HealthStatus {
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
        storage_path: state.storage.root().display().to_string(),
    }
}

#[tauri::command]
pub async fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let backend = provider_backend(&state);
    tokio::task::spawn_blocking(move || backend.get_app_settings())
        .await
        .map_err(|e| task_failed("get_app_settings", e))?
}

#[derive(Debug, Clone, Serialize)]
pub struct AppSnapshot {
    pub settings: AppSettings,
    pub modes: Vec<Mode>,
    pub dictionary: Vec<DictionaryEntry>,
    pub history: Vec<HistoryRecord>,
}

#[tauri::command]
pub async fn get_app_snapshot(state: State<'_, AppState>) -> Result<AppSnapshot, String> {
    // Single round-trip that returns everything the main window needs before
    // first paint. Replaces four separate `list_*` calls each of which used
    // to be fired by its own Svelte store on first subscribe.
    let backend = provider_backend(&state);
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || {
        let settings = backend.get_app_settings()?;
        let modes = backend.list_modes()?;
        let dictionary = backend.list_dictionary_entries()?;
        let history = storage
            .read_recent_history(BOOT_HISTORY_LIMIT)
            .map_err(|err| err.to_string())?;
        Ok::<AppSnapshot, String>(AppSnapshot {
            settings,
            modes,
            dictionary,
            history,
        })
    })
    .await
    .map_err(|e| task_failed("get_app_snapshot", e))?
}

#[tauri::command]
pub async fn save_app_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let backend = provider_backend(&state);
    tokio::task::spawn_blocking(move || backend.save_app_settings(settings))
        .await
        .map_err(|e| task_failed("save_app_settings", e))?
}

#[tauri::command]
pub async fn list_microphone_devices() -> Result<Vec<MicrophoneDevice>, String> {
    tokio::task::spawn_blocking(|| soto_audio::list_microphone_devices().map_err(|e| e.to_string()))
        .await
        .map_err(|e| task_failed("list_microphone_devices", e))?
}

#[tauri::command]
pub async fn list_permission_statuses() -> Result<Vec<PermissionStatusReport>, String> {
    tokio::task::spawn_blocking(soto_platform::permission_statuses)
        .await
        .map_err(|e| task_failed("list_permission_statuses", e))
}

#[tauri::command]
pub async fn open_permission_settings(pane: String) -> Result<(), String> {
    let pane = PermissionPane::parse(&pane)?;
    tokio::task::spawn_blocking(move || PermissionSettingsCommand::open_current(pane))
        .await
        .map_err(|e| task_failed("open_permission_settings", e))?
}

#[tauri::command]
pub async fn request_permission_authorization(
    pane: String,
) -> Result<PermissionStatusReport, String> {
    let pane = PermissionPane::parse(&pane)?;
    tokio::task::spawn_blocking(move || soto_platform::request_permission_authorization(pane))
        .await
        .map_err(|e| task_failed("request_permission_authorization", e))?
}

#[tauri::command]
pub fn quit_app(app: AppHandle<Wry>) {
    app.exit(0);
}

#[tauri::command]
pub async fn list_modes(state: State<'_, AppState>) -> Result<Vec<Mode>, String> {
    let backend = provider_backend(&state);
    tokio::task::spawn_blocking(move || backend.list_modes())
        .await
        .map_err(|e| task_failed("list_modes", e))?
}

#[tauri::command]
pub async fn save_mode(
    state: State<'_, AppState>,
    request: SaveModeRequest,
) -> Result<Mode, String> {
    let backend = provider_backend(&state);
    let keyboard_hook = state.keyboard_hook.clone();
    let hotkeys = state.hotkeys.clone();
    tokio::task::spawn_blocking(move || {
        let saved_mode = backend.save_mode(request)?;
        eprintln!(
            "[soto-cmd] save_mode: persisted mode_id={} name={} hotkey={}",
            saved_mode.id,
            saved_mode.name,
            saved_mode
                .hotkey
                .as_ref()
                .map(|hk| format!("{} ({:?})", hk.chord.canonical(), hk.style))
                .unwrap_or_else(|| "<none>".to_string())
        );
        let modes = backend.list_modes()?;
        let registrations = crate::hotkeys::global_hotkey_registrations_for_modes(&modes)?;
        eprintln!(
            "[soto-cmd] save_mode: {} mode(s) total, {} with hotkeys",
            modes.len(),
            registrations.len()
        );
        crate::hotkeys::refresh_hotkey_registrations(
            keyboard_hook.as_ref(),
            &hotkeys,
            registrations,
        )
        .map_err(|error| {
            eprintln!("[soto-cmd] save_mode: refresh_hotkey_registrations FAILED: {error}");
            format!("mode was saved, but keyboard hook could not be refreshed: {error}")
        })?;
        Ok::<Mode, String>(saved_mode)
    })
    .await
    .map_err(|e| task_failed("save_mode", e))?
}

#[tauri::command]
pub async fn list_history(state: State<'_, AppState>) -> Result<Vec<HistoryRecord>, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.read_history().map_err(|e| e.to_string()))
        .await
        .map_err(|e| task_failed("list_history", e))?
}

#[tauri::command]
pub async fn delete_history_record(
    state: State<'_, AppState>,
    history_id: String,
) -> Result<(), String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || {
        storage
            .delete_history_record(&history_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| task_failed("delete_history_record", e))?
}

#[tauri::command]
pub async fn clear_history(state: State<'_, AppState>) -> Result<(), String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.clear_history().map_err(|e| e.to_string()))
        .await
        .map_err(|e| task_failed("clear_history", e))?
}

#[tauri::command]
pub async fn list_dictionary_entries(
    state: State<'_, AppState>,
) -> Result<Vec<DictionaryEntry>, String> {
    let backend = provider_backend(&state);
    tokio::task::spawn_blocking(move || backend.list_dictionary_entries())
        .await
        .map_err(|e| task_failed("list_dictionary_entries", e))?
}

#[tauri::command]
pub async fn save_dictionary_entry(
    state: State<'_, AppState>,
    request: SaveDictionaryEntryRequest,
) -> Result<DictionaryEntry, String> {
    let backend = provider_backend(&state);
    tokio::task::spawn_blocking(move || backend.save_dictionary_entry(request))
        .await
        .map_err(|e| task_failed("save_dictionary_entry", e))?
}

#[tauri::command]
pub async fn delete_dictionary_entry(
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<(), String> {
    let backend = provider_backend(&state);
    tokio::task::spawn_blocking(move || backend.delete_dictionary_entry(&entry_id))
        .await
        .map_err(|e| task_failed("delete_dictionary_entry", e))?
}

#[tauri::command]
pub async fn start_voice_session(
    state: State<'_, AppState>,
    request: StartVoiceSessionRequest,
) -> Result<VoiceSessionHandle, String> {
    let backend = provider_backend(&state);
    let active = tokio::task::spawn_blocking(move || backend.prepare_voice_session(request))
        .await
        .map_err(|e| task_failed("start_voice_session", e))?
        .map_err(String::from)?;
    state
        .sessions
        .lock()
        .map_err(|_| "voice session registry is unavailable".to_string())
        .map(|mut sessions| sessions.start(active))
}

#[tauri::command]
pub async fn complete_final_transcript_session(
    state: State<'_, AppState>,
    request: CompleteFinalTranscriptRequest,
) -> Result<CompleteFinalTranscriptResult, String> {
    provider_backend(&state)
        .complete_final_transcript_session(request)
        .await
}

#[tauri::command]
pub async fn complete_voice_session(
    state: State<'_, AppState>,
    request: CompleteVoiceSessionRequest,
) -> Result<CompleteFinalTranscriptResult, String> {
    let active = state
        .sessions
        .lock()
        .map_err(|_| "voice session registry is unavailable".to_string())?
        .take(&request.handle_id)?;
    provider_backend(&state)
        .complete_active_voice_session(active, request)
        .await
}

#[tauri::command]
pub async fn cancel_voice_session(
    state: State<'_, AppState>,
    request: CancelVoiceSessionRequest,
) -> Result<CompleteFinalTranscriptResult, String> {
    let backend = provider_backend(&state);
    tokio::task::spawn_blocking(move || backend.cancel_voice_session(request))
        .await
        .map_err(|e| task_failed("cancel_voice_session", e))?
}

#[tauri::command]
pub fn cancel_active_voice_runtime(state: State<'_, AppState>) -> Result<(), String> {
    state
        .runtime_actions
        .push(HotkeyRuntimeAction::CancelRecording {
            mode_id: String::new(),
        })
        .map_err(|_| "voice runtime queue is unavailable".to_string())
}

#[tauri::command]
pub fn finish_active_voice_runtime(state: State<'_, AppState>) -> Result<(), String> {
    state
        .runtime_actions
        .push(HotkeyRuntimeAction::FinishRecording {
            mode_id: String::new(),
        })
        .map_err(|_| "voice runtime queue is unavailable".to_string())
}

#[tauri::command]
pub async fn list_supported_providers(
    state: State<'_, AppState>,
) -> Result<ProviderCatalog, String> {
    Ok(provider_backend(&state).list_supported_providers())
}

#[tauri::command]
pub async fn list_provider_configs(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderConfig>, String> {
    let backend = provider_backend(&state);
    tokio::task::spawn_blocking(move || backend.list_omni_configs())
        .await
        .map_err(|e| task_failed("list_provider_configs", e))?
}

#[tauri::command]
pub async fn create_provider_config(
    state: State<'_, AppState>,
    request: CreateOmniConfigRequest,
) -> Result<ProviderConfig, String> {
    let backend = provider_backend(&state);
    tokio::task::spawn_blocking(move || backend.create_omni_config(request))
        .await
        .map_err(|e| task_failed("create_provider_config", e))?
}

#[tauri::command]
pub async fn save_provider_config(
    state: State<'_, AppState>,
    request: SaveOmniConfigRequest,
) -> Result<ProviderConfig, String> {
    let backend = provider_backend(&state);
    tokio::task::spawn_blocking(move || backend.save_omni_config(request))
        .await
        .map_err(|e| task_failed("save_provider_config", e))?
}

#[tauri::command]
pub async fn set_default_provider_config(
    state: State<'_, AppState>,
    config_id: String,
) -> Result<(), String> {
    let backend = provider_backend(&state);
    tokio::task::spawn_blocking(move || backend.set_default_omni_config(&config_id))
        .await
        .map_err(|e| task_failed("set_default_provider_config", e))?
}

#[tauri::command]
pub async fn test_provider_config(
    state: State<'_, AppState>,
    request: TestProviderRequest,
) -> Result<ProviderTestResult, String> {
    provider_backend(&state).test_omni_provider(request).await
}

fn provider_backend(state: &State<'_, AppState>) -> ProviderBackend {
    ProviderBackend::from_storage_with_shared_client(
        state.storage.clone(),
        state.http_client.clone(),
    )
}

#[tauri::command]
pub async fn read_prompt(
    state: State<'_, AppState>,
    id: String,
) -> Result<soto_prompt::PromptDocument, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || storage.read_prompt(&id).map_err(|e| e.to_string()))
        .await
        .map_err(|e| task_failed("read_prompt", e))?
}

#[tauri::command]
pub async fn write_prompt(
    state: State<'_, AppState>,
    doc: soto_prompt::PromptDocument,
) -> Result<soto_prompt::PromptDocument, String> {
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || -> Result<soto_prompt::PromptDocument, String> {
        storage.write_prompt(&doc).map_err(|e| e.to_string())?;
        Ok(doc)
    })
    .await
    .map_err(|e| task_failed("write_prompt", e))?
}
