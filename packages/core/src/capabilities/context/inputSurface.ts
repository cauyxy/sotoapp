export type InputSurfaceKind =
  | "code_editor"
  | "document"
  | "chat"
  | "browser"
  | "terminal"
  | "unknown";

interface InputSurfaceIdentity {
  platform: "macos" | "windows";
  pid: number | null;
  bundleId: string | null;
  executableName: string | null;
  localizedName: string | null;
  windowTitle: string | null;
  webDomain: string | null;
}

function nonEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function lowerIdentityParts(identity: InputSurfaceIdentity): string[] {
  return [
    identity.bundleId,
    identity.executableName,
    identity.localizedName,
    identity.windowTitle,
  ]
    .map((part) => nonEmpty(part)?.toLowerCase() ?? null)
    .filter((part): part is string => part !== null);
}

function includesAny(
  parts: readonly string[],
  needles: readonly string[],
): boolean {
  return parts.some((part) => needles.some((needle) => part.includes(needle)));
}

export function deriveInputSurfaceKind(
  identity: InputSurfaceIdentity,
  axRole: string | null,
): InputSurfaceKind {
  if (nonEmpty(identity.webDomain) !== null) return "browser";

  const parts = lowerIdentityParts(identity);
  if (includesAny(parts, ["terminal", "iterm", "warp"])) return "terminal";
  if (
    includesAny(parts, [
      "vscode",
      "visual studio code",
      "cursor",
      "intellij",
      "jetbrains",
      "code.exe",
    ])
  ) {
    return "code_editor";
  }
  if (
    includesAny(parts, [
      "slack",
      "teams",
      "wechat",
      "telegram",
      "messages",
      "mobilesms",
    ])
  ) {
    return "chat";
  }

  const role = axRole?.toLowerCase() ?? "";
  if (
    role.includes("textfield") ||
    role.includes("textarea") ||
    role.includes("edit")
  ) {
    return "document";
  }
  return "unknown";
}
