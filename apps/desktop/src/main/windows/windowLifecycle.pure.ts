/**
 * Whether a user-initiated main-window close should hide the window instead of
 * destroying it. Windows keeps Soto resident in the tray; explicit quit paths
 * still close normally.
 */
export function shouldHideMainWindowOnClose(
  platform: NodeJS.Platform,
  isQuitting: boolean,
): boolean {
  return platform === "win32" && !isQuitting;
}
