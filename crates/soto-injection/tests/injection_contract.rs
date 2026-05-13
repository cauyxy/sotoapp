use soto_core::{InjectionOutcome, SelectionBehavior};
use soto_injection::{
    Clipboard, InjectionEnvironment, NativeInsert, NativeInsertStatus, PasteSender, inject_text,
};

#[test]
fn native_insertion_is_preferred_before_clipboard_paths() {
    let mut env = RecordingEnvironment {
        native_status: NativeInsertStatus::Inserted,
        clipboard: "original clipboard".into(),
        paste_status: Ok(()),
        ..RecordingEnvironment::default()
    };

    let outcome = inject_text(
        &mut env,
        "hello",
        SelectionBehavior::ReplaceSelectionWhenPresent,
    );

    assert_eq!(outcome, InjectionOutcome::Inserted);
    assert_eq!(env.native_calls, ["hello"]);
    assert!(env.clipboard_sets.is_empty());
    assert!(!env.paste_sent);
    assert_eq!(env.clipboard, "original clipboard");
}

#[test]
fn clipboard_paste_saves_sets_pastes_and_restores_original_clipboard() {
    let mut env = RecordingEnvironment {
        native_status: NativeInsertStatus::Unsupported,
        clipboard: "original clipboard".into(),
        paste_status: Ok(()),
        ..RecordingEnvironment::default()
    };

    let outcome = inject_text(&mut env, "dictated text", SelectionBehavior::AlwaysAppend);

    assert_eq!(outcome, InjectionOutcome::PasteSent);
    assert_eq!(env.native_calls, ["dictated text"]);
    assert_eq!(
        env.clipboard_sets,
        ["dictated text".to_owned(), "original clipboard".to_owned()]
    );
    assert!(env.paste_sent);
    assert_eq!(env.clipboard, "original clipboard");
}

#[test]
fn clipboard_only_fallback_leaves_text_on_clipboard_when_paste_cannot_be_sent() {
    let mut env = RecordingEnvironment {
        native_status: NativeInsertStatus::Unsupported,
        clipboard: "original clipboard".into(),
        paste_status: Err("paste hotkey denied".into()),
        ..RecordingEnvironment::default()
    };

    let outcome = inject_text(
        &mut env,
        "fallback text",
        SelectionBehavior::ReplaceSelectionWhenPresent,
    );

    assert_eq!(outcome, InjectionOutcome::CopiedFallback);
    assert_eq!(env.clipboard_sets, ["fallback text".to_owned()]);
    assert_eq!(env.clipboard, "fallback text");
}

#[test]
fn native_failure_still_attempts_clipboard_paste() {
    let mut env = RecordingEnvironment {
        native_status: NativeInsertStatus::Failed("ax permission missing".into()),
        clipboard: "original".into(),
        paste_status: Ok(()),
        ..RecordingEnvironment::default()
    };

    let outcome = inject_text(
        &mut env,
        "fallback through paste",
        SelectionBehavior::ReplaceSelectionWhenPresent,
    );

    assert_eq!(outcome, InjectionOutcome::PasteSent);
    assert_eq!(
        env.clipboard_sets,
        ["fallback through paste".to_owned(), "original".to_owned()]
    );
    assert_eq!(env.clipboard, "original");
}

#[test]
fn empty_text_is_noop_and_does_not_touch_platform_state() {
    let mut env = RecordingEnvironment {
        native_status: NativeInsertStatus::Inserted,
        clipboard: "original".into(),
        paste_status: Ok(()),
        ..RecordingEnvironment::default()
    };

    let outcome = inject_text(&mut env, "  ", SelectionBehavior::AlwaysAppend);

    assert_eq!(outcome, InjectionOutcome::NoOp);
    assert!(env.native_calls.is_empty());
    assert!(env.clipboard_sets.is_empty());
    assert!(!env.paste_sent);
}

#[test]
fn returns_failed_when_clipboard_cannot_be_written_for_any_path() {
    let mut env = RecordingEnvironment {
        native_status: NativeInsertStatus::Unsupported,
        clipboard: "original".into(),
        paste_status: Err("paste denied".into()),
        fail_clipboard_set: true,
        ..RecordingEnvironment::default()
    };

    let outcome = inject_text(
        &mut env,
        "uninjectable",
        SelectionBehavior::ReplaceSelectionWhenPresent,
    );

    assert_eq!(
        outcome,
        InjectionOutcome::Failed("Clipboard fallback failed: clipboard write denied".into())
    );
}

struct RecordingEnvironment {
    native_status: NativeInsertStatus,
    native_calls: Vec<String>,
    clipboard: String,
    clipboard_sets: Vec<String>,
    paste_status: Result<(), String>,
    paste_sent: bool,
    fail_clipboard_set: bool,
}

impl Default for RecordingEnvironment {
    fn default() -> Self {
        Self {
            native_status: NativeInsertStatus::Unsupported,
            native_calls: Vec::new(),
            clipboard: String::new(),
            clipboard_sets: Vec::new(),
            paste_status: Ok(()),
            paste_sent: false,
            fail_clipboard_set: false,
        }
    }
}

impl NativeInsert for RecordingEnvironment {
    fn insert_text(
        &mut self,
        text: &str,
        _selection_behavior: SelectionBehavior,
    ) -> NativeInsertStatus {
        self.native_calls.push(text.into());
        self.native_status.clone()
    }
}

impl Clipboard for RecordingEnvironment {
    fn read_text(&mut self) -> Result<String, String> {
        Ok(self.clipboard.clone())
    }

    fn write_text(&mut self, text: &str) -> Result<(), String> {
        if self.fail_clipboard_set {
            return Err("clipboard write denied".into());
        }
        self.clipboard = text.into();
        self.clipboard_sets.push(text.into());
        Ok(())
    }
}

impl PasteSender for RecordingEnvironment {
    fn send_paste(&mut self) -> Result<(), String> {
        self.paste_sent = true;
        self.paste_status.clone()
    }
}

impl InjectionEnvironment for RecordingEnvironment {}
