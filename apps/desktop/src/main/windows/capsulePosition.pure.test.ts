import { describe, expect, it } from "vitest";
import {
  CAPSULE_STACK_BOTTOM_PADDING,
  LEGACY_PILL_BOTTOM_GAP,
  MIN_WORKAREA_BOTTOM_CLEARANCE,
  computeCapsuleBounds,
  type DisplayLike,
} from "./capsulePosition.pure.js";

const capsuleSize = { width: 360, height: 200 };

function visiblePillBottom(bounds: { y: number; height: number }): number {
  return bounds.y + bounds.height - CAPSULE_STACK_BOTTOM_PADDING;
}

describe("computeCapsuleBounds", () => {
  it("keeps the visible pill at the legacy bottom gap when there is no bottom Dock", () => {
    const display: DisplayLike = {
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 0, width: 1440, height: 900 },
    };

    const bounds = computeCapsuleBounds({
      displays: [display],
      cursorPoint: { x: 100, y: 100 },
      capsuleSize,
    });

    expect(bounds).toEqual({ x: 540, y: 636, width: 360, height: 200 });
    expect(display.workArea.y + display.workArea.height - visiblePillBottom(bounds!)).toBe(
      LEGACY_PILL_BOTTOM_GAP,
    );
  });

  it("clamps the visible pill just above a bottom Dock work area", () => {
    const display: DisplayLike = {
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 0, width: 1440, height: 830 },
    };

    const bounds = computeCapsuleBounds({
      displays: [display],
      cursorPoint: { x: 100, y: 100 },
      capsuleSize,
    });

    expect(bounds).toEqual({ x: 540, y: 630, width: 360, height: 200 });
    expect(display.workArea.y + display.workArea.height - visiblePillBottom(bounds!)).toBe(
      MIN_WORKAREA_BOTTOM_CLEARANCE,
    );
  });

  it("subtracts a shorter taskbar inset to preserve the physical-screen baseline", () => {
    const display: DisplayLike = {
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 0, width: 1440, height: 852 },
    };

    const bounds = computeCapsuleBounds({
      displays: [display],
      cursorPoint: { x: 100, y: 100 },
      capsuleSize,
    });

    expect(bounds).toEqual({ x: 540, y: 636, width: 360, height: 200 });
    expect(display.workArea.y + display.workArea.height - visiblePillBottom(bounds!)).toBe(24);
    expect(display.bounds.y + display.bounds.height - visiblePillBottom(bounds!)).toBe(
      LEGACY_PILL_BOTTOM_GAP,
    );
  });

  it("selects the cursor display from full bounds even when the cursor is over the Dock", () => {
    const displays: DisplayLike[] = [
      {
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        workArea: { x: 0, y: 0, width: 1440, height: 900 },
      },
      {
        bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
        workArea: { x: 1440, y: 0, width: 1920, height: 1010 },
      },
    ];

    expect(
      computeCapsuleBounds({
        displays,
        cursorPoint: { x: 1700, y: 1040 },
        capsuleSize,
      }),
    ).toEqual({ x: 2220, y: 810, width: 360, height: 200 });
  });

  it("treats adjacent display right and bottom edges as exclusive", () => {
    const displays: DisplayLike[] = [
      {
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        workArea: { x: 0, y: 0, width: 1440, height: 900 },
      },
      {
        bounds: { x: 1440, y: 0, width: 1920, height: 900 },
        workArea: { x: 1440, y: 0, width: 1920, height: 900 },
      },
    ];

    expect(
      computeCapsuleBounds({
        displays,
        cursorPoint: { x: 1440, y: 500 },
        capsuleSize,
      }),
    ).toEqual({ x: 2220, y: 636, width: 360, height: 200 });
  });

  it("falls back to the nearest display by full bounds when the cursor is outside all displays", () => {
    const displays: DisplayLike[] = [
      {
        bounds: { x: 0, y: 0, width: 1000, height: 1000 },
        workArea: { x: 0, y: 0, width: 1000, height: 1000 },
      },
      {
        bounds: { x: 1200, y: 0, width: 1000, height: 1000 },
        workArea: { x: 1500, y: 0, width: 700, height: 1000 },
      },
    ];

    expect(
      computeCapsuleBounds({
        displays,
        cursorPoint: { x: 1120, y: 500 },
        capsuleSize,
      }),
    ).toEqual({ x: 1670, y: 736, width: 360, height: 200 });
  });

  it("centers horizontally in the work area, not the full display bounds", () => {
    expect(
      computeCapsuleBounds({
        displays: [
          {
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            workArea: { x: 60, y: 0, width: 1200, height: 900 },
          },
        ],
        cursorPoint: { x: 100, y: 100 },
        capsuleSize,
      }),
    ).toEqual({ x: 480, y: 636, width: 360, height: 200 });
  });

  it("returns null when Electron reports no displays", () => {
    expect(
      computeCapsuleBounds({
        displays: [],
        cursorPoint: { x: 0, y: 0 },
        capsuleSize,
      }),
    ).toBeNull();
  });
});
