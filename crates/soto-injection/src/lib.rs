use soto_core::{InjectionOutcome, SelectionBehavior};

pub trait NativeInsert {
    fn insert_text(
        &mut self,
        text: &str,
        selection_behavior: SelectionBehavior,
    ) -> NativeInsertStatus;
}

pub trait Clipboard {
    fn read_text(&mut self) -> Result<String, String>;
    fn write_text(&mut self, text: &str) -> Result<(), String>;
}

pub trait PasteSender {
    fn send_paste(&mut self) -> Result<(), String>;
}

pub trait InjectionEnvironment: NativeInsert + Clipboard + PasteSender {}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum NativeInsertStatus {
    Inserted,
    #[default]
    Unsupported,
    Failed(String),
}

pub fn inject_text(
    env: &mut impl InjectionEnvironment,
    text: &str,
    selection_behavior: SelectionBehavior,
) -> InjectionOutcome {
    let final_text = text.trim();
    if final_text.is_empty() {
        return InjectionOutcome::NoOp;
    }

    if matches!(
        env.insert_text(final_text, selection_behavior),
        NativeInsertStatus::Inserted
    ) {
        return InjectionOutcome::Inserted;
    }

    match clipboard_paste(env, final_text) {
        ClipboardPasteResult::Pasted => InjectionOutcome::PasteSent,
        ClipboardPasteResult::CopiedFallback => InjectionOutcome::CopiedFallback,
        ClipboardPasteResult::ClipboardUnavailable(message) => {
            InjectionOutcome::Failed(format!("Clipboard fallback failed: {message}"))
        }
    }
}

enum ClipboardPasteResult {
    Pasted,
    CopiedFallback,
    ClipboardUnavailable(String),
}

fn clipboard_paste(env: &mut impl InjectionEnvironment, text: &str) -> ClipboardPasteResult {
    let original = env.read_text().unwrap_or_default();
    if let Err(error) = env.write_text(text) {
        return ClipboardPasteResult::ClipboardUnavailable(error);
    }

    if env.send_paste().is_err() {
        return ClipboardPasteResult::CopiedFallback;
    }

    match env.write_text(&original) {
        Ok(()) => ClipboardPasteResult::Pasted,
        Err(error) => ClipboardPasteResult::ClipboardUnavailable(error),
    }
}
