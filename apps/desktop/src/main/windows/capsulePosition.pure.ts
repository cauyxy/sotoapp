// Pure capsule positioning logic. Kept Electron-free so multi-display placement
// can be verified without booting the desktop shell.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface DisplayLike {
  bounds: Rect;
  workArea: Rect;
}

export interface CapsulePositionInput {
  displays: readonly DisplayLike[];
  cursorPoint: Point;
  capsuleSize: { width: number; height: number };
}

export const LEGACY_PILL_BOTTOM_GAP = 72;
export const CAPSULE_STACK_BOTTOM_PADDING = 8;
export const MIN_WORKAREA_BOTTOM_CLEARANCE = 8;

function bottomOf(rect: Rect): number {
  return rect.y + rect.height;
}

function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

function distanceToRectSquared(point: Point, rect: Rect): number {
  const dx = point.x < rect.x ? rect.x - point.x : Math.max(0, point.x - (rect.x + rect.width));
  const dy = point.y < rect.y ? rect.y - point.y : Math.max(0, point.y - (rect.y + rect.height));
  return dx * dx + dy * dy;
}

function nearestDisplay(displays: readonly DisplayLike[], point: Point): DisplayLike {
  let best = displays[0]!;
  let bestDistance = distanceToRectSquared(point, best.bounds);
  for (const display of displays.slice(1)) {
    const distance = distanceToRectSquared(point, display.bounds);
    if (distance < bestDistance) {
      best = display;
      bestDistance = distance;
    }
  }
  return best;
}

function displayForCursor(displays: readonly DisplayLike[], cursorPoint: Point): DisplayLike {
  for (const display of displays) {
    if (containsPoint(display.bounds, cursorPoint)) return display;
  }

  return nearestDisplay(displays, cursorPoint);
}

export function bottomSystemInset(display: DisplayLike): number {
  return Math.max(0, bottomOf(display.bounds) - bottomOf(display.workArea));
}

export function overlayGapFromWorkAreaBottom(display: DisplayLike): number {
  const pillGapFromWorkAreaBottom = Math.max(
    MIN_WORKAREA_BOTTOM_CLEARANCE,
    LEGACY_PILL_BOTTOM_GAP - bottomSystemInset(display),
  );
  return Math.max(0, pillGapFromWorkAreaBottom - CAPSULE_STACK_BOTTOM_PADDING);
}

export function computeCapsuleBounds(input: CapsulePositionInput): Rect | null {
  const { displays, cursorPoint, capsuleSize } = input;
  if (displays.length === 0) return null;

  const display = displayForCursor(displays, cursorPoint);
  const { workArea } = display;
  const workAreaBottom = bottomOf(workArea);
  const overlayGap = overlayGapFromWorkAreaBottom(display);
  return {
    x: Math.round(workArea.x + (workArea.width - capsuleSize.width) / 2),
    y: Math.round(workAreaBottom - capsuleSize.height - overlayGap),
    width: capsuleSize.width,
    height: capsuleSize.height,
  };
}
