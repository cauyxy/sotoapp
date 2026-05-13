use tauri::{
    AppHandle, Manager, Wry,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub const TRAY_ID: &str = "soto.tray";
pub const SHOW_MAIN_MENU_ID: &str = "tray.show-main";
pub const SHOW_VOICE_BAR_MENU_ID: &str = "tray.show-voice-bar";
pub const QUIT_MENU_ID: &str = "tray.quit";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrayMenuEntry {
    pub id: &'static str,
    pub label: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayMenuAction {
    ShowMainWindow,
    ShowVoiceBar,
    Quit,
}

pub fn tray_menu_entries() -> [TrayMenuEntry; 3] {
    [
        TrayMenuEntry {
            id: SHOW_MAIN_MENU_ID,
            label: "Show Soto",
        },
        TrayMenuEntry {
            id: SHOW_VOICE_BAR_MENU_ID,
            label: "Show Voice Bar",
        },
        TrayMenuEntry {
            id: QUIT_MENU_ID,
            label: "Quit Soto",
        },
    ]
}

pub fn tray_action_for_menu_id(menu_id: &str) -> Option<TrayMenuAction> {
    match menu_id {
        SHOW_MAIN_MENU_ID => Some(TrayMenuAction::ShowMainWindow),
        SHOW_VOICE_BAR_MENU_ID => Some(TrayMenuAction::ShowVoiceBar),
        QUIT_MENU_ID => Some(TrayMenuAction::Quit),
        _ => None,
    }
}

// NOTE: Tauri 2.11's `MouseButtonState` doc-comments are inverted — the variant
// labelled `Up` is doc'd as "Mouse button pressed" and `Down` as "released".
// The variant *names* are the source of truth: `tray-icon` 0.23.1 maps
// WM_LBUTTONUP → Up and WM_LBUTTONDOWN → Down on both Windows and macOS, so
// `Up` = release (standard click commit), `Down` = press. Don't trust the doc.
pub fn tray_action_for_icon_event(
    button: MouseButton,
    button_state: MouseButtonState,
) -> Option<TrayMenuAction> {
    match (button, button_state) {
        (MouseButton::Left, MouseButtonState::Up) => Some(TrayMenuAction::ShowMainWindow),
        _ => None,
    }
}

pub(crate) fn install_tray(app: &AppHandle<Wry>) -> Result<(), String> {
    let [show_main, show_voice_bar, quit] = tray_menu_entries();
    let show_main_item = MenuItem::with_id(app, show_main.id, show_main.label, true, None::<&str>)
        .map_err(|error| format!("tray show-main item could not be created: {error}"))?;
    let show_voice_bar_item = MenuItem::with_id(
        app,
        show_voice_bar.id,
        show_voice_bar.label,
        true,
        None::<&str>,
    )
    .map_err(|error| format!("tray show-voice-bar item could not be created: {error}"))?;
    let separator = PredefinedMenuItem::separator(app)
        .map_err(|error| format!("tray separator could not be created: {error}"))?;
    let quit_item = MenuItem::with_id(app, quit.id, quit.label, true, None::<&str>)
        .map_err(|error| format!("tray quit item could not be created: {error}"))?;
    let menu = Menu::with_items(
        app,
        &[
            &show_main_item,
            &show_voice_bar_item,
            &separator,
            &quit_item,
        ],
    )
    .map_err(|error| format!("tray menu could not be created: {error}"))?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Soto")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if let Some(action) = tray_action_for_menu_id(event.id().as_ref()) {
                let _ = handle_tray_menu_action(app, action);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
                && let Some(action) = tray_action_for_icon_event(button, button_state)
            {
                let _ = handle_tray_menu_action(tray.app_handle(), action);
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)
        .map(|_| ())
        .map_err(|error| format!("system tray could not be installed: {error}"))
}

fn handle_tray_menu_action(app: &AppHandle<Wry>, action: TrayMenuAction) -> Result<(), String> {
    match action {
        TrayMenuAction::ShowMainWindow => show_window(app, "main", true),
        TrayMenuAction::ShowVoiceBar => show_window(app, "capsule", false),
        TrayMenuAction::Quit => {
            app.exit(0);
            Ok(())
        }
    }
}

fn show_window(app: &AppHandle<Wry>, label: &str, focus: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("window not found: {label}"))?;
    window
        .show()
        .map_err(|error| format!("window {label} could not be shown: {error}"))?;
    window
        .unminimize()
        .map_err(|error| format!("window {label} could not be unminimized: {error}"))?;
    if focus {
        window
            .set_focus()
            .map_err(|error| format!("window {label} could not be focused: {error}"))?;
    }
    Ok(())
}
