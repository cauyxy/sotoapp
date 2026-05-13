use soto_core::{InjectionOutcome, SelectionBehavior};
use soto_injection::{Clipboard, NativeInsert, NativeInsertStatus, PasteSender, inject_text};
#[cfg(target_os = "macos")]
use soto_platform::SystemNativeInserter;
use soto_platform::{
    CommandRunner, OsPasteSender, PasteCommand, PermissionAuthorizationMethod, PermissionPane,
    PermissionSettingsCommand, PermissionStatusKind, PlatformInjectionEnvironment, SystemClipboard,
    permission_statuses,
};

#[test]
fn platform_environment_delegates_clipboard_and_paste_while_native_is_unsupported() {
    let clipboard = RecordingClipboard {
        text: "original".into(),
        ..RecordingClipboard::default()
    };
    let paste_sender = RecordingPasteSender::default();
    let mut env = PlatformInjectionEnvironment::new(clipboard, paste_sender);

    assert_eq!(
        env.insert_text("hello", SelectionBehavior::ReplaceSelectionWhenPresent),
        NativeInsertStatus::Unsupported
    );
    assert_eq!(env.read_text().unwrap(), "original");
    env.write_text("dictated text").unwrap();
    env.send_paste().unwrap();

    assert_eq!(env.clipboard().text, "dictated text");
    assert_eq!(env.clipboard().writes, ["dictated text"]);
    assert_eq!(env.paste_sender().sent_count, 1);
}

#[test]
fn platform_environment_can_delegate_native_insert_before_clipboard_fallback() {
    let clipboard = RecordingClipboard {
        text: "original".into(),
        ..RecordingClipboard::default()
    };
    let paste_sender = RecordingPasteSender::default();
    let native_inserter = RecordingNativeInserter {
        status: NativeInsertStatus::Inserted,
        ..RecordingNativeInserter::default()
    };
    let mut env =
        PlatformInjectionEnvironment::new_with_native(clipboard, paste_sender, native_inserter);

    let outcome = inject_text(
        &mut env,
        "dictated text",
        SelectionBehavior::ReplaceSelectionWhenPresent,
    );

    assert_eq!(outcome, InjectionOutcome::Inserted);
    assert_eq!(
        env.native_inserter().calls,
        [(
            "dictated text".to_string(),
            SelectionBehavior::ReplaceSelectionWhenPresent
        )]
    );
    assert!(env.clipboard().writes.is_empty());
    assert_eq!(env.paste_sender().sent_count, 0);
}

#[cfg(target_os = "macos")]
#[test]
fn macos_system_native_inserter_is_unsupported_so_clipboard_path_runs() {
    let mut inserter = SystemNativeInserter;
    assert_eq!(
        inserter.insert_text("hello", SelectionBehavior::ReplaceSelectionWhenPresent),
        NativeInsertStatus::Unsupported,
        "macOS deliberately has no native AX path; AXSelectedText writes lie in \
         Electron-based editors (e.g. Lark/飞书), so injection always falls through \
         to clipboard paste"
    );
}

#[test]
fn os_paste_sender_uses_platform_command_runner() {
    let runner = RecordingRunner::default();
    let mut sender = OsPasteSender::new(runner);

    match PasteCommand::for_current_platform() {
        Ok(expected_command) => {
            sender.send_paste().unwrap();

            let commands = &sender.runner().commands;
            assert_eq!(commands.len(), 1);
            assert_eq!(commands[0], expected_command);
        }
        Err(expected_error) => {
            assert_eq!(sender.send_paste().unwrap_err(), expected_error);
            assert!(sender.runner().commands.is_empty());
        }
    }
}

#[test]
fn current_platform_paste_command_is_macos_or_windows_only() {
    if cfg!(target_os = "macos") {
        let command = PasteCommand::for_current_platform().unwrap();
        assert_eq!(command.program, "osascript");
        assert_eq!(
            command.args,
            [
                "-e".to_string(),
                r#"tell application "System Events" to keystroke "v" using command down"#
                    .to_string(),
                "-e".to_string(),
                "delay 0.2".to_string()
            ]
        );
    } else if cfg!(target_os = "windows") {
        let command = PasteCommand::for_current_platform().unwrap();
        assert_eq!(command.program, "powershell");
        assert!(command.args.iter().any(|arg| arg.contains("SendKeys")));
        assert!(command.args.iter().any(|arg| arg.contains("^v")));
    } else {
        assert_eq!(
            PasteCommand::for_current_platform().unwrap_err(),
            "paste hotkey is supported only on macOS and Windows for MVP"
        );
    }
}

#[test]
fn system_clipboard_constructor_is_available_for_runtime_injection() {
    let _constructor: fn() -> Result<SystemClipboard, String> = SystemClipboard::new;
}

