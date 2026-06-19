import { describe, expect, it, vi } from "vitest";

import { MediaMuteCoordinator, type MutePort } from "./mediaMute.js";

function fakePort(initial = false): MutePort & { muted: boolean; sets: boolean[] } {
  const state = {
    muted: initial,
    sets: [] as boolean[],
    isMuted: () => state.muted,
    setMuted: (m: boolean) => {
      state.muted = m;
      state.sets.push(m);
    },
  };
  return state;
}

describe("MediaMuteCoordinator", () => {
  it("mutes on engage and restores (unmutes) on release", () => {
    const port = fakePort(false);
    const c = new MediaMuteCoordinator(port);
    c.engage();
    expect(port.muted).toBe(true);
    expect(c.isEngaged).toBe(true);
    c.release();
    expect(port.muted).toBe(false);
    expect(c.isEngaged).toBe(false);
  });

  it("does not stack: a second engage is a no-op", () => {
    const port = fakePort(false);
    const c = new MediaMuteCoordinator(port);
    c.engage();
    c.engage();
    c.engage();
    expect(port.sets).toEqual([true]); // muted exactly once
    c.release();
    expect(port.sets).toEqual([true, false]); // restored exactly once
  });

  it("release is idempotent across every terminal path", () => {
    const port = fakePort(false);
    const c = new MediaMuteCoordinator(port);
    c.engage();
    c.release();
    c.release();
    c.release();
    expect(port.sets).toEqual([true, false]);
  });

  it("release without engage is a no-op", () => {
    const port = fakePort(false);
    const c = new MediaMuteCoordinator(port);
    c.release();
    expect(port.sets).toEqual([]);
  });

  it("preserves a user's pre-existing mute: never re-mutes, never unmutes them", () => {
    const port = fakePort(true); // user already muted output
    const c = new MediaMuteCoordinator(port);
    c.engage();
    expect(port.sets).toEqual([]); // we did not touch it
    c.release();
    expect(port.sets).toEqual([]); // still untouched → stays muted as the user left it
    expect(port.muted).toBe(true);
  });

  it("supports repeated sessions without leaking state", () => {
    const port = fakePort(false);
    const c = new MediaMuteCoordinator(port);
    c.engage();
    c.release();
    c.engage();
    c.release();
    expect(port.sets).toEqual([true, false, true, false]);
  });

  it("a throwing setMuted never escapes (mute is best-effort)", () => {
    const port: MutePort = {
      isMuted: () => false,
      setMuted: vi.fn(() => {
        throw new Error("CoreAudio boom");
      }),
    };
    const c = new MediaMuteCoordinator(port);
    expect(() => c.engage()).not.toThrow();
    expect(() => c.release()).not.toThrow();
  });

  it("a throwing isMuted is tolerated (assumes unmuted prior)", () => {
    const port: MutePort = {
      isMuted: () => {
        throw new Error("read failed");
      },
      setMuted: vi.fn(),
    };
    const c = new MediaMuteCoordinator(port);
    c.engage();
    expect(port.setMuted).toHaveBeenCalledWith(true);
    c.release();
    expect(port.setMuted).toHaveBeenCalledWith(false);
  });
});
