use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::Path,
    sync::{Arc, RwLock},
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use soto_audio::CapturedRecordingFile;
use soto_core::{
    AppSettings, DictionaryEntry, DictionarySource, DictionaryStatus, EmptyReason, HotkeyBinding,
    InjectionOutcome, Mode, ProviderConfig, ProviderConfigValidation, SelectionBehavior,
    SessionStatus, SessionTarget, ValidationStatus,
};
use soto_platform::{
    OsPasteSender, PlatformInjectionEnvironment, SystemClipboard, SystemNativeInserter,
};
use soto_provider::{
    errors::ProviderError,
    omni::chat_completions::{build_http_client, default_http_client},
    omni::{self, OmniConfig},
};
use soto_session::{
    FinalTranscriptRequest, PipelineRunInfo, SessionError, SessionRunOutcome, TextInjector,
    record_cancelled_session, record_failed_session, run_final_transcript_session,
};
use soto_storage::StorageRoot;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
pub struct CreateOmniConfigRequest {
    pub provider_id: String,
    pub display_name: Option<String>,
    pub model: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveOmniConfigRequest {
    pub config_id: Option<String>,
    pub provider_id: String,
    pub display_name: Option<String>,
    pub model: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TestProviderRequest {
    pub config_id: String,
    pub sample: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HotkeyConflictPolicy {
    Reject,
    Steal,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveModeRequest {
    pub mode: Mode,
    pub hotkey_conflict_policy: HotkeyConflictPolicy,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveDictionaryEntryRequest {
    pub id: Option<String>,
    pub term: String,
    pub aliases: Vec<String>,
    pub note: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CompleteFinalTranscriptRequest {
    pub mode_id: String,
    pub raw_text: String,
    pub speaking_duration_ms: u64,
    pub target_app: String,
    pub target_window_title: String,
    pub target_control_type: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CancelVoiceSessionRequest {
    pub mode_id: String,
    pub speaking_duration_ms: u64,
    pub target_app: String,
    pub target_window_title: String,
    pub target_control_type: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StartVoiceSessionRequest {
    pub mode_id: String,
    pub target_app: String,
    pub target_window_title: String,
    pub target_control_type: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CompleteVoiceSessionRequest {
    pub handle_id: String,
    pub raw_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VoiceSessionPrepareError {
    MissingProvider,
    Other(String),
}

impl std::fmt::Display for VoiceSessionPrepareError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VoiceSessionPrepareError::MissingProvider => {
                f.write_str("voice session requires an Omni provider")
            }
            VoiceSessionPrepareError::Other(message) => f.write_str(message),
        }
    }
}

impl From<VoiceSessionPrepareError> for String {
    fn from(error: VoiceSessionPrepareError) -> Self {
        error.to_string()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceSessionStatus {
    Listening,
    Thinking,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VoiceSessionHandle {
    pub handle_id: String,
    pub mode_id: String,
    pub status: VoiceSessionStatus,
}

#[derive(Debug, Clone)]
pub struct ActiveVoiceSession {
    mode: Mode,
    started_at: chrono::DateTime<Utc>,
    provider_id: String,
    model: String,
    config_id: String,
    target_app: String,
    target_window_title: String,
    target_control_type: String,
}

#[derive(Debug, Default)]
pub struct VoiceSessionRegistry {
    sessions: HashMap<String, ActiveVoiceSession>,
}

impl VoiceSessionRegistry {
    pub fn start(&mut self, active: ActiveVoiceSession) -> VoiceSessionHandle {
        let handle_id = format!("session.{}", Uuid::new_v4());
        let mode_id = active.mode.id.clone();
        self.sessions.insert(handle_id.clone(), active);

        VoiceSessionHandle {
            handle_id,
            mode_id,
            status: VoiceSessionStatus::Listening,
        }
    }

    pub fn take(&mut self, handle_id: &str) -> Result<ActiveVoiceSession, String> {
        self.sessions
            .remove(handle_id)
            .ok_or_else(|| format!("voice session handle not found: {handle_id}"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CompleteFinalTranscriptResult {
    pub history_id: String,
    pub raw_text: String,
    pub processed_text: Option<String>,
    pub final_text: String,
    pub status: SessionStatus,
    pub injection_outcome: InjectionOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub empty_reason: Option<EmptyReason>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProviderTestResult {
    pub config_id: String,
    pub status: ValidationStatus,
    pub note: String,
    pub latency_ms: u32,
}

pub trait TextInjectorFactory: Clone {
    type Injector: TextInjector + Send + 'static;

    fn create_text_injector(&self) -> Self::Injector;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemTextInjectorFactory;

impl TextInjectorFactory for SystemTextInjectorFactory {
    type Injector = RuntimePlatformInjector;

    fn create_text_injector(&self) -> Self::Injector {
        RuntimePlatformInjector::new()
    }
}

pub enum RuntimePlatformInjector {
    Platform(PlatformInjectionEnvironment<SystemClipboard, OsPasteSender, SystemNativeInserter>),
    Unavailable(String),
}

impl RuntimePlatformInjector {
    fn new() -> Self {
        match SystemClipboard::new() {
            Ok(clipboard) => Self::Platform(PlatformInjectionEnvironment::new_with_native(
                clipboard,
                OsPasteSender::default(),
                SystemNativeInserter,
            )),
            Err(error) => {
                Self::Unavailable(format!("platform text injection unavailable: {error}"))
            }
        }
    }
}

impl TextInjector for RuntimePlatformInjector {
    fn inject(&mut self, text: &str, selection_behavior: SelectionBehavior) -> InjectionOutcome {
        match self {
            Self::Platform(environment) => environment.inject(text, selection_behavior),
            Self::Unavailable(message) => InjectionOutcome::Failed(message.clone()),
        }
    }
}

#[derive(Clone)]
pub struct ProviderBackend<F = SystemTextInjectorFactory> {
    storage: StorageRoot,
    injector_factory: F,
    http_client: Arc<RwLock<reqwest::Client>>,
}

impl ProviderBackend<SystemTextInjectorFactory> {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, String> {
        Self::new_with_text_injector(root, SystemTextInjectorFactory)
    }

    pub(crate) fn from_storage(storage: StorageRoot) -> Self {
        let use_proxy = storage.read_settings().map(|s| s.use_proxy).unwrap_or(true);
        let client = build_http_client(use_proxy).unwrap_or_else(|_| default_http_client());
        Self {
            storage,
            injector_factory: SystemTextInjectorFactory,
            http_client: Arc::new(RwLock::new(client)),
        }
    }

    pub(crate) fn from_storage_with_shared_client(
        storage: StorageRoot,
        http_client: Arc<RwLock<reqwest::Client>>,
    ) -> Self {
        Self {
            storage,
            injector_factory: SystemTextInjectorFactory,
            http_client,
        }
    }
}

impl<F> ProviderBackend<F>
where
    F: TextInjectorFactory,
{
    pub fn new_with_text_injector(
        root: impl AsRef<Path>,
        injector_factory: F,
    ) -> Result<Self, String> {
        let storage =
            StorageRoot::open(root.as_ref().join("soto.db")).map_err(|err| err.to_string())?;
        storage.ensure().map_err(|err| err.to_string())?;
        Ok(Self {
            storage,
            injector_factory,
            http_client: Arc::new(RwLock::new(default_http_client())),
        })
    }

    pub fn storage(&self) -> &StorageRoot {
        &self.storage
    }

    pub fn get_app_settings(&self) -> Result<AppSettings, String> {
        let settings = self
            .storage
            .read_settings()
            .map_err(|err| err.to_string())?;
        Ok(normalize_app_settings(settings))
    }

    pub fn save_app_settings(&self, settings: AppSettings) -> Result<AppSettings, String> {
        let settings = normalize_app_settings(settings);
        self.storage
            .write_settings(&settings)
            .map_err(|err| err.to_string())?;

        match build_http_client(settings.use_proxy) {
            Ok(new_client) => {
                *self.http_client.write().unwrap() = new_client;
                eprintln!(
                    "[soto-provider] save_app_settings: http client rebuilt (use_proxy={})",
                    settings.use_proxy
                );
            }
            Err(err) => {
                eprintln!(
                    "[soto-provider] save_app_settings: client rebuild failed, keeping old: {err}"
                );
            }
        }

        Ok(settings)
    }

    pub fn list_modes(&self) -> Result<Vec<Mode>, String> {
        self.storage
            .seed_builtin_modes()
            .map_err(|err| err.to_string())
    }

    pub fn save_mode(&self, request: SaveModeRequest) -> Result<Mode, String> {
        let mut modes = self
            .storage
            .seed_builtin_modes()
            .map_err(|err| err.to_string())?;
        let target_id = request.mode.id.clone();
        let Some(target_index) = modes.iter().position(|mode| mode.id == target_id) else {
            return Err(format!("mode not found: {target_id}"));
        };

        if let Some(incoming_hotkey) = &request.mode.hotkey
            && let Some(conflict_index) = hotkey_conflict_index(&modes, &target_id, incoming_hotkey)
        {
            let conflicting_mode_id = modes[conflict_index].id.clone();
            match request.hotkey_conflict_policy {
                HotkeyConflictPolicy::Reject => {
                    return Err(format!(
                        "hotkey conflict: {target_id} conflicts with {conflicting_mode_id}"
                    ));
                }
                HotkeyConflictPolicy::Steal => {
                    modes[conflict_index].hotkey = None;
                }
            }
        }

        modes[target_index] = request.mode.clone();
        modes.sort_by_key(|mode| mode.display_order);
        self.storage
            .write_modes(&modes)
            .map_err(|err| err.to_string())?;
        Ok(request.mode)
    }

    pub fn list_omni_configs(&self) -> Result<Vec<ProviderConfig>, String> {
        self.storage
            .read_provider_configs()
            .map_err(|err| err.to_string())
    }

    pub fn list_supported_providers(&self) -> soto_core::ProviderCatalog {
        soto_core::ProviderCatalog::builtin()
    }

    pub fn list_dictionary_entries(&self) -> Result<Vec<DictionaryEntry>, String> {
        self.storage
            .read_dictionary()
            .map_err(|err| err.to_string())
    }

    pub fn save_dictionary_entry(
        &self,
        request: SaveDictionaryEntryRequest,
    ) -> Result<DictionaryEntry, String> {
        let term = request.term.trim().to_string();
        if term.is_empty() {
            return Err("dictionary term is required".into());
        }

        let aliases = request
            .aliases
            .into_iter()
            .map(|alias| alias.trim().to_string())
            .filter(|alias| !alias.is_empty())
            .collect::<Vec<_>>();
        let note = request.note.trim().to_string();
        let now = Utc::now();
        let existing = request.id.as_ref().and_then(|entry_id| {
            self.storage
                .read_dictionary()
                .ok()?
                .into_iter()
                .find(|entry| &entry.id == entry_id)
        });

        let entry = match existing {
            Some(existing) => DictionaryEntry {
                id: existing.id,
                term,
                aliases,
                note,
                source: existing.source,
                status: existing.status,
                enabled: request.enabled,
                created_at: existing.created_at,
                updated_at: now,
                last_used_at: existing.last_used_at,
                hit_count: existing.hit_count,
            },
            None => DictionaryEntry {
                id: request.id.unwrap_or_else(new_dictionary_entry_id),
                term,
                aliases,
                note,
                source: DictionarySource::UserAdded,
                status: DictionaryStatus::Active,
                enabled: request.enabled,
                created_at: now,
                updated_at: now,
                last_used_at: None,
                hit_count: 0,
            },
        };

        self.storage
            .upsert_dictionary_entry(entry.clone())
            .map_err(|err| err.to_string())?;
        Ok(entry)
    }

    pub fn delete_dictionary_entry(&self, entry_id: &str) -> Result<(), String> {
        self.storage
            .delete_dictionary_entry(entry_id)
            .map_err(|err| err.to_string())
    }

    pub async fn complete_final_transcript_session(
        &self,
        request: CompleteFinalTranscriptRequest,
    ) -> Result<CompleteFinalTranscriptResult, String> {
        let mode = self.find_mode(&request.mode_id)?;
        let raw_text = request.raw_text.trim().to_owned();
        let target = SessionTarget {
            app: request.target_app,
            window_title: request.target_window_title,
            control_type: request.target_control_type,
        };
        let pipeline_info = self.current_provider_run_info().unwrap_or_default();
        let mut injector = self.injector_factory.create_text_injector();
        let outcome = run_final_transcript_session(
            &self.storage,
            &mode,
            FinalTranscriptRequest {
                raw_text: raw_text.clone(),
                final_text: raw_text,
                speaking_duration_ms: request.speaking_duration_ms,
                pipeline_info,
                target,
            },
            &mut injector,
        )
        .map_err(session_error_message)?;
        Ok(CompleteFinalTranscriptResult::from(outcome))
    }

    pub fn prepare_voice_session(
        &self,
        request: StartVoiceSessionRequest,
    ) -> Result<ActiveVoiceSession, VoiceSessionPrepareError> {
        let mode = self
            .find_mode(&request.mode_id)
            .map_err(VoiceSessionPrepareError::Other)?;
        let settings = self
            .get_app_settings()
            .map_err(VoiceSessionPrepareError::Other)?;
        let config_id = settings
            .active_provider_config_id
            .as_deref()
            .filter(|id| !id.trim().is_empty())
            .ok_or(VoiceSessionPrepareError::MissingProvider)?
            .to_string();
        let config = self
            .find_omni_config(&config_id)
            .map_err(VoiceSessionPrepareError::Other)?;

        Ok(ActiveVoiceSession {
            mode,
            started_at: Utc::now(),
            provider_id: config.provider_id,
            model: config.model,
            config_id,
            target_app: request.target_app,
            target_window_title: request.target_window_title,
            target_control_type: request.target_control_type,
        })
    }

    pub async fn complete_active_voice_session(
        &self,
        active: ActiveVoiceSession,
        request: CompleteVoiceSessionRequest,
    ) -> Result<CompleteFinalTranscriptResult, String> {
        let raw_text = request.raw_text.trim().to_owned();
        let final_request = final_request_from_active(&active, raw_text.clone(), raw_text);
        let mut injector = self.injector_factory.create_text_injector();
        let outcome =
            run_final_transcript_session(&self.storage, &active.mode, final_request, &mut injector)
                .map_err(session_error_message)?;

        Ok(CompleteFinalTranscriptResult::from(outcome))
    }

    pub async fn complete_active_voice_session_with_recording(
        &self,
        active: ActiveVoiceSession,
        recording: CapturedRecordingFile,
    ) -> Result<CompleteFinalTranscriptResult, String> {
        let outcome = self
            .run_voice_session_via_soto_app(&active, recording.clone())
            .await;
        // Best-effort cleanup of the recording file regardless of outcome.
        if let Err(error) = fs::remove_file(&recording.path)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            eprintln!(
                "[soto-provider] complete_recording_session: temp recording cleanup FAILED path={:?}: {error}",
                recording.path
            );
        }
        match outcome {
            Ok(result) => Ok(result),
            Err(message) => {
                eprintln!(
                    "[soto-provider] complete_recording_session: pipeline FAILED mode_id={}: {message}",
                    active.mode.id
                );
                self.fail_active_voice_session(active, message)
            }
        }
    }

    async fn run_voice_session_via_soto_app(
        &self,
        active: &ActiveVoiceSession,
        recording: CapturedRecordingFile,
    ) -> Result<CompleteFinalTranscriptResult, String> {
        // Snapshot the prompt at prepare-time: edits during the recording
        // don't affect this session.
        let prompt_snapshot = self
            .storage
            .read_prompt(&active.mode.prompt_id)
            .map_err(|err| err.to_string())?;

        let app_active = soto_app::ActiveVoiceSession {
            session_id: format!("session.{}", Uuid::new_v4()),
            mode: active.mode.clone(),
            provider_config_id: active.config_id.clone(),
            prompt_snapshot,
            locale_hint: String::new(),
            target: SessionTarget {
                app: active.target_app.clone(),
                window_title: active.target_window_title.clone(),
                control_type: active.target_control_type.clone(),
            },
        };

        // Clone the client from the shared lock — cheap: reqwest::Client is Arc-backed internally.
        let client = self.http_client.read().unwrap().clone();
        let deps =
            soto_app::SessionDeps::from_storage_with_client(Arc::new(self.storage.clone()), client);
        let injector: Box<dyn TextInjector + Send> =
            Box::new(self.injector_factory.create_text_injector());
        let outcome = soto_app::run_voice_session(&deps, app_active, recording, injector)
            .await
            .map_err(|err| err.to_string())?;
        Ok(CompleteFinalTranscriptResult::from(outcome))
    }

    pub fn cancel_voice_session(
        &self,
        request: CancelVoiceSessionRequest,
    ) -> Result<CompleteFinalTranscriptResult, String> {
        let mode = self.find_mode(&request.mode_id)?;
        let outcome = record_cancelled_session(
            &self.storage,
            &mode,
            FinalTranscriptRequest {
                raw_text: String::new(),
                final_text: String::new(),
                speaking_duration_ms: request.speaking_duration_ms,
                pipeline_info: self.current_provider_run_info().unwrap_or_default(),
                target: SessionTarget {
                    app: request.target_app,
                    window_title: request.target_window_title,
                    control_type: request.target_control_type,
                },
            },
        )
        .map_err(session_error_message)?;

        Ok(CompleteFinalTranscriptResult::from(outcome))
    }

    pub fn cancel_active_voice_session(
        &self,
        active: ActiveVoiceSession,
    ) -> Result<CompleteFinalTranscriptResult, String> {
        let final_request = final_request_from_active(&active, String::new(), String::new());
        let outcome = record_cancelled_session(&self.storage, &active.mode, final_request)
            .map_err(session_error_message)?;

        Ok(CompleteFinalTranscriptResult::from(outcome))
    }

    pub fn fail_active_voice_session(
        &self,
        active: ActiveVoiceSession,
        message: String,
    ) -> Result<CompleteFinalTranscriptResult, String> {
        let final_request = final_request_from_active(&active, String::new(), String::new());
        let outcome = record_failed_session(&self.storage, &active.mode, final_request, message)
            .map_err(session_error_message)?;

        Ok(CompleteFinalTranscriptResult::from(outcome))
    }

    pub fn create_omni_config(
        &self,
        request: CreateOmniConfigRequest,
    ) -> Result<ProviderConfig, String> {
        self.save_omni_config(SaveOmniConfigRequest {
            config_id: None,
            provider_id: request.provider_id,
            display_name: request.display_name,
            model: request.model,
            base_url: request.base_url,
            api_key: request.api_key,
            is_default: request.is_default,
        })
    }

    pub fn save_omni_config(
        &self,
        request: SaveOmniConfigRequest,
    ) -> Result<ProviderConfig, String> {
        let now = Utc::now();
        let (config_id, created_at) = match request.config_id {
            Some(config_id) => {
                let existing = self.find_omni_config(&config_id)?;
                (config_id, existing.created_at)
            }
            None => (new_config_id(), now),
        };
        let provider_id = request.provider_id.trim().to_ascii_lowercase();
        let provider_meta = soto_core::ProviderCatalog::builtin()
            .providers
            .into_iter()
            .find(|provider| provider.provider_id == provider_id)
            .ok_or_else(|| format!("Unsupported Omni provider: {provider_id}"))?;
        let model = match request.model.trim() {
            "" => provider_meta
                .default_model
                .clone()
                .ok_or_else(|| format!("Model is required for provider '{provider_id}'"))?,
            value => value.to_owned(),
        };
        let record = ProviderConfig {
            config_id: config_id.clone(),
            provider_id,
            display_name: request.display_name,
            model,
            base_url: request.base_url,
            is_default: request.is_default,
            validation: empty_validation(),
            created_at,
            updated_at: now,
        };

        self.storage
            .upsert_provider_config(record.clone())
            .map_err(|err| err.to_string())?;
        self.upsert_secret_if_present(&config_id, "api_key", request.api_key)?;
        if request.is_default {
            self.write_active_provider_config(Some(config_id))?;
        }

        Ok(record)
    }

    pub fn set_default_omni_config(&self, config_id: &str) -> Result<(), String> {
        let mut configs = self
            .storage
            .read_provider_configs()
            .map_err(|err| err.to_string())?;
        let mut found = false;
        for config in &mut configs {
            let is_target = config.config_id == config_id;
            config.is_default = is_target;
            if is_target {
                found = true;
            }
        }
        if !found {
            return Err(format!("provider config not found: {config_id}"));
        }
        self.storage
            .write_provider_configs(&configs)
            .map_err(|err| err.to_string())?;
        self.write_active_provider_config(Some(config_id.to_string()))
    }

    pub async fn test_omni_provider(
        &self,
        request: TestProviderRequest,
    ) -> Result<ProviderTestResult, String> {
        let config = self.find_omni_config(&request.config_id)?;
        let secrets = self
            .storage
            .read_provider_secrets(&request.config_id)
            .map_err(|err| err.to_string())?;
        let omni_config = omni_config_from_record(&config, &secrets);
        let started_at = std::time::Instant::now();
        let result = match omni::build_omni_provider(&omni_config) {
            Ok(provider) => provider.validate(&omni_config).await,
            Err(error) => Err(error),
        };
        let latency_ms = started_at.elapsed().as_millis().min(u128::from(u32::MAX)) as u32;
        let (status, note) = match &result {
            Ok(()) => (
                ValidationStatus::Ok,
                "Omni provider responded to validation request.".to_string(),
            ),
            Err(error) => (
                validation_status_for_provider_error(error.error),
                error.message.clone(),
            ),
        };
        self.storage
            .update_provider_validation(
                &request.config_id,
                ProviderConfigValidation {
                    last_validated_at: Some(Utc::now()),
                    last_validated_latency_ms: Some(latency_ms),
                    last_validated_status: status.clone(),
                    last_validated_note: Some(note.clone()),
                    last_validated_sample: request.sample.clone(),
                    last_validated_sample_result: None,
                },
            )
            .map_err(|err| err.to_string())?;
        Ok(ProviderTestResult {
            config_id: request.config_id,
            status,
            note,
            latency_ms,
        })
    }

    fn write_active_provider_config(&self, config_id: Option<String>) -> Result<(), String> {
        let mut settings = self
            .storage
            .read_settings()
            .map_err(|err| err.to_string())?;
        settings.active_provider_config_id = config_id;
        self.storage
            .write_settings(&settings)
            .map_err(|err| err.to_string())
    }

    fn upsert_secret_if_present(
        &self,
        config_id: &str,
        key: &str,
        value: Option<String>,
    ) -> Result<(), String> {
        if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
            self.storage
                .upsert_provider_secret(config_id, key, value.trim())
                .map_err(|err| err.to_string())?;
        }
        Ok(())
    }

    fn find_omni_config(&self, config_id: &str) -> Result<ProviderConfig, String> {
        self.storage
            .read_provider_configs()
            .map_err(|err| err.to_string())?
            .into_iter()
            .find(|config| config.config_id == config_id)
            .ok_or_else(|| format!("omni provider config not found: {config_id}"))
    }

    fn find_mode(&self, mode_id: &str) -> Result<Mode, String> {
        self.storage
            .seed_builtin_modes()
            .map_err(|err| err.to_string())?
            .into_iter()
            .find(|mode| mode.id == mode_id)
            .ok_or_else(|| format!("mode not found: {mode_id}"))
    }

    fn current_provider_run_info(&self) -> Result<PipelineRunInfo, String> {
        let settings = self.get_app_settings()?;
        let Some(config_id) = settings.active_provider_config_id else {
            return Ok(PipelineRunInfo::default());
        };
        let config = self.find_omni_config(&config_id)?;
        Ok(PipelineRunInfo {
            provider_id: Some(config.provider_id),
            model_id: Some(config.model),
        })
    }
}

impl From<SessionRunOutcome> for CompleteFinalTranscriptResult {
    fn from(outcome: SessionRunOutcome) -> Self {
        Self {
            history_id: outcome.history_id,
            raw_text: outcome.raw_text,
            processed_text: outcome.processed_text,
            final_text: outcome.final_text,
            status: outcome.status,
            injection_outcome: outcome.injection_outcome,
            empty_reason: outcome.empty_reason,
        }
    }
}

fn new_config_id() -> String {
    format!("config.{}", Uuid::new_v4())
}

fn new_dictionary_entry_id() -> String {
    format!("dict.{}", Uuid::new_v4())
}

fn empty_validation() -> ProviderConfigValidation {
    ProviderConfigValidation {
        last_validated_at: None,
        last_validated_latency_ms: None,
        last_validated_status: ValidationStatus::Unspecified,
        last_validated_note: None,
        last_validated_sample: None,
        last_validated_sample_result: None,
    }
}

fn hotkey_conflict_index(
    modes: &[Mode],
    target_mode_id: &str,
    incoming: &HotkeyBinding,
) -> Option<usize> {
    modes.iter().position(|mode| {
        mode.id != target_mode_id
            && mode
                .hotkey
                .as_ref()
                .is_some_and(|existing| chords_conflict(&existing.chord, &incoming.chord))
    })
}

fn chords_conflict(left: &soto_keyboard_hook::Chord, right: &soto_keyboard_hook::Chord) -> bool {
    left.modifier() == right.modifier()
}

fn final_request_from_active(
    active: &ActiveVoiceSession,
    raw_text: String,
    final_text: String,
) -> FinalTranscriptRequest {
    FinalTranscriptRequest {
        raw_text,
        final_text,
        speaking_duration_ms: session_duration_ms(active.started_at),
        pipeline_info: PipelineRunInfo {
            provider_id: Some(active.provider_id.clone()),
            model_id: Some(active.model.clone()),
        },
        target: SessionTarget {
            app: active.target_app.clone(),
            window_title: active.target_window_title.clone(),
            control_type: active.target_control_type.clone(),
        },
    }
}

fn session_duration_ms(started_at: chrono::DateTime<Utc>) -> u64 {
    Utc::now()
        .signed_duration_since(started_at)
        .num_milliseconds()
        .max(0) as u64
}

fn session_error_message(error: SessionError) -> String {
    match error {
        SessionError::Storage(error) => error,
    }
}

fn omni_config_from_record(
    config: &ProviderConfig,
    secrets: &BTreeMap<String, String>,
) -> OmniConfig {
    OmniConfig {
        provider_id: config.provider_id.clone(),
        api_key: secrets.get("api_key").cloned().unwrap_or_default(),
        model: config.model.clone(),
        base_url: config.base_url.clone().unwrap_or_default(),
    }
}

fn normalize_app_settings(mut settings: AppSettings) -> AppSettings {
    if !matches!(settings.theme.as_str(), "system" | "light" | "dark") {
        settings.theme = "system".to_string();
    }
    settings
}

fn validation_status_for_provider_error(error: ProviderError) -> ValidationStatus {
    match error {
        ProviderError::InvalidConfiguration => ValidationStatus::Warn,
        ProviderError::AuthenticationFailed
        | ProviderError::RateLimited
        | ProviderError::ServiceUnavailable
        | ProviderError::RequestFailed
        | ProviderError::EmptyResponse => ValidationStatus::Err,
    }
}

#[cfg(test)]
mod chord_conflict_tests {
    use super::chords_conflict;
    use soto_keyboard_hook::Chord;

    fn c(s: &str) -> Chord {
        Chord::parse(s).unwrap()
    }

    #[test]
    fn same_modifier_conflicts() {
        assert!(chords_conflict(&c("RightAlt"), &c("RightAlt")));
        assert!(chords_conflict(&c("RightMeta"), &c("RightMeta")));
    }

    #[test]
    fn different_modifiers_do_not_conflict() {
        assert!(!chords_conflict(&c("RightAlt"), &c("LeftAlt")));
        assert!(!chords_conflict(&c("RightMeta"), &c("RightShift")));
    }
}
