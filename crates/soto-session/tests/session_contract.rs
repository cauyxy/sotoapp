use soto_core::{
    EmptyReason, HistoryRecord, InjectionOutcome, Mode, SelectionBehavior, SessionStatus,
};
use soto_session::{
    FinalTranscriptRequest, PipelineRunInfo, SessionTarget, TextInjector, record_cancelled_session,
    record_failed_session, run_final_transcript_session,
};
use soto_storage::StorageRoot;

#[test]
fn run_final_transcript_session_injects_final_text_and_records_history() {
    let temp = tempfile::tempdir().unwrap();
    let storage = prepared_storage(temp.path());
    let mode = default_mode("Polish {text}");
    let mut injector = RecordingInjector::inserted();

    let outcome = run_final_transcript_session(
        &storage,
        &mode,
        final_request("hello soto", "polished hello soto"),
        &mut injector,
    )
    .unwrap();

    assert_eq!(outcome.final_text, "polished hello soto");
    assert_eq!(injector.injected_texts, ["polished hello soto"]);
    assert_eq!(outcome.status, SessionStatus::Completed);

    let history = storage.read_history().unwrap();
    assert_eq!(history.len(), 1);
    let record = &history[0];
    assert_eq!(record.raw_text, "hello soto");
    assert_eq!(record.final_text, "polished hello soto");
    assert_eq!(
        record.processed_text.as_deref(),
        Some("polished hello soto")
    );
    assert_eq!(record.provider_id.as_deref(), Some("mimo-plan-sea"));
    assert_eq!(record.model_id.as_deref(), Some("mimo-v2.5"));
    assert_eq!(record.injection_outcome, InjectionOutcome::Inserted);
}

#[test]
fn run_final_transcript_session_passthrough_when_final_equals_raw() {
    let temp = tempfile::tempdir().unwrap();
    let storage = prepared_storage(temp.path());
    let mode = default_mode("");
    let mut injector = RecordingInjector::inserted();

    let outcome = run_final_transcript_session(
        &storage,
        &mode,
        final_request("hello soto", "hello soto"),
        &mut injector,
    )
    .unwrap();

    assert_eq!(outcome.final_text, "hello soto");
    assert_eq!(outcome.processed_text, None);
    assert_eq!(outcome.status, SessionStatus::Completed);
}

#[test]
fn empty_raw_text_discards_history_and_skips_injection() {
    let temp = tempfile::tempdir().unwrap();
    let storage = prepared_storage(temp.path());
    let mode = default_mode("Polish {text}");
    let mut injector = RecordingInjector::inserted();

    let outcome =
        run_final_transcript_session(&storage, &mode, final_request("   ", ""), &mut injector)
            .unwrap();

    assert_eq!(outcome.status, SessionStatus::Empty);
    assert_eq!(outcome.empty_reason, Some(EmptyReason::NoRecognition));
    assert_eq!(outcome.history_id, "");
    assert!(injector.injected_texts.is_empty());
    assert_eq!(outcome.injection_outcome, InjectionOutcome::NoOp);

    let history = storage.read_history().unwrap();
    assert!(history.is_empty());
}

#[test]
fn record_cancelled_session_discards_history() {
    let temp = tempfile::tempdir().unwrap();
    let storage = prepared_storage(temp.path());
    let mode = default_mode("Polish {text}");

    let outcome = record_cancelled_session(&storage, &mode, final_request("", "")).unwrap();
    assert_eq!(outcome.status, SessionStatus::Cancelled);
    assert_eq!(outcome.history_id, "");

    let history = storage.read_history().unwrap();
    assert!(history.is_empty());
}

#[test]
fn record_failed_session_without_text_discards_history_but_returns_failure() {
    let temp = tempfile::tempdir().unwrap();
    let storage = prepared_storage(temp.path());
    let mode = default_mode("Polish {text}");

    let outcome =
        record_failed_session(&storage, &mode, final_request("", ""), "asr_failed".into()).unwrap();
    assert_eq!(outcome.status, SessionStatus::Failed);
    assert_eq!(outcome.history_id, "");
    assert!(matches!(
        outcome.injection_outcome,
        InjectionOutcome::Failed(ref msg) if msg == "asr_failed"
    ));

    let history = storage.read_history().unwrap();
    assert!(history.is_empty());
}

#[test]
fn record_failed_session_with_text_records_failure_history() {
    let temp = tempfile::tempdir().unwrap();
    let storage = prepared_storage(temp.path());
    let mode = default_mode("Polish {text}");

    let outcome = record_failed_session(
        &storage,
        &mode,
        final_request("hello soto", "hello soto"),
        "injection_failed".into(),
    )
    .unwrap();
    assert_eq!(outcome.status, SessionStatus::Failed);
    assert_ne!(outcome.history_id, "");

    let history = storage.read_history().unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].raw_text, "hello soto");
    assert_eq!(history[0].final_text, "hello soto");
    assert_eq!(history[0].status, SessionStatus::Failed);
    assert!(matches!(
        history[0].injection_outcome,
        InjectionOutcome::Failed(ref msg) if msg == "injection_failed"
    ));
}

fn prepared_storage(path: &std::path::Path) -> StorageRoot {
    let storage = StorageRoot::new(path);
    storage.ensure().expect("ensure storage");
    storage
}

fn default_mode(_prompt: &str) -> Mode {
    Mode {
        id: "default".into(),
        name: "Default".into(),
        hotkey: None,
        display_order: 1,
        built_in: true,
        prompt_id: "default".into(),
    }
}

fn final_request(raw: &str, final_text: &str) -> FinalTranscriptRequest {
    FinalTranscriptRequest {
        raw_text: raw.into(),
        final_text: final_text.into(),
        speaking_duration_ms: 1200,
        pipeline_info: PipelineRunInfo {
            provider_id: Some("mimo-plan-sea".into()),
            model_id: Some("mimo-v2.5".into()),
        },
        target: SessionTarget {
            app: "Notes".into(),
            window_title: "Draft".into(),
            control_type: "text".into(),
        },
    }
}

#[allow(dead_code)]
fn assert_completed_record(
    record: &HistoryRecord,
    raw_text: &str,
    processed_text: Option<&str>,
    final_text: &str,
) {
    assert_eq!(record.raw_text, raw_text);
    assert_eq!(record.processed_text.as_deref(), processed_text);
    assert_eq!(record.final_text, final_text);
    assert_eq!(record.status, SessionStatus::Completed);
}

struct RecordingInjector {
    injected_texts: Vec<String>,
    next_outcome: InjectionOutcome,
}

impl RecordingInjector {
    fn inserted() -> Self {
        Self {
            injected_texts: Vec::new(),
            next_outcome: InjectionOutcome::Inserted,
        }
    }
}

impl TextInjector for RecordingInjector {
    fn inject(&mut self, text: &str, _selection_behavior: SelectionBehavior) -> InjectionOutcome {
        self.injected_texts.push(text.to_string());
        self.next_outcome.clone()
    }
}
