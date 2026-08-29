/**
 * Touch and swipe classifier for the 360×360 round screen.
 *
 * Implements the 7 touch layouts specified in Bong-AI-Layout-cam-ung.html:
 * - tap2_tren_duoi: 2 half-circle zones (top/bottom), no dead zone.
 * - tap2_trai_phai: 2 half-circle zones (left/right), no dead zone.
 * - tap3: 3 fan zones, dead centre r = 45px (25% radius).
 * - tap4: 4 fan zones, dead centre r = 45px (25% radius).
 * - tap5: 5 fan zones, dead centre r = 63px (35% radius).
 * - tap6: 6 fan zones, dead centre r = 63px (35% radius).
 * - swipe: 4-directional swipe (>=60px, <=800ms, dominant axis >= 1.5x).
 *
 * Pure geometry, fully testable without DOM.
 */

import { DISPLAY_SIZE, isInsideDisplay, type DevicePoint } from './touch-input';

export const SCREEN_RADIUS = DISPLAY_SIZE / 2; // 180
export const SCREEN_CENTER_X = SCREEN_RADIUS; // 180
export const SCREEN_CENTER_Y = SCREEN_RADIUS; // 180

export const DEAD_ZONE_RADIUS_25 = SCREEN_RADIUS * 0.25; // 45px (tap3, tap4)
export const DEAD_ZONE_RADIUS_35 = SCREEN_RADIUS * 0.35; // 63px (tap5, tap6)

export const SWIPE_MIN_DISTANCE_PX = 60;
export const SWIPE_MAX_DURATION_MS = 800;
export const SWIPE_AXIS_DOMINANCE_RATIO = 1.5;

export type TouchLayoutType =
  | 'tap2_tren_duoi'
  | 'tap2_trai_phai'
  | 'tap3'
  | 'tap4'
  | 'tap5'
  | 'tap6'
  | 'swipe';

/** The seven layouts a `câu hỏi chạm` may name, and nothing else. */
export const TOUCH_LAYOUTS: readonly TouchLayoutType[] = [
  'tap2_tren_duoi',
  'tap2_trai_phai',
  'tap3',
  'tap4',
  'tap5',
  'tap6',
  'swipe',
];

/**
 * Narrows an authored `layout` string, or null if it names none of the seven.
 *
 * Guessing a default here would be the wrong kind of forgiving: a typo'd layout
 * would silently grade the child against a grid the artwork was never drawn to,
 * and every zone would look like a content bug rather than a schema one.
 */
export function parseTouchLayout(value: unknown): TouchLayoutType | null {
  return typeof value === 'string' && (TOUCH_LAYOUTS as readonly string[]).includes(value)
    ? (value as TouchLayoutType)
    : null;
}

export type TouchZoneResult =
  | 'zone1'
  | 'zone2'
  | 'zone3'
  | 'zone4'
  | 'zone5'
  | 'zone6';

export type SwipeResult =
  | 'vuot_len'
  | 'vuot_xuong'
  | 'vuot_trai'
  | 'vuot_phai';

export type TouchClassificationResult =
  | TouchZoneResult
  | SwipeResult
  | 'cham_khac'
  | 'silent';

export type Point2D = DevicePoint;

export interface TouchGestureSample extends Point2D {
  at: number; // timestamp in ms
}

/**
 * What a press amounted to beyond its classification.
 *
 * Optional on the wire (§3.1 of the touch protocol), but worth carrying: a
 * server that only ever sees `zone3` cannot tell a confident jab at the picture
 * from a finger that landed a pixel inside the boundary, and that difference is
 * the whole story when a child keeps "getting it wrong".
 */
export interface TouchDetail {
  /** Where the finger landed, in device pixels, at press-down. */
  point: Point2D;
  /** How long it was held or dragged. */
  durationMs: number;
}

/**
 * The fan layouts, by how many sectors they cut and how wide their dead centre is.
 *
 * A table rather than a `switch` with a default, so that an unrecognised layout
 * cannot fall through to tap4's grid — that failure looks like a mis-drawn
 * illustration and would cost an afternoon to trace back to a typo.
 */
const FAN_LAYOUTS: Partial<Record<TouchLayoutType, { sectors: number; deadRadius: number }>> = {
  tap3: { sectors: 3, deadRadius: DEAD_ZONE_RADIUS_25 },
  tap4: { sectors: 4, deadRadius: DEAD_ZONE_RADIUS_25 },
  tap5: { sectors: 5, deadRadius: DEAD_ZONE_RADIUS_35 },
  tap6: { sectors: 6, deadRadius: DEAD_ZONE_RADIUS_35 },
};

/**
 * The shape of a layout, for whoever has to draw it.
 *
 * Exported so the overlay can render the grid the child is actually being
 * graded against, rather than keeping a second private idea of it. Drawing and
 * classifying reading from the same table is what stops the picture and the
 * verdict drifting apart.
 */
