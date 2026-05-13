use serde::Serialize;
use soto_core::{HotkeyBinding, Mode};
use soto_hotkey::{
    HotkeyEvent, HotkeyEventQueue, HotkeyPhase, HotkeySessionAction, HotkeySessionCoordinator,
};
use soto_keyboard_hook::{HookEvent, KeyboardHook};
use std::sync::{
    Arc, Mutex,
    mpsc::{self, Receiver, SyncSender, TryRecvError, TrySendError},
};
use tauri::{AppHandle, Emitter, Wry};

pub const HOTKEY_RUNTIME_ACTION_EVENT: &str = "soto://hotkey-runtime-action";

#[derive(Debug, Clone)]
pub struct GlobalHotkeyRegistration {
    pub mode_id: String,
    pub binding: HotkeyBinding,
}

#[derive(Debug, Clone, Default)]
pub struct SharedHotkeyRegistrations {
    registrations: Arc<Mutex<Vec<GlobalHotkeyRegistration>>>,
}

impl SharedHotkeyRegistrations {
    pub fn new(registrations: Vec<GlobalHotkeyRegistration>) -> Self {
        Self {
            registrations: Arc::new(Mutex::new(registrations)),
        }
    }

    pub fn registrations(&self) -> Result<Vec<GlobalHotkeyRegistration>, String> {
        self.registrations
            .lock()
            .map(|registrations| registrations.clone())
            .map_err(|_| "global hotkey registrations are unavailable".to_string())
    }

    pub fn replace(&self, registrations: Vec<GlobalHotkeyRegistration>) -> Result<(), String> {
        self.registrations
            .lock()
            .map(|mut current| {
                *current = registrations;
            })
            .map_err(|_| "global hotkey registrations are unavailable".to_string())
    }

