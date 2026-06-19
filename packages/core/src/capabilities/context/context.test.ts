import { describe, expect, it } from "vitest";
import type { AxContext } from "../../contract/schema.js";
import {
  buildAppContext,
  deriveInputSurfaceKind,
  historyTargetContextOf,
  modelClipboardContextOf,
  modelTargetContextOf,
  type TargetContextSnapshot,
} from "./context.js";

const baseAx: AxContext = {
  full_text: "hello selected world",
  selection_start: 6,
  selection_end: 14,
  before: "hello ",
  after: " world",
  ax_role: "AXTextArea",
  app_bundle_id: "com.example.Writer",
  app_name: "Writer",
  window_title: "Draft",
  web_url: "https://docs.google.com/document/d/1",
  web_domain: null,
};

function target(overrides: Partial<TargetContextSnapshot> = {}): TargetContextSnapshot {
  return {
    id: "target.1",
    capturedAt: 1_700_000_000_000,
    reason: "voice_session_start",
    platform: "macos",
    app: {
      pid: 42,
      bundleId: "com.example.Writer",
      localizedName: "Writer",
      executableName: "Writer",
    },
    window: { title: "Draft" },
    ax: baseAx,
    focusedElement: null,
    selection: { text: "", source: "none", confidence: "low" },
    ambientClipboard: {
      kind: "text",
      text: "ambient",
      textTruncated: false,
      changeCount: 7,
    },
    ...overrides,
  };
}

describe("buildAppContext", () => {
  it("normalizes target identity, separates clipboard context, and resolves profile hints", () => {
    const ctx = buildAppContext({
      target: target(),
      settings: {
        includeWindowContextInRequests: true,
        clipboardContextInRequests: "metadata",
      },
      appProfileRules: [
        {
          match: { domains: ["docs.google.com"] },
          profile: {
            registerHint: "formal",
            punctuationStyle: "standard",
            inputSurface: "document",
          },
        },
      ],
    });

    expect(ctx.identity).toEqual({
      platform: "macos",
      pid: 42,
      bundleId: "com.example.Writer",
      executableName: "Writer",
      localizedName: "Writer",
      windowTitle: "Draft",
      webDomain: "docs.google.com",
    });
    expect(ctx.inputSurface).toEqual({
      kind: "document",
      axRole: "AXTextArea",
      selection: { text: "selected", source: "ax_selection", confidence: "high" },
      before: "hello ",
      after: " world",
      fullTextWindow: "hello selected world",
    });
    expect(ctx.ambientClipboard).toEqual({
      kind: "text",
      text: null,
      textTruncated: false,
      changeCount: 7,
    });
    expect(ctx.profile).toEqual({
      registerHint: "formal",
      punctuationStyle: "standard",
      inputSurface: "document",
    });
  });

  it("keeps AX selection separate from ambient clipboard text", () => {
    const ctx = buildAppContext({
      target: target({
        ax: null,
        selection: {
          text: "copied selection",
          source: "ax_selection",
          confidence: "medium",
        },
      }),
      settings: {
        includeWindowContextInRequests: true,
        clipboardContextInRequests: "text",
      },
    });

    expect(ctx.inputSurface.selection).toEqual({
      text: "copied selection",
      source: "ax_selection",
      confidence: "medium",
    });
    expect(ctx.ambientClipboard?.text).toBe("ambient");
  });

  it("does not resolve model-facing profile hints from redacted domain or title", () => {
    const privateTarget = target({
      app: {
        pid: 42,
        bundleId: null,
        localizedName: "Private Writer",
        executableName: "Private Writer",
      },
      window: { title: "Secret Docs" },
      ax: {
        ...baseAx,
        app_bundle_id: null,
        app_name: "Private Writer",
        window_title: "Secret Docs",
        web_url: "https://docs.example.com/doc",
        web_domain: null,
      },
    });
    const rules = [
      {
        match: { domains: ["docs.example.com"] },
        profile: { registerHint: "formal" as const },
      },
      {
        match: { titlePatterns: ["Secret Docs"] },
        profile: { registerHint: "casual" as const },
      },
    ];

    expect(
      buildAppContext({
        target: privateTarget,
        settings: {
          includeWindowContextInRequests: false,
          clipboardContextInRequests: "off",
        },
        appProfileRules: rules,
      }).profile,
    ).toBeNull();
    expect(
      buildAppContext({
        target: privateTarget,
        settings: {
          includeWindowContextInRequests: true,
          clipboardContextInRequests: "off",
        },
        appProfileRules: rules,
      }).profile,
    ).toEqual({ registerHint: "formal" });
  });
});

