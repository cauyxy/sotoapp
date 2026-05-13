#![cfg(target_os = "macos")]

use crate::matcher::{HookEvent, InputEdge, MatchOutcome, Matcher, SwallowDecision};
use crate::{HookError, KeyboardHook};
use soto_core::hotkey::{Chord, Modifier};

use std::os::raw::c_void;
use std::ptr;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};

#[allow(non_camel_case_types)]
type CFRunLoopRef = *mut c_void;
#[allow(non_camel_case_types)]
type CFMachPortRef = *mut c_void;
#[allow(non_camel_case_types)]
type CGEventRef = *mut c_void;
#[allow(non_camel_case_types)]
type CFRunLoopSourceRef = *mut c_void;
#[allow(non_camel_case_types)]
type CFRunLoopMode = *const c_void;

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRunLoopGetCurrent() -> CFRunLoopRef;
    fn CFRunLoopRun();
    fn CFRunLoopStop(loop_: CFRunLoopRef);
    fn CFRunLoopAddSource(loop_: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFRunLoopMode);
    fn CFRunLoopRemoveSource(loop_: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFRunLoopMode);
    fn CFMachPortCreateRunLoopSource(
        allocator: *const c_void,
        port: CFMachPortRef,
        order: isize,
    ) -> CFRunLoopSourceRef;
    fn CFRelease(cf: *const c_void);
    static kCFRunLoopCommonModes: CFRunLoopMode;
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: extern "C" fn(
            proxy: *mut c_void,
            type_: u32,
            event: CGEventRef,
            user_info: *mut c_void,
        ) -> CGEventRef,
        user_info: *mut c_void,
    ) -> CFMachPortRef;
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
    fn CGEventGetFlags(event: CGEventRef) -> u64;
}

const K_CG_HID_EVENT_TAP: u32 = 0;
const K_CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
const K_CG_EVENT_TAP_OPTION_DEFAULT: u32 = 0;

const NS_EVENT_TYPE_FLAGS_CHANGED: u32 = 12;

const NX_DEVICELCTLKEYMASK: u64 = 0x00000001;
const NX_DEVICELSHIFTKEYMASK: u64 = 0x00000002;
const NX_DEVICERSHIFTKEYMASK: u64 = 0x00000004;
const NX_DEVICELCMDKEYMASK: u64 = 0x00000008;
const NX_DEVICERCMDKEYMASK: u64 = 0x00000010;
const NX_DEVICELALTKEYMASK: u64 = 0x00000020;
const NX_DEVICERALTKEYMASK: u64 = 0x00000040;
const NX_DEVICERCTLKEYMASK: u64 = 0x00002000;
const NX_FN_MASK: u64 = 0x00800000;

const KEYCODE_TO_MODIFIER_MASK: &[(u64, Modifier)] = &[
    (NX_DEVICERCMDKEYMASK, Modifier::RightMeta),
    (NX_DEVICELCMDKEYMASK, Modifier::LeftMeta),
    (NX_DEVICELSHIFTKEYMASK, Modifier::LeftShift),
    (NX_DEVICERSHIFTKEYMASK, Modifier::RightShift),
    (NX_DEVICELALTKEYMASK, Modifier::LeftAlt),
    (NX_DEVICERALTKEYMASK, Modifier::RightAlt),
    (NX_DEVICELCTLKEYMASK, Modifier::LeftCtrl),
    (NX_DEVICERCTLKEYMASK, Modifier::RightCtrl),
    (NX_FN_MASK, Modifier::Fn),
];

struct HookContext {
    matcher: Mutex<Matcher>,
    handler: Box<dyn Fn(HookEvent) + Send + Sync>,
    last_modifier_mask: Mutex<u64>,
}

static HOOK_CONTEXT: OnceLock<Arc<HookContext>> = OnceLock::new();

pub struct MacosHook {
    run_loop: Mutex<Option<CFRunLoopRef>>,
    join: Mutex<Option<JoinHandle<()>>>,
    pending: Arc<Mutex<Option<Vec<Chord>>>>,
}

unsafe impl Send for MacosHook {}
unsafe impl Sync for MacosHook {}

