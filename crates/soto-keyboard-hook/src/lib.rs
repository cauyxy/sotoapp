mod matcher;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
mod macos;

pub use matcher::{HookEvent, MatchOutcome, Matcher, SwallowDecision};
pub use soto_core::hotkey::{Chord, ChordError, Modifier};

use std::sync::{Arc, Mutex};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HookError {
    #[error("keyboard hook could not be installed: {0}")]
    InstallFailed(String),
    #[error("keyboard hook is not running")]
    NotRunning,
}

pub trait KeyboardHook: Send + Sync {
    fn replace_registrations(&self, chords: Vec<Chord>) -> Result<(), HookError>;
    fn shutdown(&self);
}

pub struct MockKeyboardHook {
    inner: Arc<Mutex<MockState>>,
}

#[derive(Default)]
struct MockState {
    chords: Vec<Chord>,
    shutdown: bool,
}

impl MockKeyboardHook {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(MockState::default())),
        }
    }

    pub fn registered_chords(&self) -> Vec<Chord> {
        self.inner.lock().expect("mock hook lock").chords.clone()
    }

    pub fn is_shutdown(&self) -> bool {
        self.inner.lock().expect("mock hook lock").shutdown
    }
}

impl Default for MockKeyboardHook {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyboardHook for MockKeyboardHook {
    fn replace_registrations(&self, chords: Vec<Chord>) -> Result<(), HookError> {
        let mut state = self.inner.lock().expect("mock hook lock");
        if state.shutdown {
            return Err(HookError::NotRunning);
        }
        state.chords = chords;
        Ok(())
    }

    fn shutdown(&self) {
        let mut state = self.inner.lock().expect("mock hook lock");
        state.shutdown = true;
    }
}

#[cfg(target_os = "windows")]
pub fn install(
    handler: impl Fn(HookEvent) + Send + Sync + 'static,
) -> Result<Box<dyn KeyboardHook>, HookError> {
    eprintln!("[soto-hook] install: target=windows");
    let hook = windows::WindowsHook::install(handler)?;
    Ok(Box::new(hook))
}

#[cfg(target_os = "macos")]
pub fn install(
    handler: impl Fn(HookEvent) + Send + Sync + 'static,
) -> Result<Box<dyn KeyboardHook>, HookError> {
    eprintln!("[soto-hook] install: target=macos");
    let hook = macos::MacosHook::install(handler)?;
    Ok(Box::new(hook))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn install(
    _handler: impl Fn(HookEvent) + Send + Sync + 'static,
) -> Result<Box<dyn KeyboardHook>, HookError> {
    Err(HookError::InstallFailed("platform not supported".into()))
}
