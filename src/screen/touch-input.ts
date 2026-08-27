/**
 * Turning browser pointer events into touches on a 360×360 round display.
 *
 * Pure geometry and timing, no DOM and no React, so the rules that decide what
 * counts as a touch can be tested without a screen to poke at.
 *
 * Pointer events rather than touch events on purpose: one code path covers a
 * finger, a mouse and a stylus, and it carries a `pointerId`, which is what
 * makes more than one finger at a time tractable later.
 */

/** The badge's display, in its own pixels. The DOM element is any size. */
export const DISPLAY_SIZE = 360;

export interface DevicePoint {
  /** 0 … 360, left to right. */
  x: number;
  /** 0 … 360, top to bottom. */
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
 * ever thinks in its own 360 pixels, so everything above this line does too.
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