#[test]
fn permission_panes_parse_stable_frontend_values() {
    assert_eq!(
        PermissionPane::parse("microphone").unwrap(),
        PermissionPane::Microphone
    );
    assert_eq!(
        PermissionPane::parse("accessibility").unwrap(),
        PermissionPane::Accessibility
    );
    assert_eq!(
        PermissionPane::parse("input_monitoring").unwrap_err(),
        "unsupported permission pane: input_monitoring"
    );
    assert_eq!(
        PermissionPane::parse("camera").unwrap_err(),
        "unsupported permission pane: camera"
    );
}

#[test]
fn permission_settings_commands_cover_macos_and_windows() {
    let mac_mic = PermissionSettingsCommand::for_platform("macos", PermissionPane::Microphone)
        .expect("mac microphone command");
    assert_eq!(mac_mic.program, "open");
    assert_eq!(
        mac_mic.args,
        ["x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"]
    );

    let mac_accessibility =
        PermissionSettingsCommand::for_platform("macos", PermissionPane::Accessibility)
            .expect("mac accessibility command");
    assert_eq!(mac_accessibility.program, "open");
    assert_eq!(
        mac_accessibility.args,
        ["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]
    );

    let windows_mic =
        PermissionSettingsCommand::for_platform("windows", PermissionPane::Microphone)
            .expect("windows microphone command");
    assert_eq!(windows_mic.program, "cmd");
    assert_eq!(
        windows_mic.args,
        ["/C", "start", "", "ms-settings:privacy-microphone"]
    );

    let windows_accessibility =
        PermissionSettingsCommand::for_platform("windows", PermissionPane::Accessibility)
            .expect("windows accessibility command");
    assert_eq!(windows_accessibility.program, "cmd");
    assert_eq!(
        windows_accessibility.args,
        ["/C", "start", "", "ms-settings:easeofaccess-keyboard"]
    );

    assert_eq!(
        PermissionSettingsCommand::for_platform("linux", PermissionPane::Microphone).unwrap_err(),
        "permission settings are supported only on macOS and Windows for MVP"
    );
}

#[test]
fn permission_authorization_methods_use_native_macos_requests_for_all_required_permissions() {
    assert_eq!(
        PermissionAuthorizationMethod::for_platform("macos", PermissionPane::Microphone),
        PermissionAuthorizationMethod::NativeMicrophoneRequest
    );
    assert_eq!(
        PermissionAuthorizationMethod::for_platform("macos", PermissionPane::Accessibility),
        PermissionAuthorizationMethod::NativeAccessibilityPrompt
    );
    assert_eq!(
        PermissionAuthorizationMethod::for_platform("windows", PermissionPane::Accessibility),
        PermissionAuthorizationMethod::OpenSettings
    );
}

#[test]
fn microphone_permission_statuses_keep_promptable_and_denied_states_distinct() {
    assert_eq!(PermissionStatusKind::NotDetermined.label(), "Not requested");
    assert_eq!(PermissionStatusKind::Denied.label(), "Denied");
    assert_eq!(PermissionStatusKind::Restricted.label(), "Restricted");
}

#[test]
fn permission_statuses_cover_mvp_permission_rows_without_prompting() {
    let statuses = permission_statuses();

    assert_eq!(statuses.len(), 2);
    assert_eq!(statuses[0].pane, PermissionPane::Microphone);
    assert_eq!(statuses[1].pane, PermissionPane::Accessibility);
    for status in &statuses {
        assert!(matches!(
            status.kind,
            PermissionStatusKind::Granted
                | PermissionStatusKind::NeedsReview
                | PermissionStatusKind::NotDetermined
                | PermissionStatusKind::Denied
                | PermissionStatusKind::Restricted
                | PermissionStatusKind::NotRequired
                | PermissionStatusKind::Unknown
        ));
        assert!(!status.label.is_empty());
        assert!(!status.detail.is_empty());
    }
}

#[derive(Default)]
struct RecordingClipboard {
    text: String,
    writes: Vec<String>,
}

impl Clipboard for RecordingClipboard {
    fn read_text(&mut self) -> Result<String, String> {
        Ok(self.text.clone())
    }

    fn write_text(&mut self, text: &str) -> Result<(), String> {
        self.text = text.into();
        self.writes.push(text.into());
        Ok(())
    }
}

#[derive(Default)]
struct RecordingPasteSender {
    sent_count: usize,
}

impl PasteSender for RecordingPasteSender {
    fn send_paste(&mut self) -> Result<(), String> {
        self.sent_count += 1;
        Ok(())
    }
}

#[derive(Default)]
struct RecordingNativeInserter {
    status: NativeInsertStatus,
    calls: Vec<(String, SelectionBehavior)>,
}

impl NativeInsert for RecordingNativeInserter {
    fn insert_text(
        &mut self,
        text: &str,
        selection_behavior: SelectionBehavior,
    ) -> NativeInsertStatus {
        self.calls.push((text.to_string(), selection_behavior));
        self.status.clone()
    }
}

#[derive(Default)]
struct RecordingRunner {
    commands: Vec<PasteCommand>,
}

impl CommandRunner for RecordingRunner {
    fn run(&mut self, command: &PasteCommand) -> Result<(), String> {
        self.commands.push(command.clone());
        Ok(())
    }
}