    pub fn event_for_chord_index(&self, index: usize, phase: HotkeyPhase) -> Option<HotkeyEvent> {
        self.registrations.lock().ok().and_then(|registrations| {
            registrations.get(index).map(|registration| HotkeyEvent {
                mode_id: registration.mode_id.clone(),
                binding: registration.binding.clone(),
                phase,
            })
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HotkeyRuntimeAction {
    StartRecording { mode_id: String },
    FinishRecording { mode_id: String },
    CancelRecording { mode_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueueHotkeyRuntimeActionError {
    Full(HotkeyRuntimeAction),
    Disconnected(HotkeyRuntimeAction),
}

#[derive(Clone, Debug)]
pub struct HotkeyRuntimeActionQueue {
    sender: SyncSender<HotkeyRuntimeAction>,
}

impl HotkeyRuntimeActionQueue {
    pub fn new() -> (Self, Receiver<HotkeyRuntimeAction>) {
        Self::bounded(64)
    }

    pub fn bounded(capacity: usize) -> (Self, Receiver<HotkeyRuntimeAction>) {
        let (sender, receiver) = mpsc::sync_channel(capacity);
        (Self { sender }, receiver)
    }

    pub fn push(&self, action: HotkeyRuntimeAction) -> Result<(), QueueHotkeyRuntimeActionError> {
        self.sender.try_send(action).map_err(|error| match error {
            TrySendError::Full(action) => QueueHotkeyRuntimeActionError::Full(action),
            TrySendError::Disconnected(action) => {
                QueueHotkeyRuntimeActionError::Disconnected(action)
            }
        })
    }
}

pub fn global_hotkey_registrations_for_modes(
    modes: &[Mode],
) -> Result<Vec<GlobalHotkeyRegistration>, String> {
    Ok(modes
        .iter()
        .filter_map(|mode| {
            mode.hotkey
                .as_ref()
                .map(|binding| GlobalHotkeyRegistration {
                    mode_id: mode.id.clone(),
                    binding: binding.clone(),
                })
        })
        .collect())
}

pub fn install_keyboard_hook(
    hook: Arc<dyn KeyboardHook>,
    registrations: SharedHotkeyRegistrations,
) -> Result<(), String> {
    let initial = registrations.registrations()?;
    let chords = initial
        .iter()
        .map(|registration| registration.binding.chord)
        .collect::<Vec<_>>();
    let canonicals: Vec<(String, String)> = initial
        .iter()
        .map(|reg| (reg.mode_id.clone(), reg.binding.chord.canonical()))
        .collect();
    eprintln!(
        "[soto-hotkey] install_keyboard_hook: pushing {} initial registration(s): {:?}",
        canonicals.len(),
        canonicals
    );
    hook.replace_registrations(chords)
        .map_err(|error| format!("keyboard hook registration failed: {error}"))?;
    Ok(())
}

pub fn refresh_hotkey_registrations(
    hook: &dyn KeyboardHook,
    current: &SharedHotkeyRegistrations,
    registrations: Vec<GlobalHotkeyRegistration>,
) -> Result<(), String> {
    let canonicals: Vec<(String, String)> = registrations
        .iter()
        .map(|reg| (reg.mode_id.clone(), reg.binding.chord.canonical()))
        .collect();
    eprintln!(
        "[soto-hotkey] refresh_hotkey_registrations: pushing {} registration(s): {:?}",
        canonicals.len(),
        canonicals
    );
    let chords = registrations
        .iter()
        .map(|registration| registration.binding.chord)
        .collect::<Vec<_>>();
    hook.replace_registrations(chords).map_err(|error| {
        eprintln!(
            "[soto-hotkey] refresh_hotkey_registrations: hook.replace_registrations FAILED: {error}"
        );
        format!("keyboard hook registration failed: {error}")
    })?;
    current.replace(registrations)?;
    Ok(())
}

pub fn handle_hook_event(
    event: HookEvent,
    registrations: &SharedHotkeyRegistrations,
    queue: &HotkeyEventQueue,
) {
    let (index, phase) = match event {
        HookEvent::Pressed { chord_index } => (chord_index, HotkeyPhase::Pressed),
        HookEvent::Released { chord_index } => (chord_index, HotkeyPhase::Released),
    };
    match registrations.event_for_chord_index(index, phase.clone()) {
        Some(hotkey_event) => {
            eprintln!(
                "[soto-hotkey] handle_hook_event: index={index} phase={phase:?} -> mode_id={} chord={} style={:?}",
                hotkey_event.mode_id,
                hotkey_event.binding.chord.canonical(),
                hotkey_event.binding.style,
            );
            if let Err(err) = queue.push(hotkey_event) {
                eprintln!("[soto-hotkey] handle_hook_event: queue.push failed: {err:?}");
            }
        }
        None => {
            eprintln!(
                "[soto-hotkey] handle_hook_event: index={index} phase={phase:?} has no matching registration (chord set may have just changed)"
            );
        }
    }
}

pub fn hotkey_runtime_action_for_event(
    coordinator: &mut HotkeySessionCoordinator,
    event: HotkeyEvent,
) -> Option<HotkeyRuntimeAction> {
    match coordinator.handle_event(event) {
        HotkeySessionAction::Start { mode_id } => {
            Some(HotkeyRuntimeAction::StartRecording { mode_id })
        }
        HotkeySessionAction::Complete { mode_id } => {
            Some(HotkeyRuntimeAction::FinishRecording { mode_id })
        }
        HotkeySessionAction::Cancel { mode_id } => {
            Some(HotkeyRuntimeAction::CancelRecording { mode_id })
        }
        HotkeySessionAction::Ignore => None,
    }
}

pub fn drain_hotkey_runtime_actions(
    receiver: &Receiver<HotkeyEvent>,
    coordinator: &mut HotkeySessionCoordinator,
) -> Vec<HotkeyRuntimeAction> {
    let mut actions = Vec::new();
    loop {
        match receiver.try_recv() {
            Ok(event) => {
                if let Some(action) = hotkey_runtime_action_for_event(coordinator, event) {
                    actions.push(action);
                }
            }
            Err(TryRecvError::Empty) => return actions,
            Err(TryRecvError::Disconnected) => return actions,
        }
    }
}

pub fn drain_hotkey_runtime_actions_to_queue(
    receiver: &Receiver<HotkeyEvent>,
    coordinator: &mut HotkeySessionCoordinator,
    runtime_action_queue: &HotkeyRuntimeActionQueue,
) -> Vec<HotkeyRuntimeAction> {
    let actions = drain_hotkey_runtime_actions(receiver, coordinator);
    for action in &actions {
        let _ = runtime_action_queue.push(action.clone());
    }

    actions
}

pub(crate) fn spawn_hotkey_event_consumer(
    app: AppHandle<Wry>,
    receiver: Receiver<HotkeyEvent>,
    runtime_action_queue: HotkeyRuntimeActionQueue,
) {
    std::thread::spawn(move || {
        let mut coordinator = HotkeySessionCoordinator::default();
        while let Ok(event) = receiver.recv() {
            let event_label = format!(
                "mode_id={} phase={:?} style={:?}",
                event.mode_id, event.phase, event.binding.style
            );
            match hotkey_runtime_action_for_event(&mut coordinator, event) {
                Some(action) => {
                    eprintln!("[soto-hotkey] consumer: {event_label} -> action={action:?}");
                    if let Err(err) = app.emit(HOTKEY_RUNTIME_ACTION_EVENT, action.clone()) {
                        eprintln!(
                            "[soto-hotkey] consumer: app.emit({HOTKEY_RUNTIME_ACTION_EVENT}) failed: {err}"
                        );
                    }
                    if let Err(err) = runtime_action_queue.push(action) {
                        eprintln!(
                            "[soto-hotkey] consumer: runtime_action_queue.push failed: {err:?}"
                        );
                    }
                }
                None => {
                    eprintln!(
                        "[soto-hotkey] consumer: {event_label} -> Ignore (coordinator state)"
                    );
                }
            }
        }
        eprintln!("[soto-hotkey] consumer: receiver disconnected, exiting");
    });
}
