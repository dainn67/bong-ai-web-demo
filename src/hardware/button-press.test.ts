import { describe, expect, it } from 'vitest';
import {
  classifyPress,
  DEBOUNCE_MS,
  LONG_PRESS_MS,
  MAX_PRESSES_PER_MINUTE,
  pruneHistory,
  throttlePress,
  VERY_LONG_PRESS_MS,
} from './button-press';

describe('classifyPress', () => {
  it('wakes the badge however briefly it was pressed', () => {
    // A child holding a dark toy should not have to know how long to hold.
    expect(classifyPress(20, false)).toBe('wake_up');
    expect(classifyPress(3000, false)).toBe('wake_up');
  });

  it('reads a short press as a press', () => {
    expect(classifyPress(200, true)).toBe('press');
    expect(classifyPress(LONG_PRESS_MS - 1, true)).toBe('press');
  });

  it('opens the menu on a long press', () => {
    expect(classifyPress(LONG_PRESS_MS, true)).toBe('menu');
    expect(classifyPress(VERY_LONG_PRESS_MS - 1, true)).toBe('menu');
  });

  // Goodbye keeps the longest hold: it is the destructive one, so it should
  // take deliberate effort to reach past the menu rather than being the thing
  // you hit by holding a moment too long.
  it('only says goodbye past the very-long threshold', () => {
    expect(classifyPress(VERY_LONG_PRESS_MS, true)).toBe('goodbye');
    expect(classifyPress(5_000, true)).toBe('goodbye');
  });
});

describe('throttlePress', () => {
  it('allows the first press', () => {
    expect(throttlePress([], 10_000).allowed).toBe(true);
  });

  it('debounces a second press inside three seconds', () => {
    const verdict = throttlePress([10_000], 11_000);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('debounced');
  });

  it('allows it again once the debounce has passed', () => {
    expect(throttlePress([10_000], 10_000 + DEBOUNCE_MS).allowed).toBe(true);
  });

  it('rate-limits a child mashing the button', () => {
    // Ten spaced-out presses are fine; the eleventh inside the minute is not.
    const history = Array.from({ length: MAX_PRESSES_PER_MINUTE }, (_, i) => 1_000 + i * 4_000);
    const verdict = throttlePress(history, 1_000 + MAX_PRESSES_PER_MINUTE * 4_000);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('rate_limited');
  });

  it('forgets presses older than the window', () => {
    const old = [1_000, 2_000, 3_000];
    expect(pruneHistory(old, 90_000)).toEqual([]);
    expect(throttlePress(old, 90_000).allowed).toBe(true);
  });
});
