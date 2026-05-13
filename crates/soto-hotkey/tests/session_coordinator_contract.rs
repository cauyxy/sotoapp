use std::sync::mpsc::TryRecvError;
use std::time::{Duration, Instant};

use soto_core::{HotkeyBinding, HotkeyStyle};
use soto_hotkey::{
    HotkeyEvent, HotkeyEventQueue, HotkeyPhase, HotkeySessionAction, HotkeySessionCoordinator,
};
use soto_keyboard_hook::Chord;

#[test]
fn hold_hotkey_starts_on_press_and_completes_on_release() {
    let mut coordinator = HotkeySessionCoordinator::default();
    let press_at = Instant::now();

    assert_eq!(
        coordinator.handle_event_at(
            HotkeyEvent::pressed("direct", binding(HotkeyStyle::Hold)),
            press_at,
        ),
        HotkeySessionAction::Start {
            mode_id: "direct".into()
        }
    );
    assert_eq!(coordinator.active_mode_id(), Some("direct"));
    assert_eq!(
        coordinator.handle_event_at(
            HotkeyEvent::pressed("direct", binding(HotkeyStyle::Hold)),
            press_at + Duration::from_millis(10),
        ),
        HotkeySessionAction::Ignore
    );
    assert_eq!(
        coordinator.handle_event_at(
            HotkeyEvent::released("direct", binding(HotkeyStyle::Hold)),
            press_at + Duration::from_millis(500),
        ),
        HotkeySessionAction::Complete {
            mode_id: "direct".into()
        }
    );
    assert_eq!(coordinator.active_mode_id(), None);
}

#[test]
fn toggle_hotkey_starts_and_completes_on_press_while_release_is_ignored() {
    let mut coordinator = HotkeySessionCoordinator::default();

    assert_eq!(
        coordinator.handle_event(HotkeyEvent::pressed("polish", binding(HotkeyStyle::Toggle))),
        HotkeySessionAction::Start {
            mode_id: "polish".into()
        }
    );
    assert_eq!(
        coordinator.handle_event(HotkeyEvent::released(
            "polish",
            binding(HotkeyStyle::Toggle)
        )),
        HotkeySessionAction::Ignore
    );
    assert_eq!(coordinator.active_mode_id(), Some("polish"));
    assert_eq!(
        coordinator.handle_event(HotkeyEvent::pressed("polish", binding(HotkeyStyle::Toggle))),
        HotkeySessionAction::Complete {
            mode_id: "polish".into()
        }
    );
    assert_eq!(coordinator.active_mode_id(), None);
}

#[test]
fn active_session_rejects_other_mode_events_until_matching_mode_completes() {
    let mut coordinator = HotkeySessionCoordinator::default();
    let press_at = Instant::now();

    assert_eq!(
        coordinator.handle_event_at(
            HotkeyEvent::pressed("direct", binding(HotkeyStyle::Hold)),
            press_at,
        ),
        HotkeySessionAction::Start {
            mode_id: "direct".into()
        }
    );
    assert_eq!(
        coordinator.handle_event_at(
            HotkeyEvent::pressed("polish", binding(HotkeyStyle::Toggle)),
            press_at + Duration::from_millis(10),
        ),
        HotkeySessionAction::Ignore
    );
    assert_eq!(
        coordinator.handle_event_at(
            HotkeyEvent::released("polish", binding(HotkeyStyle::Toggle)),
            press_at + Duration::from_millis(20),
        ),
        HotkeySessionAction::Ignore
    );
    assert_eq!(coordinator.active_mode_id(), Some("direct"));
    assert_eq!(
        coordinator.handle_event_at(
            HotkeyEvent::released("direct", binding(HotkeyStyle::Hold)),
            press_at + Duration::from_millis(500),
        ),
        HotkeySessionAction::Complete {
            mode_id: "direct".into()
        }
    );
}

#[test]
fn cancel_action_clears_active_session_without_requiring_release() {
    let mut coordinator = HotkeySessionCoordinator::default();

    coordinator.handle_event(HotkeyEvent::pressed("direct", binding(HotkeyStyle::Hold)));

    assert_eq!(
        coordinator.cancel_active(),
        HotkeySessionAction::Cancel {
            mode_id: "direct".into()
        }
    );
    assert_eq!(coordinator.active_mode_id(), None);
    assert_eq!(coordinator.cancel_active(), HotkeySessionAction::Ignore);
}

#[test]
fn callback_facing_queue_only_transfers_hotkey_events() {
    let (queue, receiver) = HotkeyEventQueue::new();
    let event = HotkeyEvent::pressed("direct", binding(HotkeyStyle::Hold));

    assert_eq!(event.phase, HotkeyPhase::Pressed);
    queue.push(event.clone()).expect("queue event");

    assert_eq!(receiver.try_recv().expect("receive event"), event);
    assert_eq!(receiver.try_recv().unwrap_err(), TryRecvError::Empty);
}

#[test]
fn hold_release_within_min_hold_window_cancels_instead_of_completing() {
    let mut coordinator = HotkeySessionCoordinator::default();
    let press_at = Instant::now();

    assert_eq!(
        coordinator.handle_event_at(
            HotkeyEvent::pressed("direct", binding(HotkeyStyle::Hold)),
            press_at,
        ),
        HotkeySessionAction::Start {
            mode_id: "direct".into()
        }
    );

    let release_at = press_at + Duration::from_millis(50);
    assert_eq!(
        coordinator.handle_event_at(
            HotkeyEvent::released("direct", binding(HotkeyStyle::Hold)),
            release_at,
        ),
        HotkeySessionAction::Cancel {
            mode_id: "direct".into()
        }
    );
    assert_eq!(coordinator.active_mode_id(), None);
}

#[test]
fn hold_release_after_min_hold_window_completes_normally() {
    let mut coordinator = HotkeySessionCoordinator::default();
    let press_at = Instant::now();
    coordinator.handle_event_at(
        HotkeyEvent::pressed("direct", binding(HotkeyStyle::Hold)),
        press_at,
    );

    let release_at = press_at + Duration::from_millis(400);
    assert_eq!(
        coordinator.handle_event_at(
            HotkeyEvent::released("direct", binding(HotkeyStyle::Hold)),
            release_at,
        ),
        HotkeySessionAction::Complete {
            mode_id: "direct".into()
        }
    );
}

#[test]
fn toggle_hotkey_is_not_affected_by_hold_gate() {
    let mut coordinator = HotkeySessionCoordinator::default();
    let press1 = Instant::now();
    assert_eq!(
        coordinator.handle_event_at(
            HotkeyEvent::pressed("polish", binding(HotkeyStyle::Toggle)),
            press1,
        ),
        HotkeySessionAction::Start {
            mode_id: "polish".into()
        }
    );

    let press2 = press1 + Duration::from_millis(30);
    assert_eq!(
        coordinator.handle_event_at(
            HotkeyEvent::pressed("polish", binding(HotkeyStyle::Toggle)),
            press2,
        ),
        HotkeySessionAction::Complete {
            mode_id: "polish".into()
        }
    );
}

fn binding(style: HotkeyStyle) -> HotkeyBinding {
    HotkeyBinding {
        chord: Chord::parse("RightMeta").unwrap(),
        style,
    }
}
