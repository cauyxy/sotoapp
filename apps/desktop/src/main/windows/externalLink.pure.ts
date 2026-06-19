// Pure decision for what a window-open request from the trusted first-party
// renderer is allowed to hand to the OS browser. The renderer bundle is our own
// code (will-navigate already pins the page to the local renderer origin), so we
// open any https URL it requests via shell.openExternal — but the BrowserWindow
// itself is never allowed to open (the caller keeps action: "deny"). Only https
// passes: http/file/javascript/custom schemes and malformed input are refused.

export function externalOpenTarget(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.protocol === "https:" ? url : null;
}
