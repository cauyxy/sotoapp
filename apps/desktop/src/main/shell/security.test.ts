import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "./security.js";

function directive(csp: string, name: string): string {
  return csp.split("; ").find((entry) => entry.startsWith(`${name} `)) ?? "";
}

describe("buildContentSecurityPolicy", () => {
  it("keeps production script policy strict", () => {
    const csp = buildContentSecurityPolicy(undefined);

    expect(directive(csp, "script-src")).toBe("script-src 'self'");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self'");
  });

  it("allows the Vite React dev preamble and HMR websocket only in dev", () => {
    const csp = buildContentSecurityPolicy("http://localhost:5173/");

    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' ws://localhost:5173");
  });

  it("uses secure websocket HMR for https dev renderer origins", () => {
    const csp = buildContentSecurityPolicy("https://localhost:5173/");

    expect(csp).toContain("connect-src 'self' wss://localhost:5173");
  });
});
