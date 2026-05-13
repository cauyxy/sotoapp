use soto_core::{HotkeyBinding, HotkeyStyle, Mode};
use soto_hotkey::{HotkeyEventQueue, HotkeyPhase};
use soto_keyboard_hook::{Chord, HookEvent};
use soto_tauri::{
    GlobalHotkeyRegistration, SharedHotkeyRegistrations, global_hotkey_registrations_for_modes,
    handle_hook_event,
};

fn binding(chord: &str, style: HotkeyStyle) -> HotkeyBinding {
    HotkeyBinding {
        chord: Chord::parse(chord).unwrap(),
        style,
    }
}

#[test]
fn builds_global_hotkey_registrations_from_modes_with_bindings() {
    let modes = vec![
        mode("direct", None),
        mode("polish", Some(binding("RightMeta", HotkeyStyle::Hold))),
    ];

    let registrations = global_hotkey_registrations_for_modes(&modes).expect("registrations");

    assert_eq!(registrations.len(), 1);
    assert_eq!(registrations[0].mode_id, "polish");
    assert_eq!(registrations[0].binding.style, HotkeyStyle::Hold);
    assert_eq!(registrations[0].binding.chord.canonical(), "RightMeta");
}

#[test]
fn registrations_skip_modes_without_hotkey() {
    let modes = vec![mode("direct", None)];
    let registrations = global_hotkey_registrations_for_modes(&modes).expect("registrations");
    assert!(registrations.is_empty());
}

#[test]
fn handle_hook_event_pushes_into_queue() {
    let regs = vec![GlobalHotkeyRegistration {
        mode_id: "mode-a".into(),
        binding: binding("RightAlt", HotkeyStyle::Hold),
    }];
    let shared = SharedHotkeyRegistrations::new(regs);
    let (queue, receiver) = HotkeyEventQueue::new();
    handle_hook_event(HookEvent::Pressed { chord_index: 0 }, &shared, &queue);
    let event = receiver.recv().expect("event received");
    assert_eq!(event.mode_id, "mode-a");
    assert_eq!(event.phase, HotkeyPhase::Pressed);
}

#[test]
fn handle_hook_event_for_release_emits_released_phase() {
    let regs = vec![GlobalHotkeyRegistration {
        mode_id: "mode-a".into(),
        binding: binding("LeftCtrl", HotkeyStyle::Toggle),
    }];
    let shared = SharedHotkeyRegistrations::new(regs);
    let (queue, receiver) = HotkeyEventQueue::new();
    handle_hook_event(HookEvent::Released { chord_index: 0 }, &shared, &queue);
    let event = receiver.recv().expect("event received");
    assert_eq!(event.phase, HotkeyPhase::Released);
}

#[test]
fn shared_hotkey_registrations_update_chord_mapping_after_mode_edit() {
    let initial = global_hotkey_registrations_for_modes(&[mode(
        "direct",
        Some(binding("RightMeta", HotkeyStyle::Hold)),
    )])
    .expect("initial registrations");
    let registrations = SharedHotkeyRegistrations::new(initial);

    let event = registrations
        .event_for_chord_index(0, HotkeyPhase::Pressed)
        .expect("initial event");
    assert_eq!(event.mode_id, "direct");

    let updated = global_hotkey_registrations_for_modes(&[mode(
        "polish",
        Some(binding("RightShift", HotkeyStyle::Hold)),
    )])
    .expect("updated registrations");
    registrations
        .replace(updated)
        .expect("replace registrations after mode edit");

    let event = registrations
        .event_for_chord_index(0, HotkeyPhase::Pressed)
        .expect("updated event");
    assert_eq!(event.mode_id, "polish");
}

#[test]
fn event_for_chord_index_out_of_range_returns_none() {
    let regs = vec![GlobalHotkeyRegistration {
        mode_id: "x".into(),
        binding: binding("RightAlt", HotkeyStyle::Hold),
    }];
    let shared = SharedHotkeyRegistrations::new(regs);
    assert!(
        shared
            .event_for_chord_index(99, HotkeyPhase::Pressed)
            .is_none()
    );
}

fn mode(id: &str, hotkey: Option<HotkeyBinding>) -> Mode {
    Mode {
        id: id.into(),
        name: id.into(),
        hotkey,
        display_order: 0,
        built_in: true,
        prompt_id: "default".into(),
    }
}
