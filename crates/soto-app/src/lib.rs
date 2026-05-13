//! Soto orchestration layer.
//!
//! Hosts the platform-free pipeline that turns a recording + active mode +
//! provider config into a final transcript that gets injected and recorded.
//! No Tauri / OS dependencies — `soto-tauri` is the shell.
//!
//! Phase F scope: define the orchestration trait surface (`SessionDeps`,
//! `ActiveVoiceSession`, `prepare_voice_session` / `run_voice_session` /
//! `abort_voice_session`). The implementation delegates to `soto-session` and
//! `soto-providers` directly; the soto-tauri shell will adopt these entry
//! points incrementally so the rewrite stays bounded.

use std::sync::Arc;

use soto_audio::{CapturedRecordingFile, RecordingFile, analyze_recording};
use soto_core::{
    EmptyReason, Mode, SessionTarget,
    stores::{
        DictionaryStore, HistoryStore, ModeStore, ProviderConfigStore, ProviderSecretsStore,
        SettingsStore, StoreError, active_hotword_terms,
    },
};
use soto_prompt::{PromptDocument, PromptError, PromptStore, build_voice_prompt};
use soto_provider::{
    DefaultProviderFactory, ProviderFactory, ProviderResponse, errors::ProviderException,
    omni::chat_completions::default_http_client,
};
use soto_session::{
    FinalTranscriptRequest, PipelineRunInfo, SessionError, SessionRunOutcome, TextInjector,
    empty_session_outcome, run_final_transcript_session,
};
use soto_storage::StorageRoot;
use thiserror::Error;

/// Aggregated store handles + provider factory used by every voice-session entrypoint.
///
/// All stores are `Arc<dyn Trait + Send + Sync>` so SessionDeps can be cloned
/// into `spawn_blocking` closures without lifetime drama. The same handle (in
/// production: an `Arc<SqliteStorage>`) implements every trait.
#[derive(Clone)]
pub struct SessionDeps {
    pub prompts: Arc<dyn PromptStore>,
    pub modes: Arc<dyn ModeStore>,
    pub dictionary: Arc<dyn DictionaryStore>,
    pub provider_configs: Arc<dyn ProviderConfigStore>,
    pub provider_secrets: Arc<dyn ProviderSecretsStore>,
    pub history: Arc<dyn HistoryStore>,
    pub settings: Arc<dyn SettingsStore>,
    pub provider_factory: Arc<dyn ProviderFactory>,
    pub storage: Arc<StorageRoot>,
}

impl SessionDeps {
    /// Production path: accept a pre-built shared HTTP client so the
    /// connection pool is reused across voice sessions.
    pub fn from_storage_with_client(storage: Arc<StorageRoot>, client: reqwest::Client) -> Self {
        Self {
            prompts: storage.clone() as Arc<dyn PromptStore>,
            modes: storage.clone() as Arc<dyn ModeStore>,
            dictionary: storage.clone() as Arc<dyn DictionaryStore>,
            provider_configs: storage.clone() as Arc<dyn ProviderConfigStore>,
            provider_secrets: storage.clone() as Arc<dyn ProviderSecretsStore>,
            history: storage.clone() as Arc<dyn HistoryStore>,
            settings: storage.clone() as Arc<dyn SettingsStore>,
            provider_factory: Arc::new(DefaultProviderFactory::new(client))
                as Arc<dyn ProviderFactory>,
            storage,
        }
    }

    /// Test/convenience path: creates a default HTTP client internally.
    /// Callers that immediately call `with_provider_factory` don't use the client.
    pub fn from_storage(storage: Arc<StorageRoot>) -> Self {
        Self::from_storage_with_client(storage, default_http_client())
    }

    /// Test-time / dependency-injection seam: swap in a custom factory (e.g. a
    /// `MockProviderFactory` that returns a `MockProvider`).
    pub fn with_provider_factory(mut self, factory: Arc<dyn ProviderFactory>) -> Self {
        self.provider_factory = factory;
        self
    }
}

/// Session lifecycle state. Returned by `prepare_voice_session` and consumed by
/// `run_voice_session` / `abort_voice_session`.
#[derive(Debug, Clone)]
pub struct ActiveVoiceSession {
    pub session_id: String,
    pub mode: Mode,
    pub provider_config_id: String,
    /// Prompt body frozen at prepare time; later edits don't affect this session.
    pub prompt_snapshot: PromptDocument,
    pub locale_hint: String,
    pub target: SessionTarget,
}

