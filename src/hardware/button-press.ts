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
 * A quick press on a dark toy wakes it — a child should not have to know how
 * long to hold to get a response. Holding it opens the mode menu, whether the
 * badge is awake or not.
 *
 * The menu deliberately does not require a connection. A story or a lesson
 * disconnects the socket while it plays, so if the menu needed the badge awake,
 * leaving a story would strand the child: the menu would be unreachable until
 * they knew to tap the glass first and wait. Nothing in the menu needs the
 * socket anyway — the catalog is a plain fetch, and picking free talk connects.
 *
 * Goodbye keeps the longest hold, and only when there is something to say
 * goodbye to. It is the destructive one, so it should take deliberate effort to
 * reach past the menu rather than being what you hit by holding a moment too
 * long.
 *
 * The middle tier is the mode menu, which no real badge has (see
 * `menu-state.ts`). It lives on this button rather than a second control
 * because the hardware has exactly one, and a test affordance that invents a
 * button stops testing the hardware.
 */
export function classifyPress(heldMs: number, awake: boolean): ButtonAction {
  if (heldMs >= VERY_LONG_PRESS_MS) return awake ? 'goodbye' : 'menu';
  if (heldMs >= LONG_PRESS_MS) return 'menu';
  return awake ? 'press' : 'wake_up';
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
