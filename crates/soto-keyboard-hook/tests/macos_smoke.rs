#![cfg(target_os = "macos")]

use soto_keyboard_hook::install;

#[test]
#[ignore = "requires Accessibility permission; run manually"]
fn install_and_shutdown_on_macos() {
    let hook = install(|_event| {}).expect("install");
    hook.replace_registrations(Vec::new()).expect("ok");
    hook.shutdown();
}