#[derive(Debug, Clone)]
pub struct PrepareVoiceSessionRequest {
    pub mode_id: String,
    pub provider_config_id: Option<String>,
    pub locale_hint: String,
    pub target: SessionTarget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AbortReason {
    UserCancelled,
    HotkeyReleased,
    Timeout,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("prompt error: {0}")]
    Prompt(#[from] PromptError),
    #[error("session error: {0:?}")]
    Session(SessionError),
    #[error("provider error: {0}")]
    Provider(String),
    #[error("active provider config missing")]
    ProviderConfigGone,
    #[error("no active provider config selected")]
    NoActiveProviderConfig,
    #[error("join error: {0}")]
    Join(String),
}

impl From<SessionError> for AppError {
    fn from(value: SessionError) -> Self {
        Self::Session(value)
    }
}

impl From<ProviderException> for AppError {
    fn from(value: ProviderException) -> Self {
        Self::Provider(value.message)
    }
}

/// Minimum recording duration before we bother asking the speech provider.
/// Anything shorter is almost certainly an accidental hotkey tap; gating these
/// saves the provider round-trip and surfaces a re-record hint.
// TODO: move to AppSettings so it's tunable per install.
const MIN_RECORDING_MS: u64 = 300;

/// Peak amplitude (linear, range [0.0, 1.0]) below which we treat the whole
/// recording as silent. 0.003 is about -50 dBFS, quiet enough that it almost
/// certainly contained no usable speech.
// TODO: move to AppSettings.
const SILENCE_PEAK_THRESHOLD: f32 = 0.003;

/// Prepare a voice session: snapshot the mode + prompt body, resolve the active
/// provider config id, mint a session id.
pub fn prepare_voice_session(
    deps: &SessionDeps,
    request: PrepareVoiceSessionRequest,
) -> Result<ActiveVoiceSession, AppError> {
    let mode = deps.modes.get(&request.mode_id)?;
    let prompt_snapshot = deps.prompts.get(&mode.prompt_id)?;

    let provider_config_id = match request.provider_config_id {
        Some(id) => id,
        None => deps
            .settings
            .read()?
            .active_provider_config_id
            .ok_or(AppError::NoActiveProviderConfig)?,
    };

    let session_id = uuid::Uuid::new_v4().to_string();

    Ok(ActiveVoiceSession {
        session_id,
        mode,
        provider_config_id,
        prompt_snapshot,
        locale_hint: request.locale_hint,
        target: request.target,
    })
}

/// Run a voice session end-to-end: provider invocation + finalisation + history
/// write + text injection. The injector is moved in so it can be dropped when
/// the session ends.
pub async fn run_voice_session(
    deps: &SessionDeps,
    active: ActiveVoiceSession,
    recording: CapturedRecordingFile,
    mut injector: Box<dyn TextInjector + Send>,
) -> Result<SessionRunOutcome, AppError> {
    // Blocking section #1: load provider config + secrets + hotwords.
    let provider_config_id = active.provider_config_id.clone();
    let provider_configs = Arc::clone(&deps.provider_configs);
    let provider_secrets = Arc::clone(&deps.provider_secrets);
    let dictionary = Arc::clone(&deps.dictionary);

    let (config, secrets, hotwords) = tokio::task::spawn_blocking(move || {
        let config = provider_configs
            .get(&provider_config_id)
            .map_err(|err| match err {
                StoreError::NotFound(_) => AppError::ProviderConfigGone,
                other => AppError::Store(other),
            })?;
        let secrets = provider_secrets.get(&provider_config_id)?;
        let entries = dictionary.list()?;
        let hotwords = active_hotword_terms(&entries);
        Ok::<_, AppError>((config, secrets, hotwords))
    })
    .await
    .map_err(|err| AppError::Join(err.to_string()))??;

    // Sync pure functions.
    let voice_prompt = build_voice_prompt(&active.prompt_snapshot, &hotwords);
    let recording_file: RecordingFile = (&recording).into();

    // Pre-flight: short-circuit if the recording is too short or silent so we
    // never bill the provider for nothing.
    if recording.duration_ms < MIN_RECORDING_MS {
        return Ok(empty_session_outcome(EmptyReason::TooShort));
    }
    let stats = analyze_recording(&recording)
        .map_err(|err| AppError::Provider(format!("recording analysis failed: {err}")))?;
    if stats.peak < SILENCE_PEAK_THRESHOLD {
        return Ok(empty_session_outcome(EmptyReason::Silent));
    }

    // Async: provider invoke via the factory + trait.
    let provider = deps.provider_factory.build(&config, &secrets)?;
    let response: ProviderResponse = provider.invoke(voice_prompt, &recording_file).await?;

    // Blocking section #2: finalize + write history + inject.
    let storage = deps.storage.clone();
    let mode = active.mode.clone();
    let target = active.target.clone();
    let recording_duration_ms = recording.duration_ms;

    let outcome = tokio::task::spawn_blocking(move || {
        let request = FinalTranscriptRequest {
            raw_text: response.raw_text,
            final_text: response.final_text,
            speaking_duration_ms: recording_duration_ms,
            pipeline_info: PipelineRunInfo {
                provider_id: Some(response.provider_id),
                model_id: Some(response.model_id),
            },
            target,
        };
        run_final_transcript_session(&storage, &mode, request, injector.as_mut())
            .map_err(AppError::from)
    })
    .await
    .map_err(|err| AppError::Join(err.to_string()))??;

    Ok(outcome)
}

/// Abort an in-flight voice session. Currently a no-op past the storage state
/// (cancelled session records are handled by the existing
/// `record_cancelled_session` in `soto-session`); the future SQLite version
/// will write a session-cancelled history row inside this function.
pub fn abort_voice_session(
    _deps: &SessionDeps,
    active: ActiveVoiceSession,
    _reason: AbortReason,
) -> Result<ActiveVoiceSession, AppError> {
    Ok(active)
}
