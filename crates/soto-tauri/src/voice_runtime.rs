use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
        mpsc::{Receiver, TryRecvError},
    },
    time::Duration,
};

use serde::Serialize;
use soto_audio::{
    BufferedRecordingFileRecorder, CapturedRecordingFile, LevelSnapshotHandle,
    NativeMicrophoneRecorder, NativeMicrophoneRecorderError, RecorderError, RecordingFileRecorder,
};
use soto_storage::StorageRoot;
use tauri::{AppHandle, Emitter, Manager, Wry};
use uuid::Uuid;

use crate::{
    CompleteFinalTranscriptResult, HotkeyRuntimeAction, ProviderBackend, StartVoiceSessionRequest,
    TextInjectorFactory, VoiceSessionHandle, VoiceSessionStatus,
    provider_backend::{ActiveVoiceSession, VoiceSessionPrepareError},
};

pub const VOICE_RUNTIME_EVENT: &str = "soto://voice-runtime";

pub const CAPSULE_WINDOW_LABEL: &str = "capsule";
const CAPSULE_HIDE_DELAY_MS: u64 = 350;
const CAPSULE_ERROR_HIDE_DELAY_MS: u64 = 3000;
const CAPSULE_MARGIN_ABOVE_WORK_AREA: f64 = 10.0;
const CAPSULE_MARGIN_ABOVE_SCREEN_BOTTOM: f64 = 72.0;
const VOICE_LEVEL_POLL_INTERVAL_MS: u64 = 50;
pub const VOICE_COMPLETION_TIMEOUT: Duration = Duration::from_secs(75);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceRuntimeErrorCode {
    MissingProvider,
    Generic,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceRuntimeStartError {
    pub code: VoiceRuntimeErrorCode,
    pub message: String,
}

impl VoiceRuntimeStartError {
    pub fn missing_provider() -> Self {
        Self {
            code: VoiceRuntimeErrorCode::MissingProvider,
            message: VoiceSessionPrepareError::MissingProvider.to_string(),
        }
    }

    pub fn generic(message: impl Into<String>) -> Self {
        Self {
            code: VoiceRuntimeErrorCode::Generic,
            message: message.into(),
        }
    }
}

impl From<VoiceSessionPrepareError> for VoiceRuntimeStartError {
    fn from(error: VoiceSessionPrepareError) -> Self {
        match error {
            VoiceSessionPrepareError::MissingProvider => Self::missing_provider(),
            VoiceSessionPrepareError::Other(message) => Self::generic(message),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapsuleVisibilityIntent {
    Show,
    HideAfterDelay,
    ShowThenHideAfterDelay,
}

pub fn capsule_visibility_intent(event: &VoiceRuntimeEvent) -> CapsuleVisibilityIntent {
    match event {
        VoiceRuntimeEvent::Started(_) | VoiceRuntimeEvent::Thinking(_) => {
            CapsuleVisibilityIntent::Show
        }
        VoiceRuntimeEvent::Level { .. } => CapsuleVisibilityIntent::Show,
        VoiceRuntimeEvent::Completed(_)
        | VoiceRuntimeEvent::Cancelled(_)
        | VoiceRuntimeEvent::Failed(_) => CapsuleVisibilityIntent::HideAfterDelay,
        VoiceRuntimeEvent::Error { .. } => CapsuleVisibilityIntent::ShowThenHideAfterDelay,
    }
}

pub trait VoiceAudioRecorder {
    fn start(&mut self, handle: &VoiceSessionHandle) -> Result<(), String>;
    fn finish(&mut self) -> Result<CapturedRecordingFile, String>;
    fn cancel(&mut self) -> Result<(), String>;
    fn level_snapshot_handle(&self) -> Option<LevelSnapshotHandle> {
        None
    }
}

pub trait VoiceRuntimeBackend {
    type Session;

    fn start_voice_session(
        &mut self,
        mode_id: &str,
    ) -> Result<Self::Session, VoiceRuntimeStartError>;
    fn session_handle(session: &Self::Session) -> VoiceSessionHandle;
    fn complete_voice_session<'a>(
        &'a mut self,
        session: Self::Session,
        recording: CapturedRecordingFile,
    ) -> Pin<Box<dyn Future<Output = Result<CompleteFinalTranscriptResult, String>> + 'a>>;
    fn cancel_voice_session<'a>(
        &'a mut self,
        session: Self::Session,
    ) -> Pin<Box<dyn Future<Output = Result<CompleteFinalTranscriptResult, String>> + 'a>>;
    fn fail_voice_session<'a>(
        &'a mut self,
        session: Self::Session,
        message: String,
    ) -> Pin<Box<dyn Future<Output = Result<CompleteFinalTranscriptResult, String>> + 'a>>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VoiceRuntimeOutcome {
    Started(VoiceSessionHandle),
    Completed(CompleteFinalTranscriptResult),
    Cancelled(CompleteFinalTranscriptResult),
    Failed(CompleteFinalTranscriptResult),
    Error {
        code: VoiceRuntimeErrorCode,
        message: String,
    },
    Ignored,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VoiceRuntimeEvent {
    Started(VoiceSessionHandle),
    Thinking(VoiceSessionHandle),
    Completed(CompleteFinalTranscriptResult),
    Cancelled(CompleteFinalTranscriptResult),
    Failed(CompleteFinalTranscriptResult),
    Error {
        code: VoiceRuntimeErrorCode,
        message: String,
    },
    Level {
        rms: u16,
        peak: u16,
    },
}

pub trait VoiceRuntimeEventSink {
    fn emit(&mut self, event: VoiceRuntimeEvent);
}

pub struct TauriVoiceRuntimeEventSink {
    app: AppHandle<Wry>,
    show_epoch: Arc<AtomicU64>,
}

impl TauriVoiceRuntimeEventSink {
    pub fn new(app: AppHandle<Wry>) -> Self {
        Self {
            app,
            show_epoch: Arc::new(AtomicU64::new(0)),
        }
    }

    fn show_capsule(&self) {
        let epoch = self.show_epoch.fetch_add(1, Ordering::SeqCst) + 1;
        let Some(window) = self.app.get_webview_window(CAPSULE_WINDOW_LABEL) else {
            eprintln!(
                "[soto-runtime] show_capsule: webview window '{CAPSULE_WINDOW_LABEL}' not found"
            );
            return;
        };
        position_capsule_bottom_center(&window);
        if let Err(error) = window.show() {
            eprintln!("[soto-runtime] show_capsule: window.show() failed: {error}");
            return;
        }
        // Force the capsule to the top of the topmost Z-order group with no
        // activation. Tauri's `set_always_on_top(true)` on Windows is
        // insufficient when the same process's main window currently owns
        // foreground — the capsule stays in the topmost *group* but the OS
        // does not re-rank it within that group, so the focused-but-not-
        // topmost main can render on top of it. Going straight to Win32
        // SetWindowPos with HWND_TOPMOST + SWP_NOACTIVATE bypasses that.
        force_capsule_topmost(&window);
        log_capsule_geometry(&window, epoch);
    }

    fn hide_capsule_after_delay(&self) {
        self.hide_capsule_after(CAPSULE_HIDE_DELAY_MS);
    }

    fn hide_capsule_after(&self, delay_ms: u64) {
        let epoch_at_schedule = self.show_epoch.load(Ordering::SeqCst);
        let epoch_handle = self.show_epoch.clone();
        if let Some(window) = self.app.get_webview_window(CAPSULE_WINDOW_LABEL) {
            eprintln!(
                "[soto-runtime] hide_capsule_after_delay: scheduled in {delay_ms}ms (epoch={epoch_at_schedule})"
            );
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(delay_ms));
                let current = epoch_handle.load(Ordering::SeqCst);
                if current == epoch_at_schedule {
                    if let Err(error) = window.hide() {
                        eprintln!(
                            "[soto-runtime] hide_capsule_after_delay: window.hide() failed: {error}"
                        );
                    } else {
                        eprintln!(
                            "[soto-runtime] hide_capsule_after_delay: hidden (epoch={epoch_at_schedule})"
                        );
                    }
                } else {
                    eprintln!(
                        "[soto-runtime] hide_capsule_after_delay: skipped — newer show happened (scheduled={epoch_at_schedule}, now={current})"
                    );
                }
            });
        } else {
            eprintln!(
                "[soto-runtime] hide_capsule_after_delay: webview window '{CAPSULE_WINDOW_LABEL}' not found"
            );
        }
    }
}

