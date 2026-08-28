import { describe, expect, it } from 'vitest';
import { DISPLAY_SIZE, isInsideDisplay, isTap, toDevicePoint, getTouchZone, getSwipeDirection } from './touch-input';


const rect = { left: 100, top: 50, width: 480, height: 480 };

describe('toDevicePoint', () => {
  it('maps the rendered element onto the display regardless of how big it is drawn', () => {
    // The element is 480px here; the firmware only knows about 240.
    expect(toDevicePoint(340, 290, rect)).toEqual({ x: 120, y: 120 });
    expect(toDevicePoint(100, 50, rect)).toEqual({ x: 0, y: 0 });
  });
});

describe('isInsideDisplay', () => {
  it('accepts the middle of the glass', () => {
    expect(isInsideDisplay({ x: 120, y: 120 })).toBe(true);
  });

  it('rejects the corners of the square the circle is drawn in', () => {
    // A real badge feels nothing there — the device does not extend that far.
    expect(isInsideDisplay({ x: 0, y: 0 })).toBe(false);
    expect(isInsideDisplay({ x: DISPLAY_SIZE, y: DISPLAY_SIZE })).toBe(false);
  });

  it('accepts a point just inside the rim', () => {
    expect(isInsideDisplay({ x: 4, y: 120 })).toBe(true);
  });
});

describe('isTap', () => {
  const start = { x: 120, y: 120, at: 1000 };

  it('accepts a quick press and release in one spot', () => {
    expect(isTap(start, { x: 123, y: 118, at: 1120 })).toBe(true);
  });

  it('rejects a drag, so a future swipe will not also toggle the mic', () => {
    expect(isTap(start, { x: 200, y: 120, at: 1150 })).toBe(false);
  });

  it('rejects a long press', () => {
    expect(isTap(start, { x: 120, y: 120, at: 2400 })).toBe(false);
  });
});

describe('getTouchZone', () => {
  it('splits vertical into zone_1 (left) and zone_2 (right)', () => {
    expect(getTouchZone({ x: 50, y: 120 }, 2, 'split_vertical')).toBe('zone_1');
    expect(getTouchZone({ x: 180, y: 120 }, 2, 'split_vertical')).toBe('zone_2');
  });

  it('splits horizontal into zone_1 (top) and zone_2 (bottom)', () => {
    expect(getTouchZone({ x: 120, y: 40 }, 2, 'split_horizontal')).toBe('zone_1');
    expect(getTouchZone({ x: 120, y: 200 }, 2, 'split_horizontal')).toBe('zone_2');
  });

  it('resolves quadrants for 4 zones', () => {
    expect(getTouchZone({ x: 50, y: 50 }, 4, 'quadrant')).toBe('zone_1');
    expect(getTouchZone({ x: 190, y: 50 }, 4, 'quadrant')).toBe('zone_2');
    expect(getTouchZone({ x: 50, y: 190 }, 4, 'quadrant')).toBe('zone_3');
    expect(getTouchZone({ x: 190, y: 190 }, 4, 'quadrant')).toBe('zone_4');
  });

  it('resolves radial slices for 3 zones', () => {
    expect(getTouchZone({ x: 120, y: 30 }, 3, 'radial_3')).toBe('zone_1');
  });
});

describe('getSwipeDirection', () => {
  it('detects swipe directions correctly', () => {
    expect(getSwipeDirection({ x: 120, y: 120 }, { x: 200, y: 120 })).toBe('swipe_right');
    expect(getSwipeDirection({ x: 120, y: 120 }, { x: 40, y: 120 })).toBe('swipe_left');
    expect(getSwipeDirection({ x: 120, y: 120 }, { x: 120, y: 200 })).toBe('swipe_down');
    expect(getSwipeDirection({ x: 120, y: 120 }, { x: 120, y: 40 })).toBe('swipe_up');
  });

  it('rejects movements smaller than min swipe distance', () => {
    expect(getSwipeDirection({ x: 120, y: 120 }, { x: 125, y: 125 })).toBeNull();
  });
});

