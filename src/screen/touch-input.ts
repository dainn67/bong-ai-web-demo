/**
 * Turning browser pointer events into touches on a 240×240 round display.
 *
 * Pure geometry and timing, no DOM and no React, so the rules that decide what
 * counts as a touch can be tested without a screen to poke at.
 *
 * Pointer events rather than touch events on purpose: one code path covers a
 * finger, a mouse and a stylus, and it carries a `pointerId`, which is what
 * makes more than one finger at a time tractable later.
 */

/** The badge's display, in its own pixels. The DOM element is any size. */
export const DISPLAY_SIZE = 240;

export interface DevicePoint {
  /** 0 … 240, left to right. */
  x: number;
  /** 0 … 240, top to bottom. */
  y: number;
}

export interface TouchStart extends DevicePoint {
  /** Milliseconds, from whatever clock the caller is using. */
  at: number;
}

/**
 * How far a finger may travel and still count as a tap.
 *
 * In device pixels, so it means the same thing however large the badge is
 * drawn. Generous, because this stands in for a child's finger on a screen the
 * size of a bottle cap.
 */
const TAP_SLOP = 14;

/** Longer than this and it is a press, not a tap. */
const TAP_TIMEOUT_MS = 700;

/**
 * Maps a point on the rendered element to a point on the device's display.
 *
 * The element is drawn at whatever size the layout gives it; the firmware only
 * ever thinks in its own 240 pixels, so everything above this line does too.
 */
export function toDevicePoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): DevicePoint {
  return {
    x: ((clientX - rect.left) / rect.width) * DISPLAY_SIZE,
    y: ((clientY - rect.top) / rect.height) * DISPLAY_SIZE,
  };
}

/**
 * Whether a point is on the glass.
 *
 * The display is round but its element is square, so the corners are inside
 * the box and outside the device. A real badge feels nothing there, and
 * neither should this — otherwise the demo responds to a click on a part of
 * the screen that does not exist.
 */
export function isInsideDisplay(point: DevicePoint): boolean {
  const radius = DISPLAY_SIZE / 2;
  const dx = point.x - radius;
  const dy = point.y - radius;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Whether a press and release make a tap.
 *
 * Distinguishing it from a drag matters now rather than later: without it, any
 * future swipe would also fire a tap on release, and the mic would toggle
 * every time someone swiped.
 */
export function isTap(start: TouchStart, end: TouchStart): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return (
    end.at - start.at <= TAP_TIMEOUT_MS && Math.hypot(dx, dy) <= TAP_SLOP
  );
}

/** Minimum distance in device pixels to count as a swipe gesture */
export const SWIPE_MIN_DISTANCE = 20;

export type SwipeDirection = 'swipe_up' | 'swipe_down' | 'swipe_left' | 'swipe_right';

export interface TouchZonesConfig {
  mode: 'tap' | 'swipe';
  zonesCount: number;
  layout?: string;
  timeoutMs?: number;
}

/**
 * Resolves which zone (e.g. 'zone_1', 'zone_2', ..., 'zone_6') a point belongs to
 * on the 240x240 circular screen.
 */
export function getTouchZone(
  point: DevicePoint,
  zonesCount: number = 2,
  layout: string = 'split_vertical'
): string {
  const count = Math.max(2, Math.min(6, zonesCount));
  const cx = DISPLAY_SIZE / 2; // 120
  const cy = DISPLAY_SIZE / 2; // 120

  if (layout === 'split_horizontal' && count === 2) {
    return point.y <= cy ? 'zone_1' : 'zone_2';
  }

  if (layout === 'split_vertical' && count === 2) {
    return point.x <= cx ? 'zone_1' : 'zone_2';
  }

  if (count === 3) {
    if (layout === 'split_vertical_3' || layout === 'columns') {
      if (point.x <= 80) return 'zone_1';
      if (point.x <= 160) return 'zone_2';
      return 'zone_3';
    }
    // Radial 3 slices (top, bottom-right, bottom-left)
    const rad = Math.atan2(point.y - cy, point.x - cx);
    let deg = (rad * 180) / Math.PI;
    deg = (deg + 360 + 90) % 360;
    if (deg < 120) return 'zone_1';
    if (deg < 240) return 'zone_2';
    return 'zone_3';
  }

  if (count === 4) {
    if (layout === 'split_vertical_4') {
      if (point.x <= 60) return 'zone_1';
      if (point.x <= 120) return 'zone_2';
      if (point.x <= 180) return 'zone_3';
      return 'zone_4';
    }
    // Quadrants: top-left (1), top-right (2), bottom-left (3), bottom-right (4)
    if (point.x <= cx && point.y <= cy) return 'zone_1';
    if (point.x > cx && point.y <= cy) return 'zone_2';
    if (point.x <= cx && point.y > cy) return 'zone_3';
    return 'zone_4';
  }

  if (count === 5) {
    // 5 radial slices of 72 degrees
    const rad = Math.atan2(point.y - cy, point.x - cx);
    let deg = (rad * 180) / Math.PI;
    deg = (deg + 360 + 90 - 36) % 360;
    const idx = Math.floor(deg / 72) + 1;
    return `zone_${Math.min(5, Math.max(1, idx))}`;
  }

  if (count === 6) {
    if (layout === 'grid_2x3') {
      const col = point.x <= 80 ? 1 : point.x <= 160 ? 2 : 3;
      const row = point.y <= cy ? 0 : 3;
      return `zone_${col + row}`;
    }
    // 6 radial slices of 60 degrees
    const rad = Math.atan2(point.y - cy, point.x - cx);
    let deg = (rad * 180) / Math.PI;
    deg = (deg + 360 + 90 - 30) % 360;
    const idx = Math.floor(deg / 60) + 1;
    return `zone_${Math.min(6, Math.max(1, idx))}`;
  }

  return point.x <= cx ? 'zone_1' : 'zone_2';
}

/**
 * Determines swipe direction from start to end points.
 */
export function getSwipeDirection(
  start: DevicePoint,
  end: DevicePoint
): SwipeDirection | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);

  if (dist < SWIPE_MIN_DISTANCE) {
    return null;
  }

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'swipe_right' : 'swipe_left';
  } else {
    return dy > 0 ? 'swipe_down' : 'swipe_up';
  }
}