impl VoiceRuntimeEventSink for TauriVoiceRuntimeEventSink {
    fn emit(&mut self, event: VoiceRuntimeEvent) {
        if !matches!(event, VoiceRuntimeEvent::Level { .. }) {
            match capsule_visibility_intent(&event) {
                CapsuleVisibilityIntent::Show => self.show_capsule(),
                CapsuleVisibilityIntent::HideAfterDelay => self.hide_capsule_after_delay(),
                CapsuleVisibilityIntent::ShowThenHideAfterDelay => {
                    self.show_capsule();
                    self.hide_capsule_after(CAPSULE_ERROR_HIDE_DELAY_MS);
                }
            }
        }
        let _ = self.app.emit(VOICE_RUNTIME_EVENT, event);
    }
}

pub struct VoiceRuntime<B, R>
where
    B: VoiceRuntimeBackend,
    R: VoiceAudioRecorder,
{
    backend: B,
    recorder: R,
    active: Option<B::Session>,
}

pub struct VoiceRuntimeWorker<B, R, S>
where
    B: VoiceRuntimeBackend,
    R: VoiceAudioRecorder,
    S: VoiceRuntimeEventSink,
{
    runtime: VoiceRuntime<B, R>,
    sink: Arc<tokio::sync::Mutex<S>>,
    level_task: Option<tokio::task::JoinHandle<()>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VoiceRuntimeTarget {
    pub app: String,
    pub window_title: String,
    pub control_type: String,
}

pub struct ProviderVoiceRuntimeBackend<'a, F>
where
    F: TextInjectorFactory,
{
    backend: &'a ProviderBackend<F>,
    target: VoiceRuntimeTarget,
}

impl<'a, F> ProviderVoiceRuntimeBackend<'a, F>
where
    F: TextInjectorFactory,
{
    pub fn new(backend: &'a ProviderBackend<F>, target: VoiceRuntimeTarget) -> Self {
        Self { backend, target }
    }
}

pub struct ProviderVoiceRuntimeSession {
    handle: VoiceSessionHandle,
    active: ActiveVoiceSession,
}

pub(crate) fn spawn_voice_runtime_worker(
    app: AppHandle<Wry>,
    storage: StorageRoot,
    http_client: Arc<std::sync::RwLock<reqwest::Client>>,
    receiver: Receiver<HotkeyRuntimeAction>,
) {
    std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                eprintln!("[soto-runtime] worker: tokio runtime build FAILED: {error}");
                let mut sink = TauriVoiceRuntimeEventSink::new(app);
                sink.emit(VoiceRuntimeEvent::Error {
                    code: VoiceRuntimeErrorCode::Generic,
                    message: format!("voice runtime worker could not start: {error}"),
                });
                return;
            }
        };
        let microphone_device_id = storage
            .read_settings()
            .ok()
            .and_then(|settings| settings.microphone_device_id);
        eprintln!(
            "[soto-runtime] worker: started (mic_device_id={:?})",
            microphone_device_id
        );
        let backend = ProviderBackend::from_storage_with_shared_client(storage, http_client);
        let backend = ProviderVoiceRuntimeBackend::new(&backend, VoiceRuntimeTarget::default());
        let recorder = NativeMicrophoneRecorder::new_with_device_id(microphone_device_id, 64);
        let voice_runtime = VoiceRuntime::new(backend, recorder);
        let mut worker =
            VoiceRuntimeWorker::new(voice_runtime, TauriVoiceRuntimeEventSink::new(app));

        while let Ok(action) = receiver.recv() {
            eprintln!("[soto-runtime] worker: received action={action:?}");
            let outcome = runtime.block_on(worker.handle_action(action));
            eprintln!("[soto-runtime] worker: outcome={}", outcome_label(&outcome));
            let drained = runtime.block_on(worker.drain_pending(&receiver));
            for outcome in &drained {
                eprintln!(
                    "[soto-runtime] worker: drained outcome={}",
                    outcome_label(outcome)
                );
            }
        }
        eprintln!("[soto-runtime] worker: receiver disconnected, exiting");
    });
}

