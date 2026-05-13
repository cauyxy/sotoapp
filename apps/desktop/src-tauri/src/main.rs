#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    soto_tauri::run(tauri::generate_context!());
}
