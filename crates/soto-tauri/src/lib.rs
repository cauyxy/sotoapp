mod commands;
mod hotkeys;
mod provider_backend;
mod tray;
mod voice_runtime;

pub use hotkeys::{
    GlobalHotkeyRegistration, HotkeyRuntimeAction, HotkeyRuntimeActionQueue,
    QueueHotkeyRuntimeActionError, SharedHotkeyRegistrations, drain_hotkey_runtime_actions,
    drain_hotkey_runtime_actions_to_queue, global_hotkey_registrations_for_modes,
    handle_hook_event, hotkey_runtime_action_for_event,
};
pub use provider_backend::{
    CancelVoiceSessionRequest, CompleteFinalTranscriptRequest, CompleteFinalTranscriptResult,
    CompleteVoiceSessionRequest, CreateOmniConfigRequest, HotkeyConflictPolicy, ProviderBackend,
    ProviderTestResult, SaveDictionaryEntryRequest, SaveModeRequest, SaveOmniConfigRequest,
    StartVoiceSessionRequest, SystemTextInjectorFactory, TestProviderRequest, TextInjectorFactory,
    VoiceSessionHandle, VoiceSessionRegistry, VoiceSessionStatus,
};
use soto_platform::PermissionStatusReport;
use soto_storage::StorageRoot;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, WindowEvent};
pub use tray::{
    TrayMenuAction, TrayMenuEntry, tray_action_for_icon_event, tray_action_for_menu_id,
    tray_menu_entries,
};
pub use voice_runtime::{
    CAPSULE_WINDOW_LABEL, CapsuleVisibilityIntent, ProviderVoiceRuntimeBackend,
    TauriVoiceRuntimeEventSink, VOICE_COMPLETION_TIMEOUT, VOICE_RUNTIME_EVENT, VoiceAudioRecorder,
    VoiceRuntime, VoiceRuntimeBackend, VoiceRuntimeErrorCode, VoiceRuntimeEvent,
    VoiceRuntimeEventSink, VoiceRuntimeOutcome, VoiceRuntimeStartError, VoiceRuntimeTarget,
    VoiceRuntimeWorker, capsule_visibility_intent,
};

pub(crate) struct AppState {
    pub(crate) storage: StorageRoot,
    pub(crate) http_client: Arc<std::sync::RwLock<reqwest::Client>>,
    pub(crate) sessions: Mutex<VoiceSessionRegistry>,
    pub(crate) hotkeys: hotkeys::SharedHotkeyRegistrations,
    pub(crate) runtime_actions: hotkeys::HotkeyRuntimeActionQueue,
    #[allow(dead_code)]
    pub(crate) keyboard_hook: Arc<dyn soto_keyboard_hook::KeyboardHook>,
}

pub fn builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let storage = StorageRoot::open_home().map_err(|err| err.to_string())?;
            storage.ensure().map_err(|err| err.to_string())?;
            let modes = storage
                .seed_builtin_modes()
                .map_err(|err| err.to_string())?;
            let registrations = hotkeys::global_hotkey_registrations_for_modes(&modes)?;
            let hotkey_registrations = hotkeys::SharedHotkeyRegistrations::new(registrations);
            let (hotkey_queue, hotkey_events) = soto_hotkey::HotkeyEventQueue::new();
            let (runtime_action_queue, runtime_actions) = hotkeys::HotkeyRuntimeActionQueue::new();

            let registrations_for_handler = hotkey_registrations.clone();
            let queue_for_handler = hotkey_queue.clone();
            let hook = keyboard_hook_or_fallback(soto_keyboard_hook::install(move |event| {
                hotkeys::handle_hook_event(event, &registrations_for_handler, &queue_for_handler);
            }));

            hotkeys::install_keyboard_hook(hook.clone(), hotkey_registrations.clone())?;
            hotkeys::spawn_hotkey_event_consumer(
                app.handle().clone(),
                hotkey_events,
                runtime_action_queue.clone(),
            );
            let use_proxy = storage.read_settings().map(|s| s.use_proxy).unwrap_or(true);
            let initial_client = soto_provider::omni::chat_completions::build_http_client(
                use_proxy,
            )
            .unwrap_or_else(|_| soto_provider::omni::chat_completions::default_http_client());
            let http_client: Arc<std::sync::RwLock<reqwest::Client>> =
                Arc::new(std::sync::RwLock::new(initial_client));

            voice_runtime::spawn_voice_runtime_worker(
                app.handle().clone(),
                storage.clone(),
                http_client.clone(),
                runtime_actions,
            );
            tray::install_tray(app.handle())?;
            app.manage(AppState {
                storage,
                http_client,
                sessions: Mutex::new(VoiceSessionRegistry::default()),
                hotkeys: hotkey_registrations,
                runtime_actions: runtime_action_queue,
                keyboard_hook: hook,
            });
            spawn_permission_poller(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && let WindowEvent::CloseRequested { api, .. } = event
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::health,
            commands::get_app_settings,
            commands::get_app_snapshot,
            commands::list_microphone_devices,
            commands::list_permission_statuses,
            commands::open_permission_settings,
            commands::request_permission_authorization,
            commands::quit_app,
            commands::save_app_settings,
            commands::list_modes,
            commands::save_mode,
            commands::list_history,
            commands::delete_history_record,
            commands::clear_history,
            commands::list_dictionary_entries,
            commands::save_dictionary_entry,
            commands::delete_dictionary_entry,
            commands::start_voice_session,
            commands::complete_final_transcript_session,
            commands::complete_voice_session,
            commands::cancel_voice_session,
            commands::cancel_active_voice_runtime,
            commands::finish_active_voice_runtime,
            commands::list_supported_providers,
            commands::list_provider_configs,
            commands::create_provider_config,
            commands::save_provider_config,
            commands::set_default_provider_config,
            commands::test_provider_config,
            commands::read_prompt,
            commands::write_prompt
        ])
}