fn outcome_label(outcome: &VoiceRuntimeOutcome) -> String {
    match outcome {
        VoiceRuntimeOutcome::Started(handle) => format!("Started(mode={})", handle.mode_id),
        VoiceRuntimeOutcome::Completed(result) => format!("Completed({})", result_summary(result)),
        VoiceRuntimeOutcome::Cancelled(result) => format!("Cancelled({})", result_summary(result)),
        VoiceRuntimeOutcome::Failed(result) => format!("Failed({})", result_summary(result)),
        VoiceRuntimeOutcome::Error { code, message } => format!("Error(code={code:?}, {message})"),
        VoiceRuntimeOutcome::Ignored => "Ignored".to_string(),
    }
}

fn result_summary(result: &CompleteFinalTranscriptResult) -> String {
    format!(
        "history_id={} status={:?} raw_chars={} final_chars={} final_text={:?} injection={}",
        result.history_id,
        result.status,
        result.raw_text.chars().count(),
        result.final_text.chars().count(),
        result.final_text,
        injection_outcome_label(&result.injection_outcome)
    )
}

fn injection_outcome_label(outcome: &soto_core::InjectionOutcome) -> &'static str {
    match outcome {
        soto_core::InjectionOutcome::Inserted => "inserted",
        soto_core::InjectionOutcome::PasteSent => "paste_sent",
        soto_core::InjectionOutcome::CopiedFallback => "copied_fallback",
        soto_core::InjectionOutcome::NoOp => "no_op",
        soto_core::InjectionOutcome::Failed(_) => "failed",
    }
}

#[cfg(target_os = "windows")]
fn force_capsule_topmost(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SetWindowPos,
    };

    let hwnd = match window.hwnd() {
        Ok(hwnd) => hwnd,
        Err(error) => {
            eprintln!("[soto-runtime] force_capsule_topmost: hwnd() failed: {error}");
            return;
        }
    };
    let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW;
    match unsafe { SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, flags) } {
        Ok(()) => eprintln!(
            "[soto-runtime] force_capsule_topmost: SetWindowPos(HWND_TOPMOST, NOACTIVATE|SHOWWINDOW) ok hwnd={:?}",
            hwnd.0
        ),
        Err(error) => eprintln!(
            "[soto-runtime] force_capsule_topmost: SetWindowPos failed: {error} hwnd={:?}",
            hwnd.0
        ),
    }
}

#[cfg(not(target_os = "windows"))]
fn force_capsule_topmost(window: &tauri::WebviewWindow) {
    if let Err(error) = window.set_always_on_top(true) {
        eprintln!("[soto-runtime] force_capsule_topmost: set_always_on_top failed: {error}");
    }
}

fn position_capsule_bottom_center(window: &tauri::WebviewWindow) {
    let monitor = cursor_monitor(window)
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        eprintln!("[soto-runtime] position_capsule_bottom_center: monitor unavailable");
        return;
    };
    let size = match window.outer_size() {
        Ok(size) => size,
        Err(error) => {
            eprintln!("[soto-runtime] position_capsule_bottom_center: outer_size failed: {error}");
            return;
        }
    };
    let target = capsule_bottom_center_position(
        *monitor.position(),
        *monitor.size(),
        size,
        monitor.scale_factor(),
        monitor_work_area_bottom(window, &monitor),
    );
    if let Err(error) = window.set_position(tauri::Position::Physical(target)) {
        eprintln!(
            "[soto-runtime] position_capsule_bottom_center: set_position failed: {error} target=({},{})",
            target.x, target.y
        );
    }
}

fn cursor_monitor(window: &tauri::WebviewWindow) -> Option<tauri::Monitor> {
    let cursor = match window.cursor_position() {
        Ok(cursor) => cursor,
        Err(error) => {
            eprintln!(
                "[soto-runtime] position_capsule_bottom_center: cursor_position failed: {error}"
            );
            return None;
        }
    };
    let monitors = match window.available_monitors() {
        Ok(monitors) => monitors,
        Err(error) => {
            eprintln!(
                "[soto-runtime] position_capsule_bottom_center: available_monitors failed: {error}"
            );
            return None;
        }
    };
    monitors.into_iter().find(|monitor| {
        monitor_contains_cursor_position(*monitor.position(), *monitor.size(), cursor)
    })
}

fn monitor_contains_cursor_position(
    monitor_position: tauri::PhysicalPosition<i32>,
    monitor_size: tauri::PhysicalSize<u32>,
    cursor_position: tauri::PhysicalPosition<f64>,
) -> bool {
    if !cursor_position.x.is_finite() || !cursor_position.y.is_finite() {
        return false;
    }

    let left = f64::from(monitor_position.x);
    let top = f64::from(monitor_position.y);
    let right = left + f64::from(monitor_size.width);
    let bottom = top + f64::from(monitor_size.height);

    cursor_position.x >= left
        && cursor_position.x < right
        && cursor_position.y >= top
        && cursor_position.y < bottom
}

