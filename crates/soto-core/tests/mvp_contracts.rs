use soto_core::{HotkeyStyle, Mode};

fn base_mode() -> Mode {
    Mode {
        id: "default".into(),
        name: "Default".into(),
        hotkey: None,
        display_order: 1,
        built_in: true,
        prompt_id: "default".into(),
    }
}

#[test]
fn mode_references_prompt_by_id() {
    let mode = base_mode();
    assert_eq!(mode.prompt_id, "default");
}

#[test]
fn hotkey_style_serializes_as_lowercase_contract() {
    let value = serde_json::to_value(HotkeyStyle::Hold).expect("serializes");
    assert_eq!(value, "hold");
}
