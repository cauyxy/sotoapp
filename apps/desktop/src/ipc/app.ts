import { invoke } from "@tauri-apps/api/core";

export const APP_COMMANDS = {
  quitApp: "quit_app"
} as const;

export async function quitApp(): Promise<void> {
  return invoke(APP_COMMANDS.quitApp);
}
