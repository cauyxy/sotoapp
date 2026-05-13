use chrono::Utc;
pub use soto_core::SessionTarget;
use soto_core::{
    EmptyReason, HistoryRecord, InjectionOutcome, Mode, SelectionBehavior, SessionStatus,
};
use soto_storage::StorageRoot;
use uuid::Uuid;

pub trait TextInjector {
    fn inject(&mut self, text: &str, selection_behavior: SelectionBehavior) -> InjectionOutcome;
}

#[cfg(feature = "injection")]
impl<T> TextInjector for T
where
    T: soto_injection::InjectionEnvironment,
{
    fn inject(&mut self, text: &str, selection_behavior: SelectionBehavior) -> InjectionOutcome {
        soto_injection::inject_text(self, text, selection_behavior)
    }
}

/// Identifiers recorded for a session for the history log. Set by the
/// orchestration layer (`soto-tauri::provider_backend`) which knows which
/// provider config was resolved.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PipelineRunInfo {
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FinalTranscriptRequest {
    pub raw_text: String,
    pub final_text: String,
    pub speaking_duration_ms: u64,
    pub pipeline_info: PipelineRunInfo,
    pub target: SessionTarget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionRunOutcome {
    pub history_id: String,
    pub raw_text: String,
    pub processed_text: Option<String>,
    pub final_text: String,
    pub status: SessionStatus,
    pub injection_outcome: InjectionOutcome,
    pub empty_reason: Option<EmptyReason>,
}

#[derive(Debug)]
pub enum SessionError {
    Storage(String),
}

pub fn run_final_transcript_session(
    storage: &StorageRoot,
    mode: &Mode,
    request: FinalTranscriptRequest,
    injector: &mut dyn TextInjector,
) -> Result<SessionRunOutcome, SessionError> {
    let settings = storage
        .read_settings()
        .map_err(|error| SessionError::Storage(error.to_string()))?;

    let raw_text = request.raw_text.trim().to_owned();
    let final_text = request.final_text.trim().to_owned();

    if raw_text.is_empty() {
        return Ok(discarded_session_outcome(
            SessionStatus::Empty,
            InjectionOutcome::NoOp,
            Some(EmptyReason::NoRecognition),
        ));
    }

    let processed_text = if final_text == raw_text {
        None
    } else {
        Some(final_text.clone())
    };
    let injection_outcome =
        injector.inject(&final_text, SelectionBehavior::ReplaceSelectionWhenPresent);

    let status = session_status_for(&raw_text, &injection_outcome);
    let record = history_record(
        mode,
        request,
        settings.store_target_metadata,
        raw_text,
        processed_text,
        final_text,
        status.clone(),
        injection_outcome,
    );
    if settings.history_enabled {
        storage
            .append_history(&record)
            .map_err(|error| SessionError::Storage(error.to_string()))?;
    }

    Ok(SessionRunOutcome {
        history_id: record.id,
        raw_text: record.raw_text,
        processed_text: record.processed_text,
        final_text: record.final_text,
        status: record.status,
        injection_outcome: record.injection_outcome,
        empty_reason: None,
    })
}

pub fn record_cancelled_session(
    _storage: &StorageRoot,
    _mode: &Mode,
    _request: FinalTranscriptRequest,
) -> Result<SessionRunOutcome, SessionError> {
    Ok(discarded_session_outcome(
        SessionStatus::Cancelled,
        InjectionOutcome::NoOp,
        None,
    ))
}

pub fn record_failed_session(
    storage: &StorageRoot,
    mode: &Mode,
    request: FinalTranscriptRequest,
    message: String,
) -> Result<SessionRunOutcome, SessionError> {
    record_terminal_session(
        storage,
        mode,
        request,
        SessionStatus::Failed,
        InjectionOutcome::Failed(message),
    )
}

fn record_terminal_session(
    storage: &StorageRoot,
    mode: &Mode,
    request: FinalTranscriptRequest,
    status: SessionStatus,
    injection_outcome: InjectionOutcome,
) -> Result<SessionRunOutcome, SessionError> {
    let settings = storage
        .read_settings()
        .map_err(|error| SessionError::Storage(error.to_string()))?;
    let raw_text = request.raw_text.trim().to_owned();
    let final_text = request.final_text.trim().to_owned();

    if raw_text.is_empty() && final_text.is_empty() {
        let reason = if status == SessionStatus::Empty {
            Some(EmptyReason::NoRecognition)
        } else {
            None
        };
        return Ok(discarded_session_outcome(status, injection_outcome, reason));
    }

    let final_text = if final_text.is_empty() {
        raw_text.clone()
    } else {
        final_text
    };
    let processed_text = if final_text == raw_text {
        None
    } else {
        Some(final_text.clone())
    };

    let record = history_record(
        mode,
        request,
        settings.store_target_metadata,
        raw_text,
        processed_text,
        final_text,
        status,
        injection_outcome,
    );
    if settings.history_enabled {
        storage
            .append_history(&record)
            .map_err(|error| SessionError::Storage(error.to_string()))?;
    }

    Ok(SessionRunOutcome {
        history_id: record.id,
        raw_text: record.raw_text,
        processed_text: record.processed_text,
        final_text: record.final_text,
        status: record.status,
        injection_outcome: record.injection_outcome,
        empty_reason: None,
    })
}

fn discarded_session_outcome(
    status: SessionStatus,
    injection_outcome: InjectionOutcome,
    empty_reason: Option<EmptyReason>,
) -> SessionRunOutcome {
    SessionRunOutcome {
        history_id: String::new(),
        raw_text: String::new(),
        processed_text: None,
        final_text: String::new(),
        status,
        injection_outcome,
        empty_reason,
    }
}

/// Public helper for callers (e.g. `soto-app`) that need to short-circuit a
/// session before the provider runs and want a typed `EmptyReason` recorded.
pub fn empty_session_outcome(reason: EmptyReason) -> SessionRunOutcome {
    discarded_session_outcome(SessionStatus::Empty, InjectionOutcome::NoOp, Some(reason))
}

fn session_status_for(raw_text: &str, injection_outcome: &InjectionOutcome) -> SessionStatus {
    if raw_text.is_empty() {
        return SessionStatus::Empty;
    }
    if matches!(injection_outcome, InjectionOutcome::Failed(_)) {
        SessionStatus::Failed
    } else {
        SessionStatus::Completed
    }
}

#[allow(clippy::too_many_arguments)]
fn history_record(
    mode: &Mode,
    request: FinalTranscriptRequest,
    store_target_metadata: bool,
    raw_text: String,
    processed_text: Option<String>,
    final_text: String,
    status: SessionStatus,
    injection_outcome: InjectionOutcome,
) -> HistoryRecord {
    let target = if store_target_metadata {
        request.target
    } else {
        SessionTarget {
            app: String::new(),
            window_title: String::new(),
            control_type: String::new(),
        }
    };

    HistoryRecord {
        id: format!("history.{}", Uuid::new_v4()),
        created_at: Utc::now(),
        raw_text,
        processing_mode: mode.id.clone(),
        processed_text,
        char_count: final_text.chars().count() as u32,
        final_text,
        status,
        injection_outcome,
        speaking_duration_ms: request.speaking_duration_ms,
        target_app: target.app,
        target_window_title: target.window_title,
        target_control_type: target.control_type,
        provider_id: request.pipeline_info.provider_id,
        model_id: request.pipeline_info.model_id,
    }
}
