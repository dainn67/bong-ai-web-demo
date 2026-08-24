/**
 * The badge's one physical button.
 *
 * Real hardware has a button, not three labelled ones, so what a press *means*
 * comes from how long it was held and whether the badge was awake. Pure — the
 * rules are worth testing without a finger.
 */

/** Held longer than this and it is a long press. */
export const LONG_PRESS_MS = 800;

/** Held past this and the long press becomes a goodbye instead of the menu. */
export const VERY_LONG_PRESS_MS = 2_000;

export type ButtonAction = 'wake_up' | 'press' | 'menu' | 'goodbye';

/**
 * What one press means.
 *
 * Asleep, anything wakes it — a child holding a dark toy should not have to
 * know how long to hold. Awake, the duration picks between three things.
 *
 * The middle tier is the mode menu, which no real badge has (see
 * `menu-state.ts`). It is put here rather than on a second control because the
 * hardware has exactly one button, and a test affordance that invents a button
 * stops testing the hardware. Goodbye keeps the longest hold — it is the
 * destructive one, and it should take deliberate effort to reach past the menu.
 */
export function classifyPress(heldMs: number, awake: boolean): ButtonAction {
  if (!awake) return 'wake_up';
  if (heldMs >= VERY_LONG_PRESS_MS) return 'goodbye';
  return heldMs >= LONG_PRESS_MS ? 'menu' : 'press';
}

/** Mirrors the backend: debounce 3s, and no more than ten presses a minute. */
export const DEBOUNCE_MS = 3_000;
export const MAX_PRESSES_PER_MINUTE = 10;

export type ThrottleReason = 'debounced' | 'rate_limited';

export interface ThrottleVerdict {
  allowed: boolean;
  reason?: ThrottleReason;
  message?: string;
}

/**
 * Decides whether a press counts, given the ones before it.
 *
 * The same rules the backend applies, run locally too: the firmware debounces
 * in the device, and the simulator should behave the same whether or not a
 * backend happens to be reachable. `history` is the timestamps of presses that
 * were allowed, newest last.
 */
export function throttlePress(history: number[], now: number): ThrottleVerdict {
  const recent = history.filter((at) => now - at <= 60_000);
  const last = recent[recent.length - 1];

  if (last !== undefined && now - last < DEBOUNCE_MS) {
    return {
      allowed: false,
      reason: 'debounced',
      message: 'Bống đang xử lý, bé đợi Bống 1 chút nha!',
    };
  }
  if (recent.length >= MAX_PRESSES_PER_MINUTE) {
    return {
      allowed: false,
      reason: 'rate_limited',
      message: 'Bé ơi, bé bấm nhanh quá! Đợi Bống một chút nhé!',
    };
  }
  return { allowed: true };
}

/** Drops presses older than the rate-limit window, so history cannot grow forever. */
export function pruneHistory(history: number[], now: number): number[] {
  return history.filter((at) => now - at <= 60_000);
}
