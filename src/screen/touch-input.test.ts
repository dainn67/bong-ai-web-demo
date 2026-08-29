import { describe, expect, it } from 'vitest';
import { DISPLAY_SIZE, isInsideDisplay, isTap, toDevicePoint } from './touch-input';


const rect = { left: 100, top: 50, width: 480, height: 480 };

describe('toDevicePoint', () => {
  it('maps the rendered element onto the display regardless of how big it is drawn', () => {
    // The element is 480px here; the firmware knows about 360.
    // clientX = 100 + 480/2 = 340 -> (240/480)*360 = 180
    expect(toDevicePoint(340, 290, rect)).toEqual({ x: 180, y: 180 });
    expect(toDevicePoint(100, 50, rect)).toEqual({ x: 0, y: 0 });
  });
});

describe('isInsideDisplay', () => {
  it('accepts the middle of the glass', () => {
    expect(isInsideDisplay({ x: 180, y: 180 })).toBe(true);
  });

  it('rejects the corners of the square the circle is drawn in', () => {
    // A real badge feels nothing there — the device does not extend that far.
    expect(isInsideDisplay({ x: 0, y: 0 })).toBe(false);
    expect(isInsideDisplay({ x: DISPLAY_SIZE, y: DISPLAY_SIZE })).toBe(false);
  });

  it('accepts a point just inside the rim', () => {
    expect(isInsideDisplay({ x: 4, y: 180 })).toBe(true);
  });
});

describe('isTap', () => {
  const start = { x: 180, y: 180, at: 1000 };

  it('accepts a quick press and release in one spot', () => {
    expect(isTap(start, { x: 183, y: 178, at: 1120 })).toBe(true);
  });

  it('rejects a drag, so a future swipe will not also toggle the mic', () => {
    expect(isTap(start, { x: 260, y: 180, at: 1150 })).toBe(false);
  });

  it('rejects a long press', () => {
    expect(isTap(start, { x: 180, y: 180, at: 2400 })).toBe(false);
  });
});