fn spawn_permission_poller(app: tauri::AppHandle<tauri::Wry>) {
    tauri::async_runtime::spawn(async move {
        // Use spawn_blocking so we don't occupy a tokio async worker thread while
        // calling IOKit / AVFoundation / ApplicationServices APIs.
        let mut last = tokio::task::spawn_blocking(soto_platform::permission_statuses)
            .await
            .unwrap_or_else(|_| vec![]);
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let current =
                match tokio::task::spawn_blocking(soto_platform::permission_statuses).await {
                    Ok(statuses) => statuses,
                    Err(_) => continue,
                };
            for status in permission_status_changes(&last, &current) {
                let _ = app.emit("permission://updated", status);
            }
            last = current;
        }
    });
}

fn permission_status_changes(
    previous: &[PermissionStatusReport],
    current: &[PermissionStatusReport],
) -> Vec<PermissionStatusReport> {
    current
        .iter()
        .filter(|status| {
            previous
                .iter()
                .find(|prev| prev.pane == status.pane)
                .is_some_and(|prev| prev.kind != status.kind)
        })
        .cloned()
        .collect()
}

fn keyboard_hook_or_fallback(
    hook: Result<Box<dyn soto_keyboard_hook::KeyboardHook>, soto_keyboard_hook::HookError>,
) -> Arc<dyn soto_keyboard_hook::KeyboardHook> {
    match hook {
        Ok(hook) => Arc::from(hook),
        Err(error) => {
            eprintln!(
                "[soto-hotkey] keyboard hook unavailable; continuing without global hotkeys: {error}"
            );
            Arc::new(soto_keyboard_hook::MockKeyboardHook::new())
        }
    }
}

pub fn run(context: tauri::Context<tauri::Wry>) {
    builder()
        .run(context)
        .expect("failed to run Soto desktop app");
}

#[cfg(test)]
mod tests {
    use soto_keyboard_hook::HookError;
    use soto_platform::{PermissionPane, PermissionStatusKind, PermissionStatusReport};

    #[test]
    fn keyboard_hook_install_failure_falls_back_to_non_crashing_hook() {
        let hook = super::keyboard_hook_or_fallback(Err(HookError::InstallFailed(
            "CGEventTapCreate returned NULL".into(),
        )));

        assert!(hook.replace_registrations(Vec::new()).is_ok());
    }

    #[test]
    fn permission_status_changes_returns_rows_whose_kind_changed() {
        let previous = vec![
            permission_report(
                PermissionPane::Microphone,
                PermissionStatusKind::NeedsReview,
            ),
            permission_report(PermissionPane::Accessibility, PermissionStatusKind::Granted),
        ];
        let current = vec![
            permission_report(PermissionPane::Microphone, PermissionStatusKind::Granted),
            permission_report(PermissionPane::Accessibility, PermissionStatusKind::Granted),
        ];

        assert_eq!(
            super::permission_status_changes(&previous, &current),
            vec![permission_report(
                PermissionPane::Microphone,
                PermissionStatusKind::Granted
            )]
        );
    }

    fn permission_report(
        pane: PermissionPane,
        kind: PermissionStatusKind,
    ) -> PermissionStatusReport {
        PermissionStatusReport {
            pane,
            kind,
            label: kind.label().into(),
            detail: "test detail".into(),
        }
    }
}
