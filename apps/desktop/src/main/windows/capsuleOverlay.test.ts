import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  screen: {
    getAllDisplays: () => [
      {
        id: 1,
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        workArea: { x: 0, y: 0, width: 1440, height: 900 },
      },
    ],
    getDisplayMatching: () => ({
      id: 1,
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 0, width: 1440, height: 900 },
    }),
    getDisplayNearestPoint: () => ({
      id: 1,
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 0, width: 1440, height: 900 },
    }),
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
  },
}));

import { CapsuleOverlay, type CapsuleOverlayPush } from "./capsuleOverlay.js";

function fakeWindow() {
  // Stateful bounds: position() during show setBounds()es the window.
  let bounds = { x: 0, y: 0, width: 360, height: 200 };
  return {
    isDestroyed: () => false,
    setBounds: vi.fn((b: typeof bounds) => {
      bounds = b;
    }),
    getBounds: () => bounds,
    setAlwaysOnTop: vi.fn(),
    showInactive: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    moveTop: vi.fn(),
    hide: vi.fn(),
  };
}
type FakeWin = ReturnType<typeof fakeWindow>;

describe("CapsuleOverlay choreography", () => {
  let win: FakeWin;
  let pushes: CapsuleOverlayPush[];
  let overlay: CapsuleOverlay;
  let setCapsuleAccessoryNeeded: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    win = fakeWindow();
    pushes = [];
    setCapsuleAccessoryNeeded = vi.fn();
    overlay = new CapsuleOverlay(
      () => win as never,
      (e) => pushes.push(e),
      () => false,
      setCapsuleAccessoryNeeded,
    );
  });
  afterEach(() => vi.useRealTimers());

  it("show pushes will-show, then reveals on the next tick", () => {
    overlay.setVisible(true);
    expect(pushes).toEqual([{ kind: "will-show", seq: 1 }]);
    expect(win.showInactive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(win.showInactive).toHaveBeenCalledTimes(1);
  });

  it("reveals with skipTransformProcessType so Electron does not blink the Dock itself", () => {
    overlay.setVisible(true);
    vi.advanceTimersByTime(0);
    // Without skipTransformProcessType, Electron toggles the process type
    // between UIElement/Foreground inside setVisibleOnAllWorkspaces, blinking
    // the Dock icon. The activation policy is owned solely by setOverlayActivation.
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  });

  it("hide pushes will-hide with the linger and hides at the deadline", () => {
    overlay.setVisible(true);
    vi.advanceTimersByTime(0);
    overlay.setVisible(false, 700);
    expect(pushes).toContainEqual({
      kind: "will-hide",
      seq: 1,
      in_ms: 700,
      exit: "default",
    });
    vi.advanceTimersByTime(699);
    expect(win.hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(win.hide).toHaveBeenCalledTimes(1);
  });

  it("a new show cancels a pending hide AND a pending reveal is epoch-guarded", () => {
    overlay.setVisible(true);
    vi.advanceTimersByTime(0);
    overlay.setVisible(false, 350);
    overlay.setVisible(true);
    vi.advanceTimersByTime(1000);
    expect(win.hide).not.toHaveBeenCalled();
  });

  it("pauseHide freezes the deadline; resumeHide reschedules with a floor and re-announces", () => {
    overlay.setVisible(true);
    vi.advanceTimersByTime(0);
    overlay.setVisible(false, 7450);
    vi.advanceTimersByTime(7000);
    overlay.pauseHide();
    vi.advanceTimersByTime(60000);
    expect(win.hide).not.toHaveBeenCalled();
    overlay.resumeHide();
    expect(pushes.at(-1)).toEqual({
      kind: "will-hide",
      seq: 1,
      in_ms: 1500,
      exit: "default",
    });
    vi.advanceTimersByTime(1500);
    expect(win.hide).toHaveBeenCalledTimes(1);
  });

  it("positions once during show and does not schedule an anchor refinement", () => {
    overlay.setVisible(true);
    expect(win.setBounds).toHaveBeenCalledTimes(1);
    expect(win.setBounds).toHaveBeenCalledWith({ x: 540, y: 636, width: 360, height: 200 });
    vi.advanceTimersByTime(0);
    expect(win.setBounds).toHaveBeenCalledTimes(1);
  });

  describe("Dock presence reporting is gated on full-screen", () => {
    it("reports no capsule accessory need on show when the frontmost app is not full-screen", () => {
      const setAccessory = vi.fn();
      const o = new CapsuleOverlay(
        () => win as never,
        () => {},
        () => false,
        setAccessory,
      );
      o.setVisible(true);
      vi.advanceTimersByTime(0);
      expect(setAccessory).toHaveBeenCalledWith(false);
    });

    it("reports capsule accessory need over a full-screen Space and clears it on hide", () => {
      const setAccessory = vi.fn();
      const o = new CapsuleOverlay(
        () => win as never,
        () => {},
        () => true,
        setAccessory,
      );
      o.setVisible(true);
      vi.advanceTimersByTime(0);
      expect(setAccessory).toHaveBeenCalledWith(true);
      o.setVisible(false, 350);
      vi.advanceTimersByTime(350);
      expect(setAccessory).toHaveBeenLastCalledWith(false);
    });
  });

  describe("hasPendingHide (the 'overlay is lingering' source of truth)", () => {
    it("is false at rest and during an active show (no hide scheduled)", () => {
      expect(overlay.hasPendingHide()).toBe(false);
      overlay.setVisible(true);
      vi.advanceTimersByTime(0);
      expect(overlay.hasPendingHide()).toBe(false); // live session: no stray consume
    });

    it("is true while a hide is scheduled, false after it fires", () => {
      overlay.setVisible(true);
      vi.advanceTimersByTime(0);
      overlay.setVisible(false, 700);
      expect(overlay.hasPendingHide()).toBe(true);
      vi.advanceTimersByTime(700);
      expect(overlay.hasPendingHide()).toBe(false);
    });

    it("is true while hover-paused", () => {
      overlay.setVisible(true);
      vi.advanceTimersByTime(0);
      overlay.setVisible(false, 7450);
      overlay.pauseHide();
      expect(overlay.hasPendingHide()).toBe(true);
    });
  });

  describe("expediteHide (user dismissed the notice)", () => {
    it("is a strict no-op when nothing is pending (recording-safe)", () => {
      overlay.setVisible(true);
      vi.advanceTimersByTime(0);
      const pushCount = pushes.length;
      overlay.expediteHide();
      vi.advanceTimersByTime(60000);
      expect(win.hide).not.toHaveBeenCalled();
      expect(pushes.length).toBe(pushCount); // no new will-hide announced
    });

    it("expedites a PAUSED hide, bypassing the resume floor, and consumes the pause", () => {
      overlay.setVisible(true);
      vi.advanceTimersByTime(0);
      overlay.setVisible(false, 10450);
      vi.advanceTimersByTime(3000);
      overlay.pauseHide();
      vi.advanceTimersByTime(1000);
      overlay.expediteHide();
      expect(pushes.at(-1)).toEqual({
        kind: "will-hide",
        seq: 1,
        in_ms: 350,
        exit: "default",
      });
      vi.advanceTimersByTime(350);
      expect(win.hide).toHaveBeenCalledTimes(1);
      // The pause bookkeeping was consumed: a trailing hover-leave resume
      // (the notice→null effect) must not re-announce or double-hide.
      const pushCount = pushes.length;
      overlay.resumeHide();
      vi.advanceTimersByTime(60000);
      expect(pushes.length).toBe(pushCount);
      expect(win.hide).toHaveBeenCalledTimes(1);
    });

    it("shrinks a pending sticky linger down to the expedite target", () => {
      overlay.setVisible(true);
      vi.advanceTimersByTime(0);
      overlay.setVisible(false, 12450);
      overlay.expediteHide();
      expect(pushes.at(-1)).toEqual({
        kind: "will-hide",
        seq: 1,
        in_ms: 350,
        exit: "default",
      });
      vi.advanceTimersByTime(350);
      expect(win.hide).toHaveBeenCalledTimes(1);
    });

    it("preserves explicit exit intent across pause/resume and expedite", () => {
      overlay.setVisible(true);
      vi.advanceTimersByTime(0);
      overlay.setVisible(false, 5000, "error");
      expect(pushes.at(-1)).toEqual({
        kind: "will-hide",
        seq: 1,
        in_ms: 5000,
        exit: "error",
      });

      overlay.pauseHide();
      overlay.resumeHide();
      expect(pushes.at(-1)).toEqual({
        kind: "will-hide",
        seq: 1,
        in_ms: expect.any(Number),
        exit: "error",
      });

      overlay.expediteHide();
      expect(pushes.at(-1)).toEqual({
        kind: "will-hide",
        seq: 1,
        in_ms: 350,
        exit: "error",
      });
    });

    it("never lengthens an almost-elapsed hide", () => {
      overlay.setVisible(true);
      vi.advanceTimersByTime(0);
      overlay.setVisible(false, 700);
      vi.advanceTimersByTime(600);
      overlay.expediteHide();
      vi.advanceTimersByTime(100);
      expect(win.hide).toHaveBeenCalledTimes(1);
    });

    it("an expedited hide is still cancelled by a newer show (epoch guard)", () => {
      overlay.setVisible(true);
      vi.advanceTimersByTime(0);
      overlay.setVisible(false, 10450);
      overlay.expediteHide();
      overlay.setVisible(true);
      vi.advanceTimersByTime(1000);
      expect(win.hide).not.toHaveBeenCalled();
    });
  });
});
