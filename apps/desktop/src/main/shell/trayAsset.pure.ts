export interface TrayAsset {
  /** Asset path relative to the renderer output dir (`out/renderer`). */
  file: string;
  /**
   * macOS template image (black + alpha): the OS auto-inverts it for light and
   * dark menu bars. Windows/Linux do not auto-invert, so they use a coloured
   * glyph and this stays false.
   */
  isTemplate: boolean;
}

export function resolveTrayAsset(platform: NodeJS.Platform): TrayAsset {
  if (platform === "darwin") return { file: "tray/iconTemplate.png", isTemplate: true };
  if (platform === "win32") return { file: "tray/icon.ico", isTemplate: false };
  return { file: "tray/icon.png", isTemplate: false };
}
