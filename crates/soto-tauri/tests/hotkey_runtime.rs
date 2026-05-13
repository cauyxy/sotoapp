use soto_core::{HotkeyBinding, HotkeyStyle};
use soto_hotkey::{HotkeyEvent, HotkeyEventQueue};
use soto_keyboard_hook::Chord;
use soto_tauri::{
    HotkeyRuntimeAction, HotkeyRuntimeActionQueue, VOICE_COMPLETION_TIMEOUT,
    drain_hotkey_runtime_actions, drain_hotkey_runtime_actions_to_queue,
    hotkey_runtime_action_for_event,
};

#[test]
fn voice_completion_timeout_is_bounded() {
    assert!(VOICE_COMPLETION_TIMEOUT <= std::time::Duration::from_secs(75));
}

#[test]
fn drains_hold_hotkey_events_into_start_and_finish_runtime_actions() {
    let (queue, receiver) = HotkeyEventQueue::new();
    let mut coordinator = soto_hotkey::HotkeySessionCoordinator::default();
    let binding = binding(HotkeyStyle::Hold);

    queue
        .push(HotkeyEvent::pressed("direct", binding.clone()))
        .expect("press");
    assert_eq!(
        drain_hotkey_runtime_actions(&receiver, &mut coordinator),
        [HotkeyRuntimeAction::StartRecording {
            mode_id: "direct".into()
        }]
    );

    std::thread::sleep(std::time::Duration::from_millis(210));

    queue
        .push(HotkeyEvent::released("direct", binding))
        .expect("release");

    assert_eq!(
        drain_hotkey_runtime_actions(&receiver, &mut coordinator),
        [HotkeyRuntimeAction::FinishRecording {
            mode_id: "direct".into()
        },]
    );
    assert!(drain_hotkey_runtime_actions(&receiver, &mut coordinator).is_empty());
}

#[test]
fn toggle_hotkey_second_press_finishes_existing_recording() {
    let mut coordinator = soto_hotkey::HotkeySessionCoordinator::default();
    let binding = binding(HotkeyStyle::Toggle);

    assert_eq!(
        hotkey_runtime_action_for_event(
            &mut coordinator,
            HotkeyEvent::pressed("polish", binding.clone())
        ),
        Some(HotkeyRuntimeAction::StartRecording {
            mode_id: "polish".into()
        })
    );
    assert_eq!(
        hotkey_runtime_action_for_event(
            &mut coordinator,
            HotkeyEvent::released("polish", binding.clone())
        ),
        None
    );
    assert_eq!(
        hotkey_runtime_action_for_event(&mut coordinator, HotkeyEvent::pressed("polish", binding)),
        Some(HotkeyRuntimeAction::FinishRecording {
            mode_id: "polish".into()
        })
    );
}

#[test]
fn drains_hotkey_events_into_runtime_action_queue_for_backend_worker() {
    let (event_queue, event_receiver) = HotkeyEventQueue::new();
    let (runtime_queue, runtime_receiver) = HotkeyRuntimeActionQueue::new();
    let mut coordinator = soto_hotkey::HotkeySessionCoordinator::default();
    let binding = binding(HotkeyStyle::Hold);

    event_queue
        .push(HotkeyEvent::pressed("direct", binding.clone()))
        .expect("press");
    let start_actions =
        drain_hotkey_runtime_actions_to_queue(&event_receiver, &mut coordinator, &runtime_queue);

    assert_eq!(
        start_actions,
        [HotkeyRuntimeAction::StartRecording {
            mode_id: "direct".into()
        }]
    );
    assert_eq!(
        runtime_receiver.try_recv().unwrap(),
        HotkeyRuntimeAction::StartRecording {
            mode_id: "direct".into()
        }
    );

    std::thread::sleep(std::time::Duration::from_millis(210));

    event_queue
        .push(HotkeyEvent::released("direct", binding))
        .expect("release");

    let actions =
        drain_hotkey_runtime_actions_to_queue(&event_receiver, &mut coordinator, &runtime_queue);

    assert_eq!(
        actions,
        [HotkeyRuntimeAction::FinishRecording {
            mode_id: "direct".into()
        },]
    );
    assert_eq!(
        runtime_receiver.try_recv().unwrap(),
        HotkeyRuntimeAction::FinishRecording {
            mode_id: "direct".into()
        }
    );
    assert!(runtime_receiver.try_recv().is_err());
}

fn binding(style: HotkeyStyle) -> HotkeyBinding {
    HotkeyBinding {
        chord: Chord::parse("RightMeta").unwrap(),
        style,
    }
}
