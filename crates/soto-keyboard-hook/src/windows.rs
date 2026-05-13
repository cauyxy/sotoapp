#![cfg(target_os = "windows")]

use crate::matcher::{HookEvent, InputEdge, Matcher, SwallowDecision};
use crate::{HookError, KeyboardHook};
use soto_core::hotkey::{Chord, Modifier};

use std::ptr;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::*;

const WM_REPLACE_REGISTRATIONS: u32 = WM_USER + 1;
const WM_SHUTDOWN_HOOK: u32 = WM_USER + 2;

// Per-keystroke trace is OFF by default (very chatty). Enable with
// `SOTO_HOOK_TRACE=1` (also accepts `true`/`on`).
//
// Known limitation (D21/D22): when Soto's own WebView2-backed window owns the
// foreground, the OS does not deliver keystrokes typed inside that webview to
// our `low_level_hook_proc`, so the matcher never sees them and no shortcut
// fires. Confirmed by setting this trace ON and observing zero `llproc: ENTER`
// lines while Soto is focused. Suspected root cause is Chromium/WebView2 using
// an input path (raw input or out-of-process keyboard delivery) that bypasses
// the WH_KEYBOARD_LL pipeline. We treat this as intentional behaviour: the
// dictation hotkey is meant to be used while another app owns focus.
fn trace_enabled() -> bool {
    static FLAG: OnceLock<bool> = OnceLock::new();
    *FLAG.get_or_init(|| {
        std::env::var("SOTO_HOOK_TRACE")
            .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "on" | "ON"))
            .unwrap_or(false)
    })
}

pub(crate) fn map_modifier(vk: u32, extended: bool) -> Option<Modifier> {
    Some(match vk as u16 {
        x if x == VK_LCONTROL.0 => Modifier::LeftCtrl,
        x if x == VK_RCONTROL.0 => Modifier::RightCtrl,
        x if x == VK_LMENU.0 => Modifier::LeftAlt,
        x if x == VK_RMENU.0 => Modifier::RightAlt,
        x if x == VK_LSHIFT.0 => Modifier::LeftShift,
        x if x == VK_RSHIFT.0 => Modifier::RightShift,
        x if x == VK_LWIN.0 => Modifier::LeftMeta,
        x if x == VK_RWIN.0 => Modifier::RightMeta,
        x if x == VK_CONTROL.0 => {
            if extended {
                Modifier::RightCtrl
            } else {
                Modifier::LeftCtrl
            }
        }
        x if x == VK_MENU.0 => {
            if extended {
                Modifier::RightAlt
            } else {
                Modifier::LeftAlt
            }
        }
        x if x == VK_SHIFT.0 => Modifier::LeftShift,
        _ => return None,
    })
}

pub(crate) fn edge_for_message(message: u32) -> Option<InputEdge> {
    match message {
        0x100 | 0x104 => Some(InputEdge::Down), // WM_KEYDOWN, WM_SYSKEYDOWN
        0x101 | 0x105 => Some(InputEdge::Up),   // WM_KEYUP, WM_SYSKEYUP
        _ => None,
    }
}

struct HookContext {
    matcher: Mutex<Matcher>,
    handler: Box<dyn Fn(HookEvent) + Send + Sync>,
}

static HOOK_CONTEXT: OnceLock<Arc<HookContext>> = OnceLock::new();

pub struct WindowsHook {
    thread_id: u32,
    join: Mutex<Option<JoinHandle<()>>>,
    pending: Arc<Mutex<Option<Vec<Chord>>>>,
}

impl WindowsHook {
    pub fn install(handler: impl Fn(HookEvent) + Send + Sync + 'static) -> Result<Self, HookError> {
        eprintln!(
            "[soto-hook] install: starting WH_KEYBOARD_LL hook (trace_enabled={})",
            trace_enabled()
        );
        let context = Arc::new(HookContext {
            matcher: Mutex::new(Matcher::new()),
            handler: Box::new(handler),
        });
        if HOOK_CONTEXT.set(context).is_err() {
            eprintln!("[soto-hook] install: ERROR hook already installed");
            return Err(HookError::InstallFailed("hook already installed".into()));
        }

        let pending: Arc<Mutex<Option<Vec<Chord>>>> = Arc::new(Mutex::new(None));
        let pending_clone = pending.clone();
        let (tx, rx) = std::sync::mpsc::channel::<u32>();

        let join = thread::spawn(move || {
            let thread_id = unsafe { GetCurrentThreadId() };
            let _ = tx.send(thread_id);

            let hook = unsafe {
                SetWindowsHookExW(
                    WH_KEYBOARD_LL,
                    Some(low_level_hook_proc),
                    Some(HINSTANCE(ptr::null_mut())),
                    0,
                )
            };
            let hook = match hook {
                Ok(h) => {
                    eprintln!("[soto-hook] install: SetWindowsHookExW OK (thread_id={thread_id})");
                    h
                }
                Err(err) => {
                    eprintln!(
                        "[soto-hook] install: SetWindowsHookExW FAILED (thread_id={thread_id}, err={err})"
                    );
                    return;
                }
            };

            let mut msg = MSG::default();
            unsafe {
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    if msg.message == WM_REPLACE_REGISTRATIONS {
                        if let Ok(mut slot) = pending_clone.lock()
                            && let Some(chords) = slot.take()
                            && let Some(ctx) = HOOK_CONTEXT.get()
                            && let Ok(mut matcher) = ctx.matcher.lock()
                        {
                            let canonicals: Vec<String> =
                                chords.iter().map(|c| c.canonical()).collect();
                            eprintln!(
                                "[soto-hook] hook-thread: WM_REPLACE_REGISTRATIONS applying {} chord(s): {:?}",
                                canonicals.len(),
                                canonicals
                            );
                            for ev in matcher.replace_chords(chords) {
                                eprintln!(
                                    "[soto-hook] hook-thread: replace synthesised release event: {ev:?}"
                                );
                                (ctx.handler)(ev);
                            }
                        }
                    } else if msg.message == WM_SHUTDOWN_HOOK {
                        eprintln!(
                            "[soto-hook] hook-thread: WM_SHUTDOWN_HOOK received, exiting loop"
                        );
                        break;
                    }
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                let _ = UnhookWindowsHookEx(hook);
                eprintln!("[soto-hook] hook-thread: UnhookWindowsHookEx done");
            }
        });

        let thread_id = rx
            .recv()
            .map_err(|_| HookError::InstallFailed("hook thread died".into()))?;
        eprintln!("[soto-hook] install: hook thread started (thread_id={thread_id})");
        Ok(Self {
            thread_id,
            join: Mutex::new(Some(join)),
            pending,
        })
    }
}

