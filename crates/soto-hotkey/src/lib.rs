use std::sync::mpsc::{self, Receiver, SendError, Sender};
use std::time::{Duration, Instant};

use soto_core::{HotkeyBinding, HotkeyStyle};

/// Minimum hold duration before a Hold-style press is considered intentional.
/// Anything shorter is treated as an accidental tap and short-circuited to
/// `Cancel` before the recording pipeline is even involved. Sits below
/// `MIN_RECORDING_MS = 300` so borderline-but-intentional presses still flow
/// through the audio pre-flight and get a typed `EmptyReason::TooShort` user
/// hint instead of a silent no-op.
// TODO: move to AppSettings so it's tunable per install.
const MIN_HOLD: Duration = Duration::from_millis(200);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HotkeyPhase {
    Pressed,
    Released,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HotkeyEvent {
    pub mode_id: String,
    pub binding: HotkeyBinding,
    pub phase: HotkeyPhase,
}

impl HotkeyEvent {
    pub fn pressed(mode_id: impl Into<String>, binding: HotkeyBinding) -> Self {
        Self {
            mode_id: mode_id.into(),
            binding,
            phase: HotkeyPhase::Pressed,
        }
    }

    pub fn released(mode_id: impl Into<String>, binding: HotkeyBinding) -> Self {
        Self {
            mode_id: mode_id.into(),
            binding,
            phase: HotkeyPhase::Released,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HotkeySessionAction {
    Start { mode_id: String },
    Complete { mode_id: String },
    Cancel { mode_id: String },
    Ignore,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ActiveHotkeySession {
    mode_id: String,
    started_at: Instant,
}

#[derive(Debug, Default)]
pub struct HotkeySessionCoordinator {
    active: Option<ActiveHotkeySession>,
}

impl HotkeySessionCoordinator {
    pub fn active_mode_id(&self) -> Option<&str> {
        self.active.as_ref().map(|active| active.mode_id.as_str())
    }

    pub fn handle_event(&mut self, event: HotkeyEvent) -> HotkeySessionAction {
        self.handle_event_at(event, Instant::now())
    }

    /// Time-injected variant of `handle_event`, used by tests for
    /// deterministic hold-duration assertions.
    pub fn handle_event_at(&mut self, event: HotkeyEvent, now: Instant) -> HotkeySessionAction {
        match (event.binding.style, event.phase) {
            (HotkeyStyle::Hold, HotkeyPhase::Pressed) => self.start(event.mode_id, now),
            (HotkeyStyle::Hold, HotkeyPhase::Released) => {
                self.complete_or_cancel(event.mode_id, now)
            }
            (HotkeyStyle::Toggle, HotkeyPhase::Pressed) => self.toggle(event.mode_id, now),
            (HotkeyStyle::Toggle, HotkeyPhase::Released) => HotkeySessionAction::Ignore,
        }
    }

    pub fn cancel_active(&mut self) -> HotkeySessionAction {
        let Some(active) = self.active.take() else {
            return HotkeySessionAction::Ignore;
        };

        HotkeySessionAction::Cancel {
            mode_id: active.mode_id,
        }
    }

    fn start(&mut self, mode_id: String, now: Instant) -> HotkeySessionAction {
        if self.active.is_some() {
            return HotkeySessionAction::Ignore;
        }

        self.active = Some(ActiveHotkeySession {
            mode_id: mode_id.clone(),
            started_at: now,
        });
        HotkeySessionAction::Start { mode_id }
    }

    fn complete_or_cancel(&mut self, mode_id: String, now: Instant) -> HotkeySessionAction {
        if self.active_mode_id() != Some(mode_id.as_str()) {
            return HotkeySessionAction::Ignore;
        }

        let session = self.active.take().expect("active checked above");
        if now.saturating_duration_since(session.started_at) < MIN_HOLD {
            return HotkeySessionAction::Cancel { mode_id };
        }
        HotkeySessionAction::Complete { mode_id }
    }

    fn toggle(&mut self, mode_id: String, now: Instant) -> HotkeySessionAction {
        if self.active_mode_id() == Some(mode_id.as_str()) {
            self.active = None;
            return HotkeySessionAction::Complete { mode_id };
        }

        self.start(mode_id, now)
    }
}

#[derive(Clone)]
pub struct HotkeyEventQueue {
    sender: Sender<HotkeyEvent>,
}

impl HotkeyEventQueue {
    pub fn new() -> (Self, Receiver<HotkeyEvent>) {
        let (sender, receiver) = mpsc::channel();
        (Self { sender }, receiver)
    }

    pub fn push(&self, event: HotkeyEvent) -> Result<(), SendError<HotkeyEvent>> {
        self.sender.send(event)
    }
}
