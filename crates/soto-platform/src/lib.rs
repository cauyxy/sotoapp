use std::process::Command;

use serde::Serialize;
use soto_core::SelectionBehavior;
use soto_injection::{
    Clipboard, InjectionEnvironment, NativeInsert, NativeInsertStatus, PasteSender,
};

pub struct PlatformInjectionEnvironment<C, P, N = UnsupportedNativeInserter> {
    clipboard: C,
    paste_sender: P,
    native_inserter: N,
}

impl<C, P> PlatformInjectionEnvironment<C, P, UnsupportedNativeInserter> {
    pub fn new(clipboard: C, paste_sender: P) -> Self {
        Self {
            clipboard,
            paste_sender,
            native_inserter: UnsupportedNativeInserter,
        }
    }
}

impl<C, P, N> PlatformInjectionEnvironment<C, P, N> {
    pub fn new_with_native(clipboard: C, paste_sender: P, native_inserter: N) -> Self {
        Self {
            clipboard,
            paste_sender,
            native_inserter,
        }
    }

    pub fn clipboard(&self) -> &C {
        &self.clipboard
    }

    pub fn paste_sender(&self) -> &P {
        &self.paste_sender
    }

    pub fn native_inserter(&self) -> &N {
        &self.native_inserter
    }
}

impl<C, P, N> NativeInsert for PlatformInjectionEnvironment<C, P, N>
where
    N: NativeInsert,
{
    fn insert_text(
        &mut self,
        text: &str,
        selection_behavior: SelectionBehavior,
    ) -> NativeInsertStatus {
        self.native_inserter.insert_text(text, selection_behavior)
    }
}

impl<C, P, N> Clipboard for PlatformInjectionEnvironment<C, P, N>
where
    C: Clipboard,
{
    fn read_text(&mut self) -> Result<String, String> {
        self.clipboard.read_text()
    }

    fn write_text(&mut self, text: &str) -> Result<(), String> {
        self.clipboard.write_text(text)
    }
}

impl<C, P, N> PasteSender for PlatformInjectionEnvironment<C, P, N>
where
    P: PasteSender,
{
    fn send_paste(&mut self) -> Result<(), String> {
        self.paste_sender.send_paste()
    }
}

impl<C, P, N> InjectionEnvironment for PlatformInjectionEnvironment<C, P, N>
where
    C: Clipboard,
    P: PasteSender,
    N: NativeInsert,
{
}

#[derive(Debug, Clone, Copy, Default)]
pub struct UnsupportedNativeInserter;

