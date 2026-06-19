// PromptEditor — port of apps/desktop/src/features/modes/PromptEditor.svelte.
// A titled textarea for the mode's prompt body.
//
// ModesPage only ever drives the "empty" and "ready" statuses, so those are the
// states with design-system CSS; "loading"/"error" are accepted for API parity
// but unreachable from the modes page (the old build never reached them either).

import { useCallback, useId, useLayoutEffect, useRef } from "react";

import { useT } from "../../../i18n/context";

export type PromptStatus = "empty" | "loading" | "ready" | "error";

export function PromptEditor({
  value,
  onChange,
  status = "ready",
  errorMessage = null,
  onRetry,
}: {
  value: string;
  onChange: (next: string) => void;
  status?: PromptStatus;
  errorMessage?: string | null;
  onRetry?: () => void;
}): JSX.Element {
  const t = useT();
  const titleId = useId();
  const editorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autosize = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    autosize();
  }, [autosize, status, value]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const textarea = textareaRef.current;
    if (textarea === null) return;

    let frame: number | null = null;
    let alive = true;
    const scheduleAutosize = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        autosize();
      });
    };

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleAutosize);
    observer?.observe(textarea);
    if (editorRef.current !== null) observer?.observe(editorRef.current);

    scheduleAutosize();
    window.addEventListener("resize", scheduleAutosize);
    window.visualViewport?.addEventListener("resize", scheduleAutosize);
    void document.fonts?.ready.then(() => {
      if (alive) scheduleAutosize();
    });

    return () => {
      alive = false;
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleAutosize);
      window.visualViewport?.removeEventListener("resize", scheduleAutosize);
    };
  }, [autosize, status]);

  return (
    <div className="prompt-editor" ref={editorRef}>
      <header className="prompt-editor-head">
        <span className="prompt-editor-mark" aria-hidden="true" />
        <span className="prompt-editor-title" id={titleId}>
          {t("modes.promptTitle")}
        </span>
        <span className="prompt-editor-spacer" />
      </header>
      {status === "loading" ? (
        <>
          <div className="prompt-editor-loading" aria-live="polite">
            {t("modes.promptLoading")}
          </div>
          <textarea
            ref={textareaRef}
            className="prompt-editor-body"
            aria-labelledby={titleId}
            value={value}
            disabled
            readOnly
          />
        </>
      ) : status === "error" ? (
        <div className="prompt-editor-error" role="alert">
          <p>{errorMessage ?? t("modes.promptLoadError")}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry}>
              {t("modes.promptRetry")}
            </button>
          ) : null}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="prompt-editor-body"
          aria-labelledby={titleId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
