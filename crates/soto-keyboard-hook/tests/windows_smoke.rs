#![cfg(target_os = "windows")]

use soto_keyboard_hook::install;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

#[test]
fn install_and_shutdown_does_not_crash() {
    let counter = Arc::new(AtomicUsize::new(0));
    let counter_clone = counter.clone();
    let hook = install(move |_event| {
        counter_clone.fetch_add(1, Ordering::SeqCst);
    })
    .expect("hook installs");
    hook.replace_registrations(Vec::new())
        .expect("empty registration ok");
    hook.shutdown();
}
