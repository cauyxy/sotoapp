import type { AxContext } from "../../contract/schema.js";
import type { AppContext } from "./appContext.js";
import { withDerivedWebDomain } from "./signals.js";
import type { ClipboardContextKind } from "./snapshot.js";

export type ModelClipboardContext =
  | {
      kind: "metadata";
      clipboardKind: ClipboardContextKind;
      changeCount: number | null;
    }
  | { kind: "text"; text: string; truncated: boolean };

function projectedSelectionRange(ctx: AppContext): {
  selectionStart: number;
  selectionEnd: number;
} {
  const start = ctx.inputSurface.before.length;
  if (ctx.inputSurface.selection.source === "none") {
    return { selectionStart: start, selectionEnd: start };
  }
  return {
    selectionStart: start,
    selectionEnd: start + ctx.inputSurface.selection.text.length,
  };
}

function baseAxContextOf(ctx: AppContext): AxContext | null {
  const hasContext =
    ctx.inputSurface.fullTextWindow.length > 0 ||
    ctx.inputSurface.before.length > 0 ||
    ctx.inputSurface.after.length > 0 ||
    ctx.inputSurface.axRole !== null ||
    ctx.inputSurface.selection.source !== "none" ||
    ctx.identity.bundleId !== null ||
    ctx.identity.localizedName !== null ||
    ctx.identity.windowTitle !== null ||
    ctx.identity.webDomain !== null;
  if (!hasContext) return null;

  const range = projectedSelectionRange(ctx);
  return {
    full_text: ctx.inputSurface.fullTextWindow,
    selection_start: range.selectionStart,
    selection_end: range.selectionEnd,
    before: ctx.inputSurface.before,
    after: ctx.inputSurface.after,
    ax_role: ctx.inputSurface.axRole,
    app_bundle_id: ctx.identity.bundleId,
    app_name: ctx.identity.localizedName,
    window_title: ctx.identity.windowTitle,
    web_url: null,
    web_domain: ctx.identity.webDomain,
  };
}

export function modelTargetContextOf(ctx: AppContext): AxContext | null {
  const base = baseAxContextOf(ctx);
  if (base === null) return null;
  const derived = withDerivedWebDomain(base);
  if (ctx.projection.includeWindowContextInRequests) return derived;
  return {
    ...derived,
    app_name: null,
    window_title: null,
    web_url: null,
    web_domain: null,
  };
}

export function historyTargetContextOf(ctx: AppContext): AxContext | null {
  const base = baseAxContextOf(ctx);
  if (base === null) return null;
  const derived = withDerivedWebDomain(base);
  return {
    ...derived,
    app_name: derived.app_name,
    window_title: derived.window_title,
    web_url: null,
    web_domain: derived.web_domain,
  };
}

export function modelClipboardContextOf(
  ctx: AppContext,
): ModelClipboardContext | null {
  const clipboard = ctx.ambientClipboard;
  if (clipboard === null || ctx.projection.clipboardContextInRequests === "off") {
    return null;
  }
  if (ctx.projection.clipboardContextInRequests === "metadata") {
    return {
      kind: "metadata",
      clipboardKind: clipboard.kind,
      changeCount: clipboard.changeCount,
    };
  }
  if (clipboard.text === null) return null;
  return {
    kind: "text",
    text: clipboard.text,
    truncated: clipboard.textTruncated,
  };
}