impl MacosHook {
    pub fn install(handler: impl Fn(HookEvent) + Send + Sync + 'static) -> Result<Self, HookError> {
        let context = Arc::new(HookContext {
            matcher: Mutex::new(Matcher::new()),
            handler: Box::new(handler),
            last_modifier_mask: Mutex::new(0),
        });
        if HOOK_CONTEXT.set(context).is_err() {
            return Err(HookError::InstallFailed("hook already installed".into()));
        }

        let pending: Arc<Mutex<Option<Vec<Chord>>>> = Arc::new(Mutex::new(None));
        let (tx, rx) = std::sync::mpsc::channel::<usize>();

        let join = thread::spawn(move || unsafe {
            let mask = 1u64 << NS_EVENT_TYPE_FLAGS_CHANGED;
            let tap = CGEventTapCreate(
                K_CG_HID_EVENT_TAP,
                K_CG_HEAD_INSERT_EVENT_TAP,
                K_CG_EVENT_TAP_OPTION_DEFAULT,
                mask,
                event_tap_callback,
                ptr::null_mut(),
            );
            if tap.is_null() {
                let _ = tx.send(0);
                return;
            }

            let source = CFMachPortCreateRunLoopSource(ptr::null(), tap, 0);
            let run_loop = CFRunLoopGetCurrent();
            CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
            CGEventTapEnable(tap, true);
            let _ = tx.send(run_loop as usize);

            CFRunLoopRun();
            CFRunLoopRemoveSource(run_loop, source, kCFRunLoopCommonModes);
            CGEventTapEnable(tap, false);
            CFRelease(source as *const c_void);
            CFRelease(tap as *const c_void);
        });

        let run_loop_addr = rx
            .recv()
            .map_err(|_| HookError::InstallFailed("event tap thread died".into()))?;
        if run_loop_addr == 0 {
            return Err(HookError::InstallFailed(
                "CGEventTapCreate returned NULL — Accessibility permission likely missing".into(),
            ));
        }
        Ok(Self {
            run_loop: Mutex::new(Some(run_loop_addr as CFRunLoopRef)),
            join: Mutex::new(Some(join)),
            pending,
        })
    }
}

impl KeyboardHook for MacosHook {
    fn replace_registrations(&self, chords: Vec<Chord>) -> Result<(), HookError> {
        if let Ok(mut slot) = self.pending.lock() {
            *slot = Some(chords.clone());
        }
        if let Some(ctx) = HOOK_CONTEXT.get()
            && let Ok(mut matcher) = ctx.matcher.lock()
        {
            for ev in matcher.replace_chords(chords) {
                (ctx.handler)(ev);
            }
        }
        Ok(())
    }

    fn shutdown(&self) {
        if let Ok(mut slot) = self.run_loop.lock()
            && let Some(loop_) = slot.take()
        {
            unsafe {
                CFRunLoopStop(loop_);
            }
        }
        if let Ok(mut join) = self.join.lock()
            && let Some(handle) = join.take()
        {
            let _ = handle.join();
        }
    }
}

extern "C" fn event_tap_callback(
    _proxy: *mut c_void,
    type_: u32,
    event: CGEventRef,
    _user_info: *mut c_void,
) -> CGEventRef {
    let Some(ctx) = HOOK_CONTEXT.get() else {
        return event;
    };
    let outcomes = match type_ {
        NS_EVENT_TYPE_FLAGS_CHANGED => flags_changed_outcome(ctx, event),
        _ => return event,
    };
    let mut swallow = SwallowDecision::PassThrough;
    for outcome in outcomes {
        for ev in outcome.events {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (ctx.handler)(ev)));
        }
        if matches!(outcome.swallow, SwallowDecision::Swallow) {
            swallow = SwallowDecision::Swallow;
        }
    }
    if matches!(swallow, SwallowDecision::Swallow) {
        ptr::null_mut()
    } else {
        event
    }
}

fn flags_changed_outcome(ctx: &HookContext, event: CGEventRef) -> Vec<MatchOutcome> {
    let flags = unsafe { CGEventGetFlags(event) };
    let prev = match ctx.last_modifier_mask.lock() {
        Ok(mut g) => {
            let p = *g;
            *g = flags;
            p
        }
        Err(_) => return Vec::new(),
    };

    let mut outcomes = Vec::new();
    let Ok(mut matcher) = ctx.matcher.lock() else {
        return outcomes;
    };
    for (mask, modifier) in KEYCODE_TO_MODIFIER_MASK {
        let was = prev & mask != 0;
        let now = flags & mask != 0;
        if was == now {
            continue;
        }
        let edge = if now { InputEdge::Down } else { InputEdge::Up };
        outcomes.push(matcher.feed(*modifier, edge));
    }
    outcomes
}
