import { describe, expect, it } from 'vitest';
import {
  classifyGesture,
  classifySwipe,
  classifyTap,
  DEAD_ZONE_RADIUS_25,
  DEAD_ZONE_RADIUS_35,
  layoutGeometry,
  parseTouchLayout,
  TOUCH_LAYOUTS,
  zoneCountFor,
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

    it('starts zone 1 at 12 o clock and runs clockwise', () => {
      // Quadrants, so the middle of each is a diagonal. Zone 1 is the
      // top-right quarter, not the top — a boundary sits on 12 o'clock.
      expect(classifyTap({ x: 270, y: 90 }, 'tap4')).toBe('zone1'); // ~1:30
      expect(classifyTap({ x: 270, y: 270 }, 'tap4')).toBe('zone2'); // ~4:30
      expect(classifyTap({ x: 90, y: 270 }, 'tap4')).toBe('zone3'); // ~7:30
      expect(classifyTap({ x: 90, y: 90 }, 'tap4')).toBe('zone4'); // ~10:30
    });

    it('gives 12 o clock itself to zone 1, the lower-numbered side', () => {
      // The boundary lands exactly on the top. Pinned so both sides of the
      // wire agree about a press one pixel either way.
      expect(classifyTap({ x: 180, y: 50 }, 'tap4')).toBe('zone1');
      expect(classifyTap({ x: 179, y: 50 }, 'tap4')).toBe('zone4');
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

    it('starts zone 1 at 12 o clock, so the three run 0-120-240', () => {
      expect(classifyTap({ x: 280, y: 110 }, 'tap3')).toBe('zone1'); // ~2 o'clock
      expect(classifyTap({ x: 180, y: 320 }, 'tap3')).toBe('zone2'); // 6 o'clock
      expect(classifyTap({ x: 80, y: 110 }, 'tap3')).toBe('zone3'); // ~10 o'clock
    });
  });

  describe('tap5 & tap6', () => {
    it('has the larger dead centre (r <= 63px)', () => {
      expect(classifyTap({ x: 180, y: 130 }, 'tap5')).toBe('cham_khac'); // 50px out
      expect(classifyTap({ x: 180, y: 100 }, 'tap5')).toBe('zone1'); // 80px out
      expect(classifyTap({ x: 180, y: 130 }, 'tap6')).toBe('cham_khac');
    });

    it('numbers tap6 clockwise every 60 degrees from 12 o clock', () => {
      // Sector centres now sit at 30, 90, 150, … — the 1, 3, 5 o'clock
      // positions — because zone 1 begins at the top rather than straddling it.
      expect(classifyTap({ x: 245, y: 70 }, 'tap6')).toBe('zone1'); // ~1 o'clock
      expect(classifyTap({ x: 320, y: 180 }, 'tap6')).toBe('zone2'); // 3 o'clock
      expect(classifyTap({ x: 245, y: 290 }, 'tap6')).toBe('zone3'); // ~5 o'clock
      expect(classifyTap({ x: 115, y: 290 }, 'tap6')).toBe('zone4'); // ~7 o'clock
      expect(classifyTap({ x: 40, y: 180 }, 'tap6')).toBe('zone5'); // 9 o'clock
      expect(classifyTap({ x: 115, y: 70 }, 'tap6')).toBe('zone6'); // ~11 o'clock
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

    it('rejects a swipe shorter than minimum distance', () => {
      expect(classifySwipe(base, { x: 180, y: 165, at: 1400 })).toBe('cham_khac');
    });

    it('rejects a swipe slower than maximum duration', () => {
      expect(classifySwipe(base, { x: 180, y: 50, at: 2500 })).toBe('cham_khac');
    });

    it('rejects a diagonal with no dominant axis (< 1.2x)', () => {
      // dx 80, dy 75 — ratio 1.06.
      expect(classifySwipe(base, { x: 260, y: 255, at: 1400 })).toBe('cham_khac');
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

  describe('zone naming', () => {
    // Measured against the live server: answering `zone1` and `zone2` on one
    // question returns two different branch clips, while `zone_1`, `zone_2` and
    // nonsense all return the same fallback. The underscore spelling matches no
    // branch in any lesson, so every answer took one path and the branching
    // looked broken. Pinned here so it cannot come back.
    it('has no underscore between the word and the number', () => {
      for (const layout of TOUCH_LAYOUTS) {
        if (layout === 'swipe') continue;
        const result = classifyTap({ x: 180, y: 40 }, layout);
        expect(result).toMatch(/^zone[1-6]$/);
      }
    });

    it('names swipes in Vietnamese, the way lesson branches do', () => {
      const from = { x: 180, y: 240, at: 1000 };
      expect(classifySwipe(from, { x: 180, y: 120, at: 1200 })).toBe('vuot_len');
      expect(classifySwipe(from, { x: 60, y: 240, at: 1200 })).toBe('vuot_trai');
    });
  });

  describe('layoutGeometry', () => {
    it('splits the two-zone layouts on the axis their name says', () => {
      expect(layoutGeometry('tap2_tren_duoi')).toEqual({ kind: 'halves', split: 'horizontal' });
      expect(layoutGeometry('tap2_trai_phai')).toEqual({ kind: 'halves', split: 'vertical' });
    });

    it('reports the sector count and dead radius the classifier uses', () => {
      expect(layoutGeometry('tap3')).toEqual({
        kind: 'fan',
        sectors: 3,
        deadRadius: DEAD_ZONE_RADIUS_25,
      });
      expect(layoutGeometry('tap6')).toEqual({
        kind: 'fan',
        sectors: 6,
        deadRadius: DEAD_ZONE_RADIUS_35,
      });
      // 25% and 35% of the 180px radius, per the layout doc.
      expect(DEAD_ZONE_RADIUS_25).toBeCloseTo(45);
      expect(DEAD_ZONE_RADIUS_35).toBeCloseTo(63);
    });

    it('agrees with the classifier about every zone it draws', () => {
      // The drawing and the verdict reading one table is the whole point: a
      // label placed in the middle of the slice it names must classify as that
      // zone, or the picture is lying about where the boundaries are.
      for (const layout of ['tap3', 'tap4', 'tap5', 'tap6'] as const) {
        const geometry = layoutGeometry(layout);
        if (geometry.kind !== 'fan') throw new Error('expected a fan');
        const sectorDeg = 360 / geometry.sectors;
        const radius = (180 + geometry.deadRadius) / 2;
        for (let i = 0; i < geometry.sectors; i++) {
          // The middle of the slice, which is where the overlay puts the label.
          const rad = ((i * sectorDeg + sectorDeg / 2 - 90) * Math.PI) / 180;
          const point = { x: 180 + radius * Math.cos(rad), y: 180 + radius * Math.sin(rad) };
          expect(classifyTap(point, layout)).toBe(`zone${i + 1}`);
        }
      }
    });
  });

  describe('zoneCountFor', () => {
    it('counts answer zones, which is what the server keeps getting wrong', () => {
      expect(zoneCountFor('tap2_tren_duoi')).toBe(2);
      expect(zoneCountFor('tap4')).toBe(4);
      expect(zoneCountFor('tap6')).toBe(6);
      expect(zoneCountFor('swipe')).toBe(4);
    });
  });
});