impl KeyboardHook for WindowsHook {
    fn replace_registrations(&self, chords: Vec<Chord>) -> Result<(), HookError> {
        let canonicals: Vec<String> = chords.iter().map(|c| c.canonical()).collect();
        eprintln!(
            "[soto-hook] replace_registrations: queueing {} chord(s) -> hook-thread {}: {:?}",
            canonicals.len(),
            self.thread_id,
            canonicals
        );
        if let Ok(mut slot) = self.pending.lock() {
            *slot = Some(chords);
        }
        unsafe {
            PostThreadMessageW(
                self.thread_id,
                WM_REPLACE_REGISTRATIONS,
                WPARAM(0),
                LPARAM(0),
            )
            .map_err(|err| {
                eprintln!("[soto-hook] replace_registrations: PostThreadMessageW FAILED: {err}");
                HookError::InstallFailed(err.to_string())
            })
        }
    }

    fn shutdown(&self) {
        eprintln!(
            "[soto-hook] shutdown: posting WM_SHUTDOWN_HOOK to hook-thread {}",
            self.thread_id
        );
        unsafe {
            let _ = PostThreadMessageW(self.thread_id, WM_SHUTDOWN_HOOK, WPARAM(0), LPARAM(0));
        }
        if let Ok(mut join) = self.join.lock()
            && let Some(handle) = join.take()
        {
            let _ = handle.join();
        }
    }
}

unsafe extern "system" fn low_level_hook_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code != HC_ACTION as i32 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let kbd = unsafe { *(lparam.0 as *const KBDLLHOOKSTRUCT) };
    let extended = (kbd.flags.0 & LLKHF_EXTENDED.0) != 0;
    let trace = trace_enabled();
    let mapped_modifier = map_modifier(kbd.vkCode, extended);
    let mapped_edge = edge_for_message(wparam.0 as u32);
    if trace {
        eprintln!(
            "[soto-hook] llproc: ENTER vk=0x{:02X} ext={} msg=0x{:X} modifier={:?} edge={:?}",
            kbd.vkCode, extended, wparam.0 as u32, mapped_modifier, mapped_edge
        );
    }
    let Some(modifier) = mapped_modifier else {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    };
    let Some(edge) = mapped_edge else {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    };

    let Some(ctx) = HOOK_CONTEXT.get() else {
        if trace {
            eprintln!("[soto-hook] llproc: HOOK_CONTEXT not initialised, passing through");
        }
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    };
    let (outcome, matcher_state) = match ctx.matcher.lock() {
        Ok(mut matcher) => {
            let outcome = matcher.feed(modifier, edge);
            let state = if trace {
                Some(format!("{matcher:?}"))
            } else {
                None
            };
            (outcome, state)
        }
        Err(_) => {
            eprintln!("[soto-hook] llproc: matcher mutex POISONED, passing through");
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }
    };

    if trace {
        eprintln!(
            "[soto-hook] llproc: AFTER feed events={:?} swallow={:?} matcher={}",
            outcome.events,
            outcome.swallow,
            matcher_state.as_deref().unwrap_or("?")
        );
    }

    for event in outcome.events {
        let result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (ctx.handler)(event)));
        if result.is_err() {
            eprintln!("[soto-hook] llproc: handler panicked for event {event:?}");
        }
    }

    match outcome.swallow {
        SwallowDecision::Swallow => LRESULT(1),
        SwallowDecision::PassThrough => unsafe { CallNextHookEx(None, code, wparam, lparam) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_left_and_right_control() {
        assert_eq!(
            map_modifier(VK_LCONTROL.0 as u32, false),
            Some(Modifier::LeftCtrl)
        );
        assert_eq!(
            map_modifier(VK_RCONTROL.0 as u32, true),
            Some(Modifier::RightCtrl)
        );
    }

    #[test]
    fn extended_flag_disambiguates_generic_control() {
        assert_eq!(
            map_modifier(VK_CONTROL.0 as u32, false),
            Some(Modifier::LeftCtrl)
        );
        assert_eq!(
            map_modifier(VK_CONTROL.0 as u32, true),
            Some(Modifier::RightCtrl)
        );
    }

    #[test]
    fn returns_none_for_non_modifier_vk() {
        assert_eq!(map_modifier(0x41, false), None); // 'A' is no longer a binding target
        assert_eq!(map_modifier(0x70, false), None); // VK_F1
    }
}