fn capsule_bottom_center_position(
    monitor_position: tauri::PhysicalPosition<i32>,
    monitor_size: tauri::PhysicalSize<u32>,
    window_size: tauri::PhysicalSize<u32>,
    scale_factor: f64,
    work_area_bottom: Option<i32>,
) -> tauri::PhysicalPosition<i32> {
    let scale_factor = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    let work_area_margin = (CAPSULE_MARGIN_ABOVE_WORK_AREA * scale_factor).round() as i32;
    let screen_bottom_margin = (CAPSULE_MARGIN_ABOVE_SCREEN_BOTTOM * scale_factor).round() as i32;
    let monitor_width = monitor_size.width as i32;
    let monitor_height = monitor_size.height as i32;
    let window_width = window_size.width as i32;
    let window_height = window_size.height as i32;
    let x = monitor_position.x + (monitor_width - window_width).max(0) / 2;
    let y = match work_area_bottom {
        Some(bottom) => (bottom - window_height - work_area_margin).max(monitor_position.y),
        None => monitor_position.y + (monitor_height - window_height - screen_bottom_margin).max(0),
    };

    tauri::PhysicalPosition::new(x, y)
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
struct MacMonitorMetrics {
    position: tauri::PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
}

#[cfg(target_os = "macos")]
impl MacMonitorMetrics {
    fn from_monitor(monitor: &tauri::Monitor) -> Self {
        Self {
            position: *monitor.position(),
            size: *monitor.size(),
        }
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
struct MacPhysicalRect {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

#[cfg(target_os = "macos")]
impl MacPhysicalRect {
    fn from_monitor(metrics: MacMonitorMetrics) -> Self {
        let left = f64::from(metrics.position.x);
        let top = f64::from(metrics.position.y);
        Self {
            left,
            top,
            right: left + f64::from(metrics.size.width),
            bottom: top + f64::from(metrics.size.height),
        }
    }

    fn rounded_matches(self, other: Self) -> bool {
        self.left.round() == other.left.round()
            && self.top.round() == other.top.round()
            && self.right.round() == other.right.round()
            && self.bottom.round() == other.bottom.round()
    }

    fn intersection_area(self, other: Self) -> f64 {
        let width = (self.right.min(other.right) - self.left.max(other.left)).max(0.0);
        let height = (self.bottom.min(other.bottom) - self.top.max(other.top)).max(0.0);
        width * height
    }
}

#[cfg(target_os = "macos")]
fn monitor_work_area_bottom(
    window: &tauri::WebviewWindow,
    monitor: &tauri::Monitor,
) -> Option<i32> {
    let metrics = MacMonitorMetrics::from_monitor(monitor);
    if objc2::MainThreadMarker::new().is_some() {
        return macos_monitor_work_area_bottom(metrics);
    }

    let (sender, receiver) = std::sync::mpsc::channel();
    if let Err(error) = window.run_on_main_thread(move || {
        let _ = sender.send(macos_monitor_work_area_bottom(metrics));
    }) {
        eprintln!("[soto-runtime] monitor_work_area_bottom: main-thread dispatch failed: {error}");
        return None;
    }

    match receiver.recv_timeout(Duration::from_millis(100)) {
        Ok(bottom) => bottom,
        Err(error) => {
            eprintln!("[soto-runtime] monitor_work_area_bottom: main-thread query failed: {error}");
            None
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_monitor_work_area_bottom(metrics: MacMonitorMetrics) -> Option<i32> {
    match std::panic::catch_unwind(|| macos_monitor_work_area_bottom_inner(metrics)) {
        Ok(bottom) => bottom,
        Err(_) => {
            eprintln!("[soto-runtime] monitor_work_area_bottom: NSScreen query panicked");
            None
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_monitor_work_area_bottom_inner(metrics: MacMonitorMetrics) -> Option<i32> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;

    let main_thread = MainThreadMarker::new()?;
    let screens = NSScreen::screens(main_thread);
    let primary_frame = screens.iter().next()?.frame();
    let primary_height = primary_frame.size.height as f64;
    let monitor_rect = MacPhysicalRect::from_monitor(metrics);
    let mut best_intersection = 0.0;
    let mut best_bottom = None;

    for screen in screens.iter() {
        let scale_factor = screen.backingScaleFactor() as f64;
        if !scale_factor.is_finite() || scale_factor <= 0.0 {
            continue;
        }

        let frame = screen.frame();
        let left = frame.origin.x as f64 * scale_factor;
        // Cocoa screen frames are Y-up in points. Tauri monitor bounds are
        // Y-down in physical pixels, so flip through the primary height.
        let top =
            (primary_height - frame.origin.y as f64 - frame.size.height as f64) * scale_factor;
        let screen_rect = MacPhysicalRect {
            left,
            top,
            right: left + frame.size.width as f64 * scale_factor,
            bottom: top + frame.size.height as f64 * scale_factor,
        };
        let visible_frame = screen.visibleFrame();
        let visible_bottom =
            ((primary_height - visible_frame.origin.y as f64) * scale_factor).round() as i32;

        if screen_rect.rounded_matches(monitor_rect) {
            return Some(visible_bottom);
        }

        let intersection = screen_rect.intersection_area(monitor_rect);
        if intersection > best_intersection {
            best_intersection = intersection;
            best_bottom = Some(visible_bottom);
        }
    }

    best_bottom
}

#[cfg(target_os = "windows")]
fn monitor_work_area_bottom(
    _window: &tauri::WebviewWindow,
    monitor: &tauri::Monitor,
) -> Option<i32> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromRect,
    };

    let position = monitor.position();
    let size = monitor.size();
    let rect = RECT {
        left: position.x,
        top: position.y,
        right: position.x + size.width as i32,
        bottom: position.y + size.height as i32,
    };
    let hmonitor = unsafe { MonitorFromRect(&rect, MONITOR_DEFAULTTONEAREST) };
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if unsafe { GetMonitorInfoW(hmonitor, &mut info) }.as_bool() {
        Some(info.rcWork.bottom)
    } else {
        eprintln!("[soto-runtime] monitor_work_area_bottom: GetMonitorInfoW failed");
        None
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn monitor_work_area_bottom(
    _window: &tauri::WebviewWindow,
    _monitor: &tauri::Monitor,
) -> Option<i32> {
    None
}

fn log_capsule_geometry(window: &tauri::WebviewWindow, epoch: u64) {
    let visible = window
        .is_visible()
        .map(|v| v.to_string())
        .unwrap_or_else(|err| format!("err({err})"));
    let position = window
        .outer_position()
        .map(|p| format!("({},{})", p.x, p.y))
        .unwrap_or_else(|err| format!("err({err})"));
    let size = window
        .outer_size()
        .map(|s| format!("{}x{}", s.width, s.height))
        .unwrap_or_else(|err| format!("err({err})"));
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let pos = m.position();
            let sz = m.size();
            format!(
                "name={:?} pos=({},{}) size={}x{} scale={}",
                m.name(),
                pos.x,
                pos.y,
                sz.width,
                sz.height,
                m.scale_factor()
            )
        })
        .unwrap_or_else(|| "none".to_string());
    eprintln!(
        "[soto-runtime] show_capsule: shown (epoch={epoch}) visible={visible} outer_pos={position} outer_size={size} monitor=[{monitor}]"
    );
}

impl<B, R> VoiceRuntime<B, R>
where
    B: VoiceRuntimeBackend,
    R: VoiceAudioRecorder,
{
    pub fn new(backend: B, recorder: R) -> Self {
        Self {
            backend,
            recorder,
            active: None,
        }
    }

    pub fn level_snapshot_handle(&self) -> Option<LevelSnapshotHandle> {
        self.recorder.level_snapshot_handle()
    }

    pub async fn handle_hotkey_action(
        &mut self,
        action: HotkeyRuntimeAction,
    ) -> VoiceRuntimeOutcome {
        match action {
            HotkeyRuntimeAction::StartRecording { mode_id } => self.start_recording(&mode_id).await,
            HotkeyRuntimeAction::FinishRecording { .. } => self.finish_recording().await,
            HotkeyRuntimeAction::CancelRecording { .. } => self.cancel_recording().await,
        }
    }

    pub async fn handle_hotkey_action_with_events(
        &mut self,
        action: HotkeyRuntimeAction,
        sink: &mut impl VoiceRuntimeEventSink,
    ) -> VoiceRuntimeOutcome {
        let outcome = match action {
            HotkeyRuntimeAction::StartRecording { mode_id } => self.start_recording(&mode_id).await,
            HotkeyRuntimeAction::FinishRecording { .. } => {
                self.finish_recording_with_events(sink).await
            }
            HotkeyRuntimeAction::CancelRecording { .. } => self.cancel_recording().await,
        };
        emit_outcome(sink, &outcome);
        outcome
    }

    async fn start_recording(&mut self, mode_id: &str) -> VoiceRuntimeOutcome {
        if self.active.is_some() {
            eprintln!(
                "[soto-runtime] start_recording: ignored because another session is active (mode_id={mode_id})"
            );
            return VoiceRuntimeOutcome::Ignored;
        }

        eprintln!("[soto-runtime] start_recording: mode_id={mode_id}");

        let session = match self.backend.start_voice_session(mode_id) {
            Ok(session) => session,
            Err(VoiceRuntimeStartError { code, message }) => {
                eprintln!(
                    "[soto-runtime] start_recording: backend.start_voice_session FAILED code={code:?}: {message}"
                );
                return VoiceRuntimeOutcome::Error { code, message };
            }
        };
        let handle = B::session_handle(&session);
        if let Err(message) = self.recorder.start(&handle) {
            eprintln!(
                "[soto-runtime] start_recording: recorder.start FAILED handle_id={} mode_id={}: {message}",
                handle.handle_id, handle.mode_id
            );
            return self.fail_session(session, message).await;
        }

        eprintln!(
            "[soto-runtime] start_recording: recorder.start ok handle_id={} mode_id={}",
            handle.handle_id, handle.mode_id
        );
        self.active = Some(session);
        VoiceRuntimeOutcome::Started(VoiceSessionHandle {
            status: VoiceSessionStatus::Listening,
            ..handle
        })
    }

    async fn finish_recording(&mut self) -> VoiceRuntimeOutcome {
        let Some(session) = self.active.take() else {
            return VoiceRuntimeOutcome::Ignored;
        };

        self.finish_session(session).await
    }

    async fn finish_recording_with_events(
        &mut self,
        sink: &mut impl VoiceRuntimeEventSink,
    ) -> VoiceRuntimeOutcome {
        let Some(session) = self.active.take() else {
            return VoiceRuntimeOutcome::Ignored;
        };
        let mut handle = B::session_handle(&session);
        handle.status = VoiceSessionStatus::Thinking;
        sink.emit(VoiceRuntimeEvent::Thinking(handle));

        self.finish_session(session).await
    }

    async fn finish_session(&mut self, session: B::Session) -> VoiceRuntimeOutcome {
        let handle = B::session_handle(&session);
        eprintln!(
            "[soto-runtime] finish_session: stopping recorder handle_id={} mode_id={}",
            handle.handle_id, handle.mode_id
        );
        let recording = match self.recorder.finish() {
            Ok(recording) => recording,
            Err(message) => {
                eprintln!(
                    "[soto-runtime] finish_session: recorder.finish FAILED handle_id={} mode_id={}: {message}",
                    handle.handle_id, handle.mode_id
                );
                return self.fail_session(session, message).await;
            }
        };
        let file_bytes = std::fs::metadata(&recording.path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        eprintln!(
            "[soto-runtime] finish_session: captured recording handle_id={} mode_id={} recorded_ms={} file_bytes={} file_audio_bytes={} format={}Hz/{}ch/{} frames_received={} frames_written={} dropped_frames={} queue_full={}",
            handle.handle_id,
            handle.mode_id,
            recording.duration_ms,
            file_bytes,
            recording.byte_count,
            recording.sample_rate_hz,
            recording.channels,
            recording.encoding,
            recording.frames_received,
            recording.frames_written,
            recording.dropped_frames,
            recording.queue_full
        );
        match self
            .backend
            .complete_voice_session(session, recording)
            .await
        {
            Ok(result) => {
                eprintln!(
                    "[soto-runtime] finish_session: backend completion result {}",
                    result_summary(&result)
                );
                voice_runtime_outcome_for_completion_result(result)
            }
            Err(message) => {
                eprintln!("[soto-runtime] finish_session: backend completion ERROR: {message}");
                VoiceRuntimeOutcome::Error {
                    code: VoiceRuntimeErrorCode::Generic,
                    message,
                }
            }
        }
    }

    async fn cancel_recording(&mut self) -> VoiceRuntimeOutcome {
        let Some(session) = self.active.take() else {
            return VoiceRuntimeOutcome::Ignored;
        };

        let _ = self.recorder.cancel();
        match self.backend.cancel_voice_session(session).await {
            Ok(result) => VoiceRuntimeOutcome::Cancelled(result),
            Err(message) => VoiceRuntimeOutcome::Error {
                code: VoiceRuntimeErrorCode::Generic,
                message,
            },
        }
    }

    async fn fail_session(&mut self, session: B::Session, message: String) -> VoiceRuntimeOutcome {
        let handle = B::session_handle(&session);
        eprintln!(
            "[soto-runtime] fail_session: handle_id={} mode_id={} message={message}",
            handle.handle_id, handle.mode_id
        );
        match self.backend.fail_voice_session(session, message).await {
            Ok(result) => {
                eprintln!(
                    "[soto-runtime] fail_session: recorded failed result {}",
                    result_summary(&result)
                );
                VoiceRuntimeOutcome::Failed(result)
            }
            Err(message) => {
                eprintln!("[soto-runtime] fail_session: recording failed result ERROR: {message}");
                VoiceRuntimeOutcome::Error {
                    code: VoiceRuntimeErrorCode::Generic,
                    message,
                }
            }
        }
    }
}

fn voice_runtime_outcome_for_completion_result(
    result: CompleteFinalTranscriptResult,
) -> VoiceRuntimeOutcome {
    match result.status {
        soto_core::SessionStatus::Completed => VoiceRuntimeOutcome::Completed(result),
        soto_core::SessionStatus::Cancelled => VoiceRuntimeOutcome::Cancelled(result),
        soto_core::SessionStatus::Empty | soto_core::SessionStatus::Failed => {
            VoiceRuntimeOutcome::Failed(result)
        }
    }
}

impl<B, R, S> VoiceRuntimeWorker<B, R, S>
where
    B: VoiceRuntimeBackend,
    R: VoiceAudioRecorder,
    S: VoiceRuntimeEventSink + Send + 'static,
{
    pub fn new(runtime: VoiceRuntime<B, R>, sink: S) -> Self {
        Self {
            runtime,
            sink: Arc::new(tokio::sync::Mutex::new(sink)),
            level_task: None,
        }
    }

    pub fn sink(&self) -> Arc<tokio::sync::Mutex<S>> {
        self.sink.clone()
    }

    pub fn sink_mut(&mut self) -> &mut S {
        panic!("Legacy synchronous sink accessor is removed");
    }

    pub async fn handle_action(&mut self, action: HotkeyRuntimeAction) -> VoiceRuntimeOutcome {
        let is_start = matches!(action, HotkeyRuntimeAction::StartRecording { .. });
        if !is_start {
            self.stop_level_task();
        }

        let outcome = {
            let mut sink = self.sink.lock().await;
            self.runtime
                .handle_hotkey_action_with_events(action, &mut *sink)
                .await
        };

        if is_start
            && matches!(outcome, VoiceRuntimeOutcome::Started(_))
            && let Some(level_snapshot) = self.runtime.level_snapshot_handle()
        {
            self.start_level_task(level_snapshot);
        }

        outcome
    }

    pub async fn drain_pending(
        &mut self,
        receiver: &Receiver<HotkeyRuntimeAction>,
    ) -> Vec<VoiceRuntimeOutcome> {
        let mut outcomes = Vec::new();
        loop {
            match receiver.try_recv() {
                Ok(action) => outcomes.push(self.handle_action(action).await),
                Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => return outcomes,
            }
        }
    }

    fn start_level_task(&mut self, level_snapshot: LevelSnapshotHandle) {
        self.stop_level_task();
        let sink = self.sink.clone();
        let level_task = tokio::spawn(async move {
            let mut ticker =
                tokio::time::interval(Duration::from_millis(VOICE_LEVEL_POLL_INTERVAL_MS));
            loop {
                ticker.tick().await;
                let (rms, peak) = level_snapshot.snapshot().unwrap_or((0.0, 0.0));
                let event = VoiceRuntimeEvent::Level {
                    rms: meter_to_level_metric(rms),
                    peak: meter_to_level_metric(peak),
                };
                let mut sink = sink.lock().await;
                sink.emit(event);
            }
        });
        self.level_task = Some(level_task);
    }

    fn stop_level_task(&mut self) {
        if let Some(task) = self.level_task.take() {
            task.abort();
        }
    }
}

impl<F> VoiceRuntimeBackend for ProviderVoiceRuntimeBackend<'_, F>
where
    F: TextInjectorFactory,
{
    type Session = ProviderVoiceRuntimeSession;

    fn start_voice_session(
        &mut self,
        mode_id: &str,
    ) -> Result<Self::Session, VoiceRuntimeStartError> {
        let active = self
            .backend
            .prepare_voice_session(StartVoiceSessionRequest {
                mode_id: mode_id.to_string(),
                target_app: self.target.app.clone(),
                target_window_title: self.target.window_title.clone(),
                target_control_type: self.target.control_type.clone(),
            })?;
        Ok(ProviderVoiceRuntimeSession {
            handle: VoiceSessionHandle {
                handle_id: format!("runtime.{}", Uuid::new_v4()),
                mode_id: mode_id.to_string(),
                status: VoiceSessionStatus::Listening,
            },
            active,
        })
    }

    fn session_handle(session: &Self::Session) -> VoiceSessionHandle {
        session.handle.clone()
    }

    fn complete_voice_session<'a>(
        &'a mut self,
        session: Self::Session,
        recording: CapturedRecordingFile,
    ) -> Pin<Box<dyn Future<Output = Result<CompleteFinalTranscriptResult, String>> + 'a>> {
        Box::pin(async move {
            let active = session.active;
            let recording_for_completion = recording.clone();
            match tokio::time::timeout(
                VOICE_COMPLETION_TIMEOUT,
                self.backend.complete_active_voice_session_with_recording(
                    active.clone(),
                    recording_for_completion,
                ),
            )
            .await
            {
                Ok(result) => result,
                Err(_) => {
                    if let Err(error) = std::fs::remove_file(&recording.path)
                        && error.kind() != std::io::ErrorKind::NotFound
                    {
                        eprintln!(
                            "[soto-runtime] complete_voice_session: timed-out recording cleanup FAILED path={:?}: {error}",
                            recording.path
                        );
                    }
                    self.backend.fail_active_voice_session(
                        active,
                        format!(
                            "voice completion timed out after {} seconds",
                            VOICE_COMPLETION_TIMEOUT.as_secs()
                        ),
                    )
                }
            }
        })
    }

    fn cancel_voice_session<'a>(
        &'a mut self,
        session: Self::Session,
    ) -> Pin<Box<dyn Future<Output = Result<CompleteFinalTranscriptResult, String>> + 'a>> {
        Box::pin(async move { self.backend.cancel_active_voice_session(session.active) })
    }

    fn fail_voice_session<'a>(
        &'a mut self,
        session: Self::Session,
        message: String,
    ) -> Pin<Box<dyn Future<Output = Result<CompleteFinalTranscriptResult, String>> + 'a>> {
        Box::pin(async move {
            self.backend
                .fail_active_voice_session(session.active, message)
        })
    }
}

impl VoiceAudioRecorder for BufferedRecordingFileRecorder {
    fn start(&mut self, _handle: &VoiceSessionHandle) -> Result<(), String> {
        RecordingFileRecorder::start(self).map_err(recorder_error_message)
    }

    fn finish(&mut self) -> Result<CapturedRecordingFile, String> {
        RecordingFileRecorder::finish(self).map_err(recorder_error_message)
    }

    fn cancel(&mut self) -> Result<(), String> {
        RecordingFileRecorder::cancel(self).map_err(recorder_error_message)
    }

    fn level_snapshot_handle(&self) -> Option<LevelSnapshotHandle> {
        BufferedRecordingFileRecorder::level_snapshot_handle(self)
    }
}

impl VoiceAudioRecorder for NativeMicrophoneRecorder {
    fn start(&mut self, _handle: &VoiceSessionHandle) -> Result<(), String> {
        NativeMicrophoneRecorder::start(self).map_err(native_microphone_recorder_error_message)
    }

    fn finish(&mut self) -> Result<CapturedRecordingFile, String> {
        NativeMicrophoneRecorder::finish(self).map_err(native_microphone_recorder_error_message)
    }

    fn cancel(&mut self) -> Result<(), String> {
        NativeMicrophoneRecorder::cancel(self).map_err(native_microphone_recorder_error_message)
    }

    fn level_snapshot_handle(&self) -> Option<LevelSnapshotHandle> {
        NativeMicrophoneRecorder::level_snapshot_handle(self)
    }
}

fn meter_to_level_metric(value: f32) -> u16 {
    (value.clamp(0.0, 1.0) * 1000.0).round() as u16
}

fn recorder_error_message(error: RecorderError) -> String {
    match error {
        RecorderError::AlreadyRecording => "audio recorder is already recording".into(),
        RecorderError::NotRecording => "audio recorder is not recording".into(),
        error => error.to_string(),
    }
}

fn native_microphone_recorder_error_message(error: NativeMicrophoneRecorderError) -> String {
    error.to_string()
}

fn emit_outcome(sink: &mut impl VoiceRuntimeEventSink, outcome: &VoiceRuntimeOutcome) {
    match outcome {
        VoiceRuntimeOutcome::Started(handle) => {
            sink.emit(VoiceRuntimeEvent::Started(handle.clone()));
        }
        VoiceRuntimeOutcome::Completed(result) => {
            sink.emit(VoiceRuntimeEvent::Completed(result.clone()));
        }
        VoiceRuntimeOutcome::Cancelled(result) => {
            sink.emit(VoiceRuntimeEvent::Cancelled(result.clone()));
        }
        VoiceRuntimeOutcome::Failed(result) => {
            sink.emit(VoiceRuntimeEvent::Failed(result.clone()));
        }
        VoiceRuntimeOutcome::Error { code, message } => {
            sink.emit(VoiceRuntimeEvent::Error {
                code: *code,
                message: message.clone(),
            });
        }
        VoiceRuntimeOutcome::Ignored => {}
    }
}

#[cfg(test)]
mod capsule_visibility_tests {
    use super::*;
    use crate::VoiceSessionStatus;

    fn handle() -> VoiceSessionHandle {
        VoiceSessionHandle {
            handle_id: "runtime.test".into(),
            mode_id: "direct".into(),
            status: VoiceSessionStatus::Listening,
        }
    }

    fn final_result() -> CompleteFinalTranscriptResult {
        CompleteFinalTranscriptResult {
            history_id: "history.test".into(),
            raw_text: String::new(),
            processed_text: None,
            final_text: String::new(),
            status: soto_core::SessionStatus::Empty,
            injection_outcome: soto_core::InjectionOutcome::NoOp,
            empty_reason: None,
        }
    }

    #[test]
    fn capsule_position_is_bottom_centered_with_logical_margin() {
        let position = capsule_bottom_center_position(
            tauri::PhysicalPosition::new(0, 0),
            tauri::PhysicalSize::new(3456, 2234),
            tauri::PhysicalSize::new(480, 144),
            2.0,
            None,
        );

        assert_eq!(position, tauri::PhysicalPosition::new(1488, 1946));
    }

    #[test]
    fn capsule_position_uses_work_area_bottom_when_provided() {
        let position = capsule_bottom_center_position(
            tauri::PhysicalPosition::new(0, 0),
            tauri::PhysicalSize::new(3456, 2234),
            tauri::PhysicalSize::new(480, 144),
            2.0,
            Some(2000),
        );

        assert_eq!(position, tauri::PhysicalPosition::new(1488, 1836));
    }

    #[test]
    fn capsule_position_clamps_when_window_is_larger_than_monitor() {
        let position = capsule_bottom_center_position(
            tauri::PhysicalPosition::new(-300, 50),
            tauri::PhysicalSize::new(300, 100),
            tauri::PhysicalSize::new(480, 144),
            2.0,
            None,
        );

        assert_eq!(position, tauri::PhysicalPosition::new(-300, 50));
    }

    #[test]
    fn capsule_position_clamps_to_monitor_when_work_area_below_window() {
        let position = capsule_bottom_center_position(
            tauri::PhysicalPosition::new(-300, 50),
            tauri::PhysicalSize::new(300, 100),
            tauri::PhysicalSize::new(480, 144),
            2.0,
            Some(120),
        );

        assert_eq!(position, tauri::PhysicalPosition::new(-300, 50));
    }

    #[test]
    fn monitor_contains_cursor_position_true_for_cursor_inside_primary_monitor() {
        assert!(monitor_contains_cursor_position(
            tauri::PhysicalPosition::new(0, 0),
            tauri::PhysicalSize::new(1920, 1080),
            tauri::PhysicalPosition::new(960.0, 540.0),
        ));
    }

    #[test]
    fn monitor_contains_cursor_position_true_for_cursor_in_negative_x_secondary_monitor() {
        assert!(monitor_contains_cursor_position(
            tauri::PhysicalPosition::new(-1920, 0),
            tauri::PhysicalSize::new(1920, 1080),
            tauri::PhysicalPosition::new(-960.0, 540.0),
        ));
    }

    #[test]
    fn monitor_contains_cursor_position_false_for_cursor_outside_all_monitors() {
        assert!(!monitor_contains_cursor_position(
            tauri::PhysicalPosition::new(0, 0),
            tauri::PhysicalSize::new(1920, 1080),
            tauri::PhysicalPosition::new(5000.0, 5000.0),
        ));
    }

    #[test]
    fn monitor_contains_cursor_position_left_edge_is_inclusive() {
        assert!(monitor_contains_cursor_position(
            tauri::PhysicalPosition::new(0, 0),
            tauri::PhysicalSize::new(1920, 1080),
            tauri::PhysicalPosition::new(0.0, 540.0),
        ));
    }

    #[test]
    fn monitor_contains_cursor_position_right_edge_is_exclusive() {
        assert!(!monitor_contains_cursor_position(
            tauri::PhysicalPosition::new(0, 0),
            tauri::PhysicalSize::new(1920, 1080),
            tauri::PhysicalPosition::new(1920.0, 540.0),
        ));
    }

    #[test]
    fn monitor_contains_cursor_position_rejects_non_finite_coordinates() {
        assert!(!monitor_contains_cursor_position(
            tauri::PhysicalPosition::new(0, 0),
            tauri::PhysicalSize::new(1920, 1080),
            tauri::PhysicalPosition::new(f64::NAN, 540.0),
        ));
    }

    #[test]
    fn started_intends_show() {
        assert_eq!(
            capsule_visibility_intent(&VoiceRuntimeEvent::Started(handle())),
            CapsuleVisibilityIntent::Show
        );
    }

    #[test]
    fn level_intends_show() {
        assert_eq!(
            capsule_visibility_intent(&VoiceRuntimeEvent::Level {
                rms: 120,
                peak: 240
            }),
            CapsuleVisibilityIntent::Show
        );
    }

    #[test]
    fn thinking_intends_show() {
        assert_eq!(
            capsule_visibility_intent(&VoiceRuntimeEvent::Thinking(handle())),
            CapsuleVisibilityIntent::Show
        );
    }

    #[test]
    fn completed_intends_hide_after_delay() {
        assert_eq!(
            capsule_visibility_intent(&VoiceRuntimeEvent::Completed(final_result())),
            CapsuleVisibilityIntent::HideAfterDelay
        );
    }

    #[test]
    fn cancelled_intends_hide_after_delay() {
        assert_eq!(
            capsule_visibility_intent(&VoiceRuntimeEvent::Cancelled(final_result())),
            CapsuleVisibilityIntent::HideAfterDelay
        );
    }

    #[test]
    fn failed_intends_hide_after_delay() {
        assert_eq!(
            capsule_visibility_intent(&VoiceRuntimeEvent::Failed(final_result())),
            CapsuleVisibilityIntent::HideAfterDelay
        );
    }

    #[test]
    fn error_intends_show_then_hide_after_delay() {
        assert_eq!(
            capsule_visibility_intent(&VoiceRuntimeEvent::Error {
                code: VoiceRuntimeErrorCode::Generic,
                message: "boom".into(),
            }),
            CapsuleVisibilityIntent::ShowThenHideAfterDelay
        );
    }

    #[test]
    fn missing_provider_error_carries_typed_code() {
        let error = VoiceRuntimeStartError::from(VoiceSessionPrepareError::MissingProvider);
        assert_eq!(error.code, VoiceRuntimeErrorCode::MissingProvider);
    }

    #[test]
    fn other_prepare_error_maps_to_generic_code() {
        let error = VoiceRuntimeStartError::from(VoiceSessionPrepareError::Other(
            "settings unreadable".into(),
        ));
        assert_eq!(error.code, VoiceRuntimeErrorCode::Generic);
        assert_eq!(error.message, "settings unreadable");
    }

    #[test]
    fn error_event_serializes_code_in_snake_case() {
        let event = VoiceRuntimeEvent::Error {
            code: VoiceRuntimeErrorCode::MissingProvider,
            message: "voice session requires an Omni provider".into(),
        };
        let json = serde_json::to_value(&event).expect("event serializes");
        assert_eq!(json["kind"], "error");
        assert_eq!(json["code"], "missing_provider");
        assert_eq!(json["message"], "voice session requires an Omni provider");
    }

    #[test]
    fn result_summary_includes_final_text_for_diagnostics() {
        let result = CompleteFinalTranscriptResult {
            history_id: "history.output".into(),
            raw_text: "raw".into(),
            processed_text: Some("你好\nSoto".into()),
            final_text: "你好\nSoto".into(),
            status: soto_core::SessionStatus::Completed,
            injection_outcome: soto_core::InjectionOutcome::Inserted,
            empty_reason: None,
        };

        let summary = result_summary(&result);

        assert!(summary.contains("history_id=history.output"));
        assert!(summary.contains("final_text=\"你好\\nSoto\""));
    }
}
