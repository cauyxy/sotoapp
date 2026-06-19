import { describe, expect, it } from "vitest";

import { permissionKindFor, permissionStatus } from "@soto/native-bridge";

// Locks the native int-code -> status/granted mapping the Windows microphone fix
// depends on. The C# layer (native/windows/Src/PermissionsBridge.cs) returns
// these codes and cannot be built on a non-Windows host, so this pure test
// is the only CI-independent guard that code 5 (StatusNotRequired) resolves to a
// granted permission — i.e. that a future change to permissionKindFor /
// permissionStatus can't silently re-introduce the false "microphone denied"
// Home blocker.

describe("permissionKindFor", () => {
  it("maps each defined native status code to its kind", () => {
    expect(permissionKindFor(0)).toBe("not_determined");
    expect(permissionKindFor(1)).toBe("restricted");
    expect(permissionKindFor(2)).toBe("denied");
    expect(permissionKindFor(3)).toBe("granted");
    expect(permissionKindFor(5)).toBe("not_required");
  });

  it("maps the placeholder (6) and any unrecognised code (-1) to 'unknown'", () => {
    expect(permissionKindFor(6)).toBe("unknown");
    expect(permissionKindFor(-1)).toBe("unknown");
  });
});

describe("permissionStatus", () => {
  it("treats not_required (Windows code 5) as granted — the Windows-mic fix", () => {
    const status = permissionStatus("microphone", 5);
    expect(status.status).toBe("not_required");
    expect(status.granted).toBe(true);
  });

  it("treats granted (code 3) as granted", () => {
    expect(permissionStatus("microphone", 3).granted).toBe(true);
  });

  it("does not treat unknown (6) or denied (2) as granted", () => {
    expect(permissionStatus("microphone", 6).granted).toBe(false);
    expect(permissionStatus("microphone", 2).granted).toBe(false);
  });
});