impl NativeInsert for UnsupportedNativeInserter {
    fn insert_text(
        &mut self,
        _text: &str,
        _selection_behavior: SelectionBehavior,
    ) -> NativeInsertStatus {
        NativeInsertStatus::Unsupported
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemNativeInserter;

impl NativeInsert for SystemNativeInserter {
    fn insert_text(
        &mut self,
        text: &str,
        selection_behavior: SelectionBehavior,
    ) -> NativeInsertStatus {
        platform_native_insert_text(text, selection_behavior)
    }
}

fn platform_native_insert_text(
    text: &str,
    selection_behavior: SelectionBehavior,
) -> NativeInsertStatus {
    // macOS has no native path: AX `AXSelectedText` writes return success in
    // Electron-based editors (Lark/飞书) without actually mutating the input,
    // so we always fall through to the clipboard paste ladder.
    if cfg!(target_os = "windows") {
        return windows_native_insert_text(text, selection_behavior);
    }

    NativeInsertStatus::Unsupported
}

#[cfg(target_os = "windows")]
fn windows_native_insert_text(
    text: &str,
    selection_behavior: SelectionBehavior,
) -> NativeInsertStatus {
    windows_native_insertion::insert_text(text, selection_behavior)
}

#[cfg(not(target_os = "windows"))]
fn windows_native_insert_text(
    _text: &str,
    _selection_behavior: SelectionBehavior,
) -> NativeInsertStatus {
    NativeInsertStatus::Unsupported
}

pub struct SystemClipboard {
    clipboard: arboard::Clipboard,
}

impl SystemClipboard {
    pub fn new() -> Result<Self, String> {
        arboard::Clipboard::new()
            .map(|clipboard| Self { clipboard })
            .map_err(|error| format!("clipboard unavailable: {error}"))
    }
}

impl Clipboard for SystemClipboard {
    fn read_text(&mut self) -> Result<String, String> {
        self.clipboard
            .get_text()
            .map_err(|error| format!("clipboard read failed: {error}"))
    }

    fn write_text(&mut self, text: &str) -> Result<(), String> {
        self.clipboard
            .set_text(text.to_owned())
            .map_err(|error| format!("clipboard write failed: {error}"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PasteCommand {
    pub program: String,
    pub args: Vec<String>,
}

impl PasteCommand {
    pub fn for_current_platform() -> Result<Self, String> {
        if cfg!(target_os = "macos") {
            return Ok(Self {
                program: "osascript".into(),
                args: vec![
                    "-e".into(),
                    r#"tell application "System Events" to keystroke "v" using command down"#
                        .into(),
                    "-e".into(),
                    "delay 0.2".into(),
                ],
            });
        }

        if cfg!(target_os = "windows") {
            return Ok(Self {
                program: "powershell".into(),
                args: vec![
                    "-NoProfile".into(),
                    "-Command".into(),
                    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')".into(),
                ],
            });
        }

        Err("paste hotkey is supported only on macOS and Windows for MVP".into())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionPane {
    Microphone,
    Accessibility,
}

impl PermissionPane {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "microphone" => Ok(Self::Microphone),
            "accessibility" => Ok(Self::Accessibility),
            _ => Err(format!("unsupported permission pane: {value}")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Microphone => "microphone",
            Self::Accessibility => "accessibility",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStatusKind {
    Granted,
    NeedsReview,
    NotDetermined,
    Denied,
    Restricted,
    NotRequired,
    Unknown,
}

impl PermissionStatusKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Granted => "Granted",
            Self::NeedsReview => "Needs review",
            Self::NotDetermined => "Not requested",
            Self::Denied => "Denied",
            Self::Restricted => "Restricted",
            Self::NotRequired => "Not required",
            Self::Unknown => "Unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MicrophoneAuthorizationStatus {
    NotDetermined,
    Denied,
    Restricted,
    Authorized,
    Unknown,
}

impl MicrophoneAuthorizationStatus {
    fn permission_status_kind(self) -> PermissionStatusKind {
        match self {
            Self::NotDetermined => PermissionStatusKind::NotDetermined,
            Self::Denied => PermissionStatusKind::Denied,
            Self::Restricted => PermissionStatusKind::Restricted,
            Self::Authorized => PermissionStatusKind::Granted,
            Self::Unknown => PermissionStatusKind::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PermissionStatusReport {
    pub pane: PermissionPane,
    pub kind: PermissionStatusKind,
    pub label: String,
    pub detail: String,
}

impl PermissionStatusReport {
    pub fn current(pane: PermissionPane) -> Self {
        let kind = permission_status_kind_for_current_platform(pane);
        Self {
            pane,
            kind,
            label: kind.label().into(),
            detail: permission_status_detail(pane, kind).into(),
        }
    }
}

pub fn permission_statuses() -> Vec<PermissionStatusReport> {
    vec![
        PermissionStatusReport::current(PermissionPane::Microphone),
        PermissionStatusReport::current(PermissionPane::Accessibility),
    ]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionAuthorizationMethod {
    OpenSettings,
    NativeMicrophoneRequest,
    NativeAccessibilityPrompt,
}

impl PermissionAuthorizationMethod {
    pub fn for_current_platform(pane: PermissionPane) -> Self {
        if cfg!(target_os = "macos") {
            return Self::for_platform("macos", pane);
        }

        if cfg!(target_os = "windows") {
            return Self::for_platform("windows", pane);
        }

        Self::OpenSettings
    }

    pub fn for_platform(platform: &str, pane: PermissionPane) -> Self {
        match (platform, pane) {
            ("macos", PermissionPane::Microphone) => Self::NativeMicrophoneRequest,
            ("macos", PermissionPane::Accessibility) => Self::NativeAccessibilityPrompt,
            _ => Self::OpenSettings,
        }
    }
}

pub fn request_permission_authorization(
    pane: PermissionPane,
) -> Result<PermissionStatusReport, String> {
    match PermissionAuthorizationMethod::for_current_platform(pane) {
        PermissionAuthorizationMethod::OpenSettings => {
            PermissionSettingsCommand::open_current(pane)?;
        }
        PermissionAuthorizationMethod::NativeMicrophoneRequest => {
            #[cfg(target_os = "macos")]
            {
                match macos_permissions::microphone_authorization_status() {
                    MicrophoneAuthorizationStatus::NotDetermined => {
                        let _ = macos_permissions::request_microphone_authorization()?;
                    }
                    MicrophoneAuthorizationStatus::Denied
                    | MicrophoneAuthorizationStatus::Restricted
                    | MicrophoneAuthorizationStatus::Unknown => {
                        PermissionSettingsCommand::open_current(pane)?;
                    }
                    MicrophoneAuthorizationStatus::Authorized => {}
                }
            }
        }
        PermissionAuthorizationMethod::NativeAccessibilityPrompt => {
            #[cfg(target_os = "macos")]
            macos_permissions::request_accessibility_authorization()?;
        }
    }

    Ok(PermissionStatusReport::current(pane))
}

fn permission_status_kind_for_current_platform(pane: PermissionPane) -> PermissionStatusKind {
    if cfg!(target_os = "macos") {
        return macos_permission_status_kind(pane);
    }

    if cfg!(target_os = "windows") {
        return match pane {
            PermissionPane::Microphone => PermissionStatusKind::Unknown,
            PermissionPane::Accessibility => PermissionStatusKind::NotRequired,
        };
    }

    PermissionStatusKind::Unknown
}

fn permission_status_detail(pane: PermissionPane, kind: PermissionStatusKind) -> &'static str {
    match (pane, kind) {
        (PermissionPane::Microphone, PermissionStatusKind::Granted) => {
            "Microphone access is allowed."
        }
        (PermissionPane::Microphone, PermissionStatusKind::NeedsReview) => {
            "Open system microphone settings or start a recording to allow Soto."
        }
        (PermissionPane::Microphone, PermissionStatusKind::NotDetermined) => {
            "Soto needs your permission before it can capture microphone audio."
        }
        (PermissionPane::Microphone, PermissionStatusKind::Denied) => {
            "Microphone access was denied. Enable Soto in System Settings."
        }
        (PermissionPane::Microphone, PermissionStatusKind::Restricted) => {
            "Microphone access is restricted by macOS or device policy."
        }
        (PermissionPane::Microphone, PermissionStatusKind::Unknown) => {
            "Soto could not read the microphone permission state on this platform."
        }
        (PermissionPane::Microphone, PermissionStatusKind::NotRequired) => {
            "This platform does not require a separate microphone permission approval."
        }
        (PermissionPane::Accessibility, PermissionStatusKind::Granted) => {
            "Accessibility access is allowed."
        }
        (PermissionPane::Accessibility, PermissionStatusKind::NeedsReview) => {
            "Open system accessibility settings and allow Soto for text insertion."
        }
        (PermissionPane::Accessibility, PermissionStatusKind::NotDetermined)
        | (PermissionPane::Accessibility, PermissionStatusKind::Denied)
        | (PermissionPane::Accessibility, PermissionStatusKind::Restricted) => {
            "Open system accessibility settings and allow Soto for text insertion."
        }
        (PermissionPane::Accessibility, PermissionStatusKind::NotRequired) => {
            "This platform does not require a separate Accessibility approval for the MVP path."
        }
        (PermissionPane::Accessibility, PermissionStatusKind::Unknown) => {
            "Soto could not read the accessibility permission state on this platform."
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_permission_status_kind(pane: PermissionPane) -> PermissionStatusKind {
    macos_permissions::permission_status_kind(pane)
}

#[cfg(not(target_os = "macos"))]
fn macos_permission_status_kind(_pane: PermissionPane) -> PermissionStatusKind {
    PermissionStatusKind::Unknown
}

#[cfg(target_os = "macos")]
mod macos_permissions {
    use std::os::raw::{c_char, c_uchar, c_void};
    use std::ptr;

    use super::{MicrophoneAuthorizationStatus, PermissionPane, PermissionStatusKind};

    const AV_CAPTURE_DEVICE_CLASS: &[u8] = b"AVCaptureDevice\0";
    const AUTHORIZATION_STATUS_SELECTOR: &[u8] = b"authorizationStatusForMediaType:\0";

    #[link(name = "AVFoundation", kind = "framework")]
    unsafe extern "C" {
        static AVMediaTypeAudio: *mut c_void;
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> c_uchar;
        static kAXTrustedCheckOptionPrompt: *const c_void;
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> c_uchar;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFBooleanTrue: *const c_void;
        fn CFDictionaryCreate(
            allocator: *const c_void,
            keys: *const *const c_void,
            values: *const *const c_void,
            num_values: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> *const c_void;
        fn CFRelease(value: *const c_void);
    }

    #[link(name = "objc")]
    unsafe extern "C" {
        fn objc_getClass(name: *const c_char) -> *mut c_void;
        fn sel_registerName(name: *const c_char) -> *mut c_void;
        #[link_name = "objc_msgSend"]
        fn objc_msg_send_authorization_status(
            receiver: *mut c_void,
            selector: *mut c_void,
            media_type: *mut c_void,
        ) -> isize;
    }

    pub fn permission_status_kind(pane: PermissionPane) -> PermissionStatusKind {
        match pane {
            PermissionPane::Microphone => microphone_permission_status_kind(),
            PermissionPane::Accessibility => accessibility_permission_status_kind(),
        }
    }

    pub fn request_accessibility_authorization() -> Result<(), String> {
        unsafe {
            let keys = [kAXTrustedCheckOptionPrompt];
            let values = [kCFBooleanTrue];
            let options = CFDictionaryCreate(
                ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                ptr::null(),
                ptr::null(),
            );
            if options.is_null() {
                return Err("could not build accessibility permission prompt options".into());
            }

            let _ = AXIsProcessTrustedWithOptions(options);
            CFRelease(options);
        }
        Ok(())
    }

    pub fn request_microphone_authorization() -> Result<bool, String> {
        use std::sync::mpsc;
        use std::time::Duration;

        use block2::RcBlock;
        use objc2::msg_send;
        use objc2::runtime::{AnyClass, Bool};

        unsafe {
            let class = AnyClass::get(c"AVCaptureDevice")
                .ok_or_else(|| "could not find AVCaptureDevice class".to_string())?;
            if AVMediaTypeAudio.is_null() {
                return Err("could not build microphone permission request".into());
            }

            let (tx, rx) = mpsc::sync_channel::<bool>(1);
            let completion = RcBlock::new(move |granted: Bool| {
                let _ = tx.send(granted.as_bool());
            });
            let _: () = msg_send![
                class,
                requestAccessForMediaType: AVMediaTypeAudio,
                completionHandler: &*completion
            ];

            rx.recv_timeout(Duration::from_secs(120))
                .map_err(|_| "microphone authorization callback was not invoked".to_string())
        }
    }

    pub fn microphone_authorization_status() -> MicrophoneAuthorizationStatus {
        unsafe {
            let class = objc_getClass(AV_CAPTURE_DEVICE_CLASS.as_ptr().cast());
            let selector = sel_registerName(AUTHORIZATION_STATUS_SELECTOR.as_ptr().cast());

            if class.is_null() || selector.is_null() || AVMediaTypeAudio.is_null() {
                return MicrophoneAuthorizationStatus::Unknown;
            }

            let status = objc_msg_send_authorization_status(class, selector, AVMediaTypeAudio);
            match status {
                0 => MicrophoneAuthorizationStatus::NotDetermined,
                1 => MicrophoneAuthorizationStatus::Restricted,
                2 => MicrophoneAuthorizationStatus::Denied,
                3 => MicrophoneAuthorizationStatus::Authorized,
                _ => MicrophoneAuthorizationStatus::Unknown,
            }
        }
    }

    fn microphone_permission_status_kind() -> PermissionStatusKind {
        microphone_authorization_status().permission_status_kind()
    }

    fn accessibility_permission_status_kind() -> PermissionStatusKind {
        unsafe {
            if AXIsProcessTrusted() == 0 {
                PermissionStatusKind::NeedsReview
            } else {
                PermissionStatusKind::Granted
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionSettingsCommand {
    pub program: String,
    pub args: Vec<String>,
}

impl PermissionSettingsCommand {
    pub fn for_current_platform(pane: PermissionPane) -> Result<Self, String> {
        if cfg!(target_os = "macos") {
            return Self::for_platform("macos", pane);
        }

        if cfg!(target_os = "windows") {
            return Self::for_platform("windows", pane);
        }

        Self::for_platform("unsupported", pane)
    }

    pub fn for_platform(platform: &str, pane: PermissionPane) -> Result<Self, String> {
        match platform {
            "macos" => Ok(Self {
                program: "open".into(),
                args: vec![match pane {
                    PermissionPane::Microphone => {
                        "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
                    }
                    PermissionPane::Accessibility => {
                        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
                    }
                }
                .into()],
            }),
            "windows" => Ok(Self {
                program: "cmd".into(),
                args: vec![
                    "/C".into(),
                    "start".into(),
                    "".into(),
                    match pane {
                        PermissionPane::Microphone => "ms-settings:privacy-microphone",
                        PermissionPane::Accessibility => "ms-settings:easeofaccess-keyboard",
                    }
                    .into(),
                ],
            }),
            _ => Err("permission settings are supported only on macOS and Windows for MVP".into()),
        }
    }

    pub fn open_current(pane: PermissionPane) -> Result<(), String> {
        let command = Self::for_current_platform(pane)?;
        let status = Command::new(&command.program)
            .args(&command.args)
            .status()
            .map_err(|error| format!("permission settings failed to launch: {error}"))?;

        if status.success() {
            Ok(())
        } else {
            Err(format!("permission settings exited with status: {status}"))
        }
    }
}

pub trait CommandRunner {
    fn run(&mut self, command: &PasteCommand) -> Result<(), String>;
}

pub struct SystemCommandRunner;

impl CommandRunner for SystemCommandRunner {
    fn run(&mut self, command: &PasteCommand) -> Result<(), String> {
        let status = Command::new(&command.program)
            .args(&command.args)
            .status()
            .map_err(|error| format!("paste command failed to launch: {error}"))?;

        if status.success() {
            Ok(())
        } else {
            Err(format!("paste command exited with status: {status}"))
        }
    }
}

pub struct OsPasteSender<R = SystemCommandRunner> {
    runner: R,
}

impl<R> OsPasteSender<R> {
    pub fn new(runner: R) -> Self {
        Self { runner }
    }

    pub fn runner(&self) -> &R {
        &self.runner
    }
}

impl Default for OsPasteSender<SystemCommandRunner> {
    fn default() -> Self {
        Self::new(SystemCommandRunner)
    }
}

impl<R> PasteSender for OsPasteSender<R>
where
    R: CommandRunner,
{
    fn send_paste(&mut self) -> Result<(), String> {
        let command = PasteCommand::for_current_platform()?;
        self.runner.run(&command)
    }
}

#[cfg(target_os = "windows")]
mod windows_native_insertion {
    use soto_core::SelectionBehavior;
    use soto_injection::NativeInsertStatus;
    use std::mem;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, SendInput,
        VIRTUAL_KEY,
    };

    pub fn insert_text(text: &str, selection_behavior: SelectionBehavior) -> NativeInsertStatus {
        if matches!(selection_behavior, SelectionBehavior::AlwaysAppend) {
            return NativeInsertStatus::Unsupported;
        }
        let plan = keystroke_plan_for(text);
        if plan.is_empty() {
            return NativeInsertStatus::Inserted;
        }
        match send_keystroke_plan(&plan) {
            Ok(()) => NativeInsertStatus::Inserted,
            Err(message) => NativeInsertStatus::Failed(message),
        }
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) struct KeystrokeUnit {
        pub code_unit: u16,
        pub kind: KeystrokeKind,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) enum KeystrokeKind {
        KeyDown,
        KeyUp,
    }

    pub(crate) fn keystroke_plan_for(text: &str) -> Vec<KeystrokeUnit> {
        let mut plan = Vec::with_capacity(text.len() * 2);
        let mut buf = [0u16; 2];
        for ch in text.chars() {
            let units = ch.encode_utf16(&mut buf);
            for unit in units.iter() {
                let code_unit = *unit;
                plan.push(KeystrokeUnit {
                    code_unit,
                    kind: KeystrokeKind::KeyDown,
                });
                plan.push(KeystrokeUnit {
                    code_unit,
                    kind: KeystrokeKind::KeyUp,
                });
            }
        }
        plan
    }

    fn keybd_input_for(unit: KeystrokeUnit) -> KEYBDINPUT {
        let mut flags = KEYEVENTF_UNICODE;
        if matches!(unit.kind, KeystrokeKind::KeyUp) {
            flags |= KEYEVENTF_KEYUP;
        }
        KEYBDINPUT {
            wVk: VIRTUAL_KEY(0),
            wScan: unit.code_unit,
            dwFlags: flags,
            time: 0,
            dwExtraInfo: 0,
        }
    }

    fn inputs_for_plan(plan: &[KeystrokeUnit]) -> Vec<INPUT> {
        plan.iter()
            .copied()
            .map(|unit| INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: keybd_input_for(unit),
                },
            })
            .collect()
    }

    fn send_keystroke_plan(plan: &[KeystrokeUnit]) -> Result<(), String> {
        if plan.is_empty() {
            return Ok(());
        }
        let inputs = inputs_for_plan(plan);
        // SAFETY: `inputs` is a valid, non-empty slice of `INPUT` structs whose
        // `Anonymous.ki` union members are the only initialised fields, matching
        // `INPUT_KEYBOARD`. `mem::size_of::<INPUT>()` always fits in i32.
        let sent = unsafe { SendInput(&inputs, mem::size_of::<INPUT>() as i32) };
        if (sent as usize) == inputs.len() {
            Ok(())
        } else {
            Err(format!(
                "SendInput delivered {sent} of {} events",
                inputs.len()
            ))
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn keystroke_plan_for_emits_keydown_keyup_per_ascii_bmp_char() {
            let plan = keystroke_plan_for("ab");
            assert_eq!(
                plan,
                vec![
                    KeystrokeUnit {
                        code_unit: b'a' as u16,
                        kind: KeystrokeKind::KeyDown
                    },
                    KeystrokeUnit {
                        code_unit: b'a' as u16,
                        kind: KeystrokeKind::KeyUp
                    },
                    KeystrokeUnit {
                        code_unit: b'b' as u16,
                        kind: KeystrokeKind::KeyDown
                    },
                    KeystrokeUnit {
                        code_unit: b'b' as u16,
                        kind: KeystrokeKind::KeyUp
                    },
                ]
            );
        }

        #[test]
        fn keystroke_plan_for_emits_keydown_keyup_for_cjk_bmp_char() {
            let plan = keystroke_plan_for("\u{4F60}");
            assert_eq!(plan.len(), 2);
            assert_eq!(
                plan[0],
                KeystrokeUnit {
                    code_unit: 0x4F60,
                    kind: KeystrokeKind::KeyDown
                }
            );
            assert_eq!(
                plan[1],
                KeystrokeUnit {
                    code_unit: 0x4F60,
                    kind: KeystrokeKind::KeyUp
                }
            );
        }

        #[test]
        fn keystroke_plan_for_splits_supplementary_chars_into_utf16_surrogate_pairs() {
            let plan = keystroke_plan_for("\u{1F600}");
            assert_eq!(
                plan,
                vec![
                    KeystrokeUnit {
                        code_unit: 0xD83D,
                        kind: KeystrokeKind::KeyDown
                    },
                    KeystrokeUnit {
                        code_unit: 0xD83D,
                        kind: KeystrokeKind::KeyUp
                    },
                    KeystrokeUnit {
                        code_unit: 0xDE00,
                        kind: KeystrokeKind::KeyDown
                    },
                    KeystrokeUnit {
                        code_unit: 0xDE00,
                        kind: KeystrokeKind::KeyUp
                    },
                ]
            );
        }

        #[test]
        fn keystroke_plan_for_preserves_order_across_bmp_and_supplementary_chars() {
            let plan = keystroke_plan_for("a\u{1F600}b");
            assert_eq!(plan.len(), 8);
            assert_eq!(plan[0].code_unit, b'a' as u16);
            assert_eq!(plan[2].code_unit, 0xD83D);
            assert_eq!(plan[4].code_unit, 0xDE00);
            assert_eq!(plan[6].code_unit, b'b' as u16);
            for (i, unit) in plan.iter().enumerate() {
                if i % 2 == 0 {
                    assert_eq!(unit.kind, KeystrokeKind::KeyDown, "index {i}");
                } else {
                    assert_eq!(unit.kind, KeystrokeKind::KeyUp, "index {i}");
                }
            }
        }

        #[test]
        fn insert_text_returns_unsupported_for_always_append() {
            assert_eq!(
                insert_text("hello", SelectionBehavior::AlwaysAppend),
                NativeInsertStatus::Unsupported
            );
        }

        #[test]
        fn keybd_input_for_keydown_uses_unicode_flag_only() {
            let unit = KeystrokeUnit {
                code_unit: 0x4F60,
                kind: KeystrokeKind::KeyDown,
            };
            let kbd = keybd_input_for(unit);
            assert_eq!(kbd.dwFlags, KEYEVENTF_UNICODE);
            assert_eq!(kbd.wVk, VIRTUAL_KEY(0));
            assert_eq!(kbd.wScan, 0x4F60);
        }

        #[test]
        fn keybd_input_for_keyup_uses_unicode_and_keyup_flags() {
            let unit = KeystrokeUnit {
                code_unit: 0xD83D,
                kind: KeystrokeKind::KeyUp,
            };
            let kbd = keybd_input_for(unit);
            assert_eq!(kbd.dwFlags, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
            assert_eq!(kbd.wVk, VIRTUAL_KEY(0));
            assert_eq!(kbd.wScan, 0xD83D);
        }

        #[test]
        fn keybd_input_for_keeps_code_unit_in_scan_field_for_both_edges() {
            let down = keybd_input_for(KeystrokeUnit {
                code_unit: 0xDE00,
                kind: KeystrokeKind::KeyDown,
            });
            let up = keybd_input_for(KeystrokeUnit {
                code_unit: 0xDE00,
                kind: KeystrokeKind::KeyUp,
            });
            assert_eq!(down.wScan, 0xDE00);
            assert_eq!(up.wScan, 0xDE00);
        }

        #[test]
        fn inputs_for_plan_emits_one_input_per_keystroke_unit_with_keyboard_type() {
            let plan = vec![
                KeystrokeUnit {
                    code_unit: b'x' as u16,
                    kind: KeystrokeKind::KeyDown,
                },
                KeystrokeUnit {
                    code_unit: b'x' as u16,
                    kind: KeystrokeKind::KeyUp,
                },
                KeystrokeUnit {
                    code_unit: 0xD83D,
                    kind: KeystrokeKind::KeyDown,
                },
            ];
            let inputs = inputs_for_plan(&plan);
            assert_eq!(inputs.len(), 3);
            for input in &inputs {
                assert_eq!(input.r#type, INPUT_KEYBOARD);
            }
        }

        #[test]
        fn send_keystroke_plan_with_empty_plan_returns_ok_without_calling_sendinput() {
            assert_eq!(send_keystroke_plan(&[]), Ok(()));
        }
    }
}