describe("AppContext projectors", () => {
  it("projects request AX context with network-side window privacy applied", () => {
    const ctx = buildAppContext({
      target: target(),
      settings: {
        includeWindowContextInRequests: false,
        clipboardContextInRequests: "off",
      },
    });

    expect(modelTargetContextOf(ctx)).toEqual({
      full_text: "hello selected world",
      selection_start: 6,
      selection_end: 14,
      before: "hello ",
      after: " world",
      ax_role: "AXTextArea",
      app_bundle_id: "com.example.Writer",
      app_name: null,
      window_title: null,
      web_url: null,
      web_domain: null,
    });
  });

  it("projects history AX context with local target identity preserved", () => {
    const ctx = buildAppContext({
      target: target(),
      settings: {
        includeWindowContextInRequests: false,
        clipboardContextInRequests: "off",
      },
    });

    expect(historyTargetContextOf(ctx)).toEqual({
      full_text: "hello selected world",
      selection_start: 6,
      selection_end: 14,
      before: "hello ",
      after: " world",
      ax_role: "AXTextArea",
      app_bundle_id: "com.example.Writer",
      app_name: "Writer",
      window_title: "Draft",
      web_url: null,
      web_domain: "docs.google.com",
    });
  });

  it("preserves identity-only target context when text capture is unavailable", () => {
    const ctx = buildAppContext({
      target: target({
        ax: null,
        app: {
          pid: 42,
          bundleId: "com.google.Chrome",
          localizedName: "Chrome",
          executableName: "Google Chrome",
        },
        window: { title: "Inbox - Chrome" },
        selection: { text: "", source: "none", confidence: "low" },
      }),
      settings: {
        includeWindowContextInRequests: false,
        clipboardContextInRequests: "off",
      },
    });

    expect(modelTargetContextOf(ctx)).toEqual({
      full_text: "",
      selection_start: 0,
      selection_end: 0,
      before: "",
      after: "",
      ax_role: null,
      app_bundle_id: "com.google.Chrome",
      app_name: null,
      window_title: null,
      web_url: null,
      web_domain: null,
    });
    expect(historyTargetContextOf(ctx)).toEqual({
      full_text: "",
      selection_start: 0,
      selection_end: 0,
      before: "",
      after: "",
      ax_role: null,
      app_bundle_id: "com.google.Chrome",
      app_name: "Chrome",
      window_title: "Inbox - Chrome",
      web_url: null,
      web_domain: null,
    });
  });

  it("projects clipboard context only for the model path", () => {
    const metadata = buildAppContext({
      target: target(),
      settings: {
        includeWindowContextInRequests: true,
        clipboardContextInRequests: "metadata",
      },
    });
    const text = buildAppContext({
      target: target(),
      settings: {
        includeWindowContextInRequests: true,
        clipboardContextInRequests: "text",
      },
    });
    const off = buildAppContext({
      target: target(),
      settings: {
        includeWindowContextInRequests: true,
        clipboardContextInRequests: "off",
      },
    });

    expect(modelClipboardContextOf(metadata)).toEqual({
      kind: "metadata",
      clipboardKind: "text",
      changeCount: 7,
    });
    expect(modelClipboardContextOf(text)).toEqual({
      kind: "text",
      text: "ambient",
      truncated: false,
    });
    expect(modelClipboardContextOf(off)).toBeNull();
    expect(modelTargetContextOf(text)?.full_text).toBe("hello selected world");
  });
});

describe("deriveInputSurfaceKind", () => {
  it("uses web, terminal, code, chat, and role fallbacks", () => {
    expect(
      deriveInputSurfaceKind(
        {
          platform: "macos",
          pid: 1,
          bundleId: null,
          executableName: null,
          localizedName: "Safari",
          windowTitle: "Example",
          webDomain: "example.com",
        },
        null,
      ),
    ).toBe("browser");
    expect(
      deriveInputSurfaceKind(
        {
          platform: "macos",
          pid: 1,
          bundleId: "com.apple.Terminal",
          executableName: "Terminal",
          localizedName: "Terminal",
          windowTitle: null,
          webDomain: null,
        },
        "AXTextArea",
      ),
    ).toBe("terminal");
    expect(
      deriveInputSurfaceKind(
        {
          platform: "macos",
          pid: 1,
          bundleId: "com.microsoft.VSCode",
          executableName: "Code",
          localizedName: "Code",
          windowTitle: null,
          webDomain: null,
        },
        "AXTextArea",
      ),
    ).toBe("code_editor");
    expect(
      deriveInputSurfaceKind(
        {
          platform: "macos",
          pid: 1,
          bundleId: "com.tinyspeck.slackmacgap",
          executableName: "Slack",
          localizedName: "Slack",
          windowTitle: null,
          webDomain: null,
        },
        "AXTextArea",
      ),
    ).toBe("chat");
    expect(
      deriveInputSurfaceKind(
        {
          platform: "macos",
          pid: 1,
          bundleId: "com.example.Writer",
          executableName: "Writer",
          localizedName: "Writer",
          windowTitle: null,
          webDomain: null,
        },
        "AXTextArea",
      ),
    ).toBe("document");
  });
});
