/**
 * The badge's one physical button.
 *
 * Real hardware has a button, not three labelled ones, so what a press *means*
 * comes from how long it was held and whether the badge was awake. Pure — the
 * rules are worth testing without a finger.
 */

/** Held longer than this and it is a long press. */
export const LONG_PRESS_MS = 800;

export type ButtonAction = 'wake_up' | 'press' | 'goodbye';

/**
 * What one press of the **power** button means.
 *
 * Asleep, anything wakes it — a child holding a dark toy should not have to
 * know how long to hold. Awake, holding it is how you say goodbye, which is the
 * convention every device with a power button uses.
 *
 * Navigation is deliberately not here. It used to be — the menu lived on a
 * middle hold tier of this one button — and that was a symptom of having only
 * one button to spend. With a home and a back button on the rim, each control
 * means one thing, and the tier that existed purely because we were short of
 * buttons is gone.
 */
export function classifyPress(heldMs: number, awake: boolean): ButtonAction {
  if (!awake) return 'wake_up';
  return heldMs >= LONG_PRESS_MS ? 'goodbye' : 'press';
}

/**
 * How far one press moves the volume.
 *
 * Five steps across the range. Fewer and the jumps are coarse; more and a child
 * is pressing all afternoon to get from quiet to loud.
 */
export const VOLUME_STEP = 0.2;

/** Clamps a stepped volume back into range. */
export function stepVolume(volume: number, delta: number): number {
  return Math.min(1, Math.max(0, Math.round((volume + delta) * 100) / 100));
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
