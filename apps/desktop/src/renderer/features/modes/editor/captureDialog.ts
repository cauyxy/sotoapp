import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Chord, HotkeyCaptureKey } from "@soto/core";

import { beginHotkeyCapture, endHotkeyCapture, onHotkeyCaptureKey } from "../../../ipc";
import { bindHotkeyCapture } from "./hotkeyCapture";
import {
  createCaptureMachine,
  type CaptureAction,
  type CaptureHint,
  type CaptureSnapshot,
} from "./captureMachine";

const CLIENT_CAPTURE_TIMEOUT_MS = 60_000;
const TRANSIENT_HINT_MS = 1_200;

interface CaptureCommitControls {
  close: () => void;
}

interface UseCaptureDialogOptions {
  initialChord?: Chord;
  onClose: () => void;
  onCommit: (chord: Chord, controls: CaptureCommitControls) => void;
}

interface UseCaptureDialogResult {
  snapshot: CaptureSnapshot;
  visibleHint: CaptureHint;
  suppressing: boolean;
  modalRef: RefObject<HTMLDivElement>;
  footRef: RefObject<HTMLDivElement>;
  close: () => void;
  rerecord: () => void;
  onScrimMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onDialogKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  if (root === null) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      [
        "button:not(:disabled)",
        "[href]",
        "input:not(:disabled)",
        "select:not(:disabled)",
        "textarea:not(:disabled)",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","),
    ),
  );
}

export function useCaptureDialog({
  initialChord,
  onClose,
  onCommit,
}: UseCaptureDialogOptions): UseCaptureDialogResult {
  const machineRef = useRef(createCaptureMachine(initialChord));
  const [snapshot, setSnapshot] = useState<CaptureSnapshot>(
    machineRef.current.getSnapshot(),
  );
  const [visibleHint, setVisibleHint] = useState<CaptureHint>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [suppressing, setSuppressing] = useState(false);
  const sessionIdRef = useRef<number | null>(null);
  const closedRef = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const focusedCapturedActionsRef = useRef(false);
  const ipcCleanupRef = useRef<(() => void) | null>(null);
  const fallbackCleanupRef = useRef<(() => void) | null>(null);

  const endCurrentCapture = useCallback(() => {
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sessionId !== null) void endHotkeyCapture(sessionId);
  }, []);

  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    ipcCleanupRef.current?.();
    fallbackCleanupRef.current?.();
    endCurrentCapture();
    onClose();
  }, [endCurrentCapture, onClose]);

  const flashHint = useCallback((hint: CaptureHint) => {
    if (hint === null) return;
    setVisibleHint(hint);
    if (hintTimerRef.current !== null) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => {
      setVisibleHint(null);
      hintTimerRef.current = null;
    }, TRANSIENT_HINT_MS);
  }, []);

  const feedCaptureKey = useCallback(
    (key: HotkeyCaptureKey) => {
      const action: CaptureAction | null = machineRef.current.feed(key);
      const next = machineRef.current.getSnapshot();
      setSnapshot(next);
      if (next.hint !== null) flashHint(next.hint);

      if (action?.kind === "cancel" || action?.kind === "ended") {
        close();
        return;
      }
      if (action?.kind === "commit") onCommit(action.chord, { close });
    },
    [close, flashHint, onCommit],
  );

  useEffect(() => {
    let mounted = true;
    void beginHotkeyCapture()
      .then((result) => {
        if (!mounted) {
          void endHotkeyCapture(result.sessionId);
          return;
        }
        sessionIdRef.current = result.sessionId;
        setSuppressing(result.suppressing);
        if (result.active) {
          ipcCleanupRef.current = onHotkeyCaptureKey(feedCaptureKey);
        } else {
          fallbackCleanupRef.current = bindHotkeyCapture({ onKey: feedCaptureKey });
        }
      })
      .catch(() => {
        if (!mounted) return;
        sessionIdRef.current = 0;
        setSuppressing(false);
        fallbackCleanupRef.current = bindHotkeyCapture({ onKey: feedCaptureKey });
      });

    return () => {
      mounted = false;
      ipcCleanupRef.current?.();
      fallbackCleanupRef.current?.();
      if (hintTimerRef.current !== null) clearTimeout(hintTimerRef.current);
      endCurrentCapture();
    };
  }, [endCurrentCapture, feedCaptureKey]);

  useEffect(() => {
    const timer = setTimeout(close, CLIENT_CAPTURE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [close]);

  useEffect(() => {
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, [close]);

  useEffect(() => {
    focusableElements(modalRef.current)[0]?.focus();
  }, []);

  useEffect(() => {
    if (snapshot.phase !== "captured") {
      focusedCapturedActionsRef.current = false;
      return;
    }
    if (focusedCapturedActionsRef.current) return;
    focusedCapturedActionsRef.current = true;
    window.requestAnimationFrame(() => {
      focusableElements(footRef.current)[0]?.focus();
    });
  }, [snapshot.phase]);

  const rerecord = useCallback(() => {
    machineRef.current.reset();
    const next = machineRef.current.getSnapshot();
    setSnapshot(next);
    setVisibleHint(null);
  }, []);

  const onScrimMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) close();
    },
    [close],
  );

  const onDialogKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !modalRef.current) return;
    const elements = focusableElements(modalRef.current);
    if (elements.length === 0) return;
    const first = elements[0]!;
    const last = elements[elements.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return {
    snapshot,
    visibleHint,
    suppressing,
    modalRef,
    footRef,
    close,
    rerecord,
    onScrimMouseDown,
    onDialogKeyDown,
  };
}
