use soto_tauri::{
    TrayMenuAction, tray_action_for_icon_event, tray_action_for_menu_id, tray_menu_entries,
};
use tauri::tray::{MouseButton, MouseButtonState};

#[test]
fn tray_menu_exposes_minimum_control_entries() {
    let entries = tray_menu_entries();

    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0].id, "tray.show-main");
    assert_eq!(entries[0].label, "Show Soto");
    assert_eq!(entries[1].id, "tray.show-voice-bar");
    assert_eq!(entries[1].label, "Show Voice Bar");
    assert_eq!(entries[2].id, "tray.quit");
    assert_eq!(entries[2].label, "Quit Soto");
}

#[test]
fn tray_menu_ids_map_to_runtime_actions() {
    assert_eq!(
        tray_action_for_menu_id("tray.show-main"),
        Some(TrayMenuAction::ShowMainWindow)
    );
    assert_eq!(
        tray_action_for_menu_id("tray.show-voice-bar"),
        Some(TrayMenuAction::ShowVoiceBar)
    );
    assert_eq!(
        tray_action_for_menu_id("tray.quit"),
        Some(TrayMenuAction::Quit)
    );
    assert_eq!(tray_action_for_menu_id("unknown"), None);
}

#[test]
fn left_click_release_opens_main_window() {
    assert_eq!(
        tray_action_for_icon_event(MouseButton::Left, MouseButtonState::Up),
        Some(TrayMenuAction::ShowMainWindow)
    );
}

#[test]
fn left_click_press_does_not_double_fire() {
    assert_eq!(
        tray_action_for_icon_event(MouseButton::Left, MouseButtonState::Down),
        None
    );
}

#[test]
fn right_click_is_reserved_for_os_context_menu() {
    assert_eq!(
        tray_action_for_icon_event(MouseButton::Right, MouseButtonState::Up),
        None
    );
    assert_eq!(
        tray_action_for_icon_event(MouseButton::Right, MouseButtonState::Down),
        None
    );
}

#[test]
fn middle_click_is_unhandled() {
    assert_eq!(
        tray_action_for_icon_event(MouseButton::Middle, MouseButtonState::Up),
        None
    );
}
