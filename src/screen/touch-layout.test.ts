import { describe, expect, it } from 'vitest';
import {
  classifyGesture,
  classifySwipe,
  classifyTap,
  parseTouchLayout,
  TOUCH_LAYOUTS,
} from './touch-layout';

describe('touch-layout', () => {
  describe('parseTouchLayout', () => {
    it('accepts exactly the seven layouts the spec names', () => {
      for (const layout of TOUCH_LAYOUTS) {
        expect(parseTouchLayout(layout)).toBe(layout);
      }
      expect(TOUCH_LAYOUTS).toHaveLength(7);
    });

    it('rejects anything else rather than guessing tap4', () => {
      expect(parseTouchLayout('tap7')).toBeNull();
      expect(parseTouchLayout('TAP4')).toBeNull();
      expect(parseTouchLayout(undefined)).toBeNull();
      expect(parseTouchLayout(4)).toBeNull();
    });
  });

  describe('tap2_tren_duoi & tap2_trai_phai', () => {
    it('splits top and bottom with no dead zone', () => {
      expect(classifyTap({ x: 180, y: 100 }, 'tap2_tren_duoi')).toBe('zone1');
      // The centre is a live zone here — only fan layouts have a dead middle.
      expect(classifyTap({ x: 180, y: 180 }, 'tap2_tren_duoi')).toBe('zone1');
      expect(classifyTap({ x: 180, y: 250 }, 'tap2_tren_duoi')).toBe('zone2');
    });

    it('splits left and right with no dead zone', () => {
      expect(classifyTap({ x: 80, y: 180 }, 'tap2_trai_phai')).toBe('zone1');
      expect(classifyTap({ x: 180, y: 180 }, 'tap2_trai_phai')).toBe('zone1');
      expect(classifyTap({ x: 280, y: 180 }, 'tap2_trai_phai')).toBe('zone2');
    });
  });

  describe('tap4', () => {
    it('returns cham_khac in the dead centre (r <= 45px)', () => {
      expect(classifyTap({ x: 180, y: 180 }, 'tap4')).toBe('cham_khac');
      expect(classifyTap({ x: 180, y: 150 }, 'tap4')).toBe('cham_khac'); // 30px out
      expect(classifyTap({ x: 180, y: 134 }, 'tap4')).toBe('zone1'); // 46px out
    });

    it('numbers four zones clockwise from 12 o clock', () => {
      expect(classifyTap({ x: 180, y: 50 }, 'tap4')).toBe('zone1'); // top
      expect(classifyTap({ x: 310, y: 180 }, 'tap4')).toBe('zone2'); // right
      expect(classifyTap({ x: 180, y: 310 }, 'tap4')).toBe('zone3'); // bottom
      expect(classifyTap({ x: 50, y: 180 }, 'tap4')).toBe('zone4'); // left
    });

    it('returns cham_khac outside the circle, where the glass does not exist', () => {
      // Corners of the square panel the round display is cut from.
      expect(classifyTap({ x: 10, y: 10 }, 'tap4')).toBe('cham_khac');
      expect(classifyTap({ x: 350, y: 350 }, 'tap4')).toBe('cham_khac');
    });
  });

  describe('tap3', () => {
    it('returns cham_khac in the dead centre (r <= 45px)', () => {
      expect(classifyTap({ x: 180, y: 180 }, 'tap3')).toBe('cham_khac');
    });

    it('puts zone 1 across the top and two zones below it', () => {
      expect(classifyTap({ x: 180, y: 60 }, 'tap3')).toBe('zone1');
      expect(classifyTap({ x: 280, y: 260 }, 'tap3')).toBe('zone2'); // ~4 o'clock
      expect(classifyTap({ x: 80, y: 260 }, 'tap3')).toBe('zone3'); // ~8 o'clock
    });
  });

  describe('tap5 & tap6', () => {
    it('has the larger dead centre (r <= 63px)', () => {
      expect(classifyTap({ x: 180, y: 130 }, 'tap5')).toBe('cham_khac'); // 50px out
      expect(classifyTap({ x: 180, y: 100 }, 'tap5')).toBe('zone1'); // 80px out
      expect(classifyTap({ x: 180, y: 130 }, 'tap6')).toBe('cham_khac');
    });

    it('numbers tap6 clockwise every 60 degrees', () => {
      expect(classifyTap({ x: 180, y: 40 }, 'tap6')).toBe('zone1'); // 12 o'clock
      expect(classifyTap({ x: 290, y: 110 }, 'tap6')).toBe('zone2'); // 2 o'clock
      expect(classifyTap({ x: 290, y: 250 }, 'tap6')).toBe('zone3'); // 4 o'clock
      expect(classifyTap({ x: 180, y: 320 }, 'tap6')).toBe('zone4'); // 6 o'clock
      expect(classifyTap({ x: 70, y: 250 }, 'tap6')).toBe('zone5'); // 8 o'clock
      expect(classifyTap({ x: 70, y: 110 }, 'tap6')).toBe('zone6'); // 10 o'clock
    });
  });

  describe('swipe gestures', () => {
    const base = { x: 180, y: 180, at: 1000 };

    it('reads the four directions', () => {
      expect(classifySwipe(base, { x: 180, y: 80, at: 1400 })).toBe('vuot_len');
      expect(classifySwipe(base, { x: 180, y: 280, at: 1400 })).toBe('vuot_xuong');
      expect(classifySwipe(base, { x: 80, y: 180, at: 1400 })).toBe('vuot_trai');
      expect(classifySwipe(base, { x: 280, y: 180, at: 1400 })).toBe('vuot_phai');
    });

    it('rejects a swipe shorter than 60px', () => {
      expect(classifySwipe(base, { x: 180, y: 130, at: 1400 })).toBe('cham_khac');
    });

    it('rejects a swipe slower than 800ms', () => {
      expect(classifySwipe(base, { x: 180, y: 50, at: 1900 })).toBe('cham_khac');
    });

    it('rejects a diagonal with no dominant axis (< 1.5x)', () => {
      // dx 80, dy 70 — ratio 1.14.
      expect(classifySwipe(base, { x: 260, y: 250, at: 1400 })).toBe('cham_khac');
    });

    it('rejects a swipe that started off the glass', () => {
      // Begins in a corner of the square panel: no glass there to press.
      const corner = { x: 12, y: 12, at: 1000 };
      expect(classifySwipe(corner, { x: 12, y: 200, at: 1300 })).toBe('cham_khac');
    });

    it('treats a press with no drag on a swipe layout as cham_khac', () => {
      expect(classifyGesture(base, null, 'swipe')).toBe('cham_khac');
      expect(classifyGesture(base, base, 'swipe')).toBe('cham_khac');
      expect(classifyGesture(base, { x: 180, y: 80, at: 1300 }, 'swipe')).toBe('vuot_len');
    });

    it('reads the press-down point on tap layouts, not the release', () => {
      // A child dragging from zone1 into zone3 still answered zone1.
      expect(classifyGesture({ x: 180, y: 50, at: 1000 }, { x: 180, y: 310, at: 1200 }, 'tap4')).toBe(
        'zone1',
      );
    });
  });
});
