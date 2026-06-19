// Microphone enumeration for the settings UI. The main process has no media
// APIs, so the device list is read by evaluating navigator.mediaDevices in the
// main window's renderer; the result is shape-checked before it crosses back
// into trusted code.

import type { BrowserWindow } from "electron";
import type { MicrophoneDevice } from "@soto/core";

export async function enumerateAudioInputDevices(
  win: BrowserWindow | null,
): Promise<MicrophoneDevice[]> {
  if (win === null || win.isDestroyed() || win.webContents.isDestroyed()) return [];
  const raw = await win.webContents.executeJavaScript(
    `(() => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
      return navigator.mediaDevices.enumerateDevices()
        .then((devices) => devices
          .filter((device) => device.kind === "audioinput")
          .map((device, index) => ({
            id: device.deviceId,
            label: device.label || (device.deviceId === "default" ? "System default" : "Microphone " + (index + 1)),
            is_default: device.deviceId === "default"
          })))
        .catch(() => []);
    })()`,
    true,
  ) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((device): device is MicrophoneDevice => {
      if (typeof device !== "object" || device === null) return false;
      const value = device as Record<string, unknown>;
      return (
        typeof value["id"] === "string" &&
        typeof value["label"] === "string" &&
        typeof value["is_default"] === "boolean"
      );
    })
    .map((device) => ({
      id: device.id,
      label: device.label,
      is_default: device.is_default,
    }));
}