export type LayoutGeometry =
  | { kind: 'halves'; split: 'horizontal' | 'vertical' }
  | { kind: 'fan'; sectors: number; deadRadius: number }
  | { kind: 'swipe' };

export function layoutGeometry(layout: TouchLayoutType): LayoutGeometry {
  if (layout === 'tap2_tren_duoi') return { kind: 'halves', split: 'horizontal' };
  if (layout === 'tap2_trai_phai') return { kind: 'halves', split: 'vertical' };
  if (layout === 'swipe') return { kind: 'swipe' };
  const fan = FAN_LAYOUTS[layout]!;
  return { kind: 'fan', sectors: fan.sectors, deadRadius: fan.deadRadius };
}

/** How many answer zones a layout offers, ignoring `cham_khac` and `silent`. */
export function zoneCountFor(layout: TouchLayoutType): number {
  const geometry = layoutGeometry(layout);
  if (geometry.kind === 'halves') return 2;
  if (geometry.kind === 'swipe') return 4;
  return geometry.sectors;
}

/**
 * A touch window the server has opened: which grid, and how long it stays open.
 *
 * `layout` is already narrowed to one of the seven — a window is never opened
 * against a name that failed `parseTouchLayout`.
 */
export interface TouchWindow {
  layout: TouchLayoutType;
  timeoutMs: number;
}

/**
 * Classifies a single tap touch point according to the given layout.
 *
 * Takes coordinates at press-down. Outside circle or dead zone yields 'cham_khac'.
 */
export function classifyTap(point: Point2D, layout: TouchLayoutType): TouchClassificationResult {
  if (!isInsideDisplay(point)) {
    return 'cham_khac';
  }

  // Layouts without dead zones: split-halves.
  if (layout === 'tap2_tren_duoi') {
    return point.y <= SCREEN_CENTER_Y ? 'zone1' : 'zone2';
  }

  if (layout === 'tap2_trai_phai') {
    return point.x <= SCREEN_CENTER_X ? 'zone1' : 'zone2';
  }

  const fan = FAN_LAYOUTS[layout];
  // `swipe` lands here: a press with no drag is not an answer on that layout.
  if (!fan) return 'cham_khac';

  const dx = point.x - SCREEN_CENTER_X;
  const dy = point.y - SCREEN_CENTER_Y;
  if (dx * dx + dy * dy <= fan.deadRadius * fan.deadRadius) {
    return 'cham_khac';
  }

  // Clockwise from 12 o'clock. In screen coordinates 12 o'clock is dx=0, dy=-R,
  // so atan2(dx, -dy) puts 0° at the top and +90° at 3 o'clock.
  let angleDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;

  // Zone 1 **starts** at 12 o'clock and runs clockwise, so it spans
  // [0, sectorDeg). No half-sector shift: the boundary sits on 12 o'clock
  // rather than the middle of zone 1 doing so.
  //
  // This matches the lesson artwork, which is drawn that way throughout, and
  // is the convention the project settled on. An earlier revision had zone 1
  // centred on 12 o'clock instead; the docs and the demo pictures in this repo
  // were moved with it, so anything still showing a slice straddling the top
  // is from before that decision and is wrong.
  const sectorDeg = 360 / fan.sectors;
  const index = Math.min(fan.sectors - 1, Math.floor(angleDeg / sectorDeg));

  return `zone${index + 1}` as TouchZoneResult;
}

/**
 * Classifies a swipe gesture given start and end points with timestamps.
 */
export function classifySwipe(
  start: TouchGestureSample,
  end: TouchGestureSample,
): TouchClassificationResult {
  // The touch panel is square while the glass is round, so a finger can land on
  // a corner that does not exist. Same rule as a tap: off the glass is
  // `cham_khac`, whatever it does afterwards.
  if (!isInsideDisplay(start)) {
    return 'cham_khac';
  }

  const duration = end.at - start.at;
  if (duration > SWIPE_MAX_DURATION_MS || duration < 0) {
    return 'cham_khac';
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);

  if (distance < SWIPE_MIN_DISTANCE_PX) {
    return 'cham_khac';
  }

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  // Check dominant axis (at least 1.5x the other axis)
  if (absX >= SWIPE_AXIS_DOMINANCE_RATIO * absY) {
    return dx > 0 ? 'vuot_phai' : 'vuot_trai';
  }

  if (absY >= SWIPE_AXIS_DOMINANCE_RATIO * absX) {
    return dy > 0 ? 'vuot_xuong' : 'vuot_len';
  }

  // Ambiguous angle (not enough axis dominance)
  return 'cham_khac';
}

/**
 * High-level classifier for any touch gesture (tap or swipe).
 */
export function classifyGesture(
  start: TouchGestureSample,
  end: TouchGestureSample | null,
  layout: TouchLayoutType,
): TouchClassificationResult {
  if (layout === 'swipe') {
    if (!end) return 'cham_khac';
    return classifySwipe(start, end);
  }

  // For tap layouts, take coordinate at press-down (start point)
  return classifyTap(start, layout);
}
