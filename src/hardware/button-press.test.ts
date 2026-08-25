import { describe, expect, it } from 'vitest';
import {
  classifyPress,
  DEBOUNCE_MS,
  LONG_PRESS_MS,
  MAX_PRESSES_PER_MINUTE,
  pruneHistory,
  stepVolume,
  throttlePress,
  VOLUME_STEP,
} from './button-press';

describe('classifyPress', () => {
  it('wakes the badge however briefly it was pressed', () => {
    // A child holding a dark toy should not have to know how long to hold.
    expect(classifyPress(20, false)).toBe('wake_up');
    expect(classifyPress(3_000, false)).toBe('wake_up');
  });

  it('reads a short press as a press and a held one as goodbye', () => {
    expect(classifyPress(200, true)).toBe('press');
    expect(classifyPress(LONG_PRESS_MS - 1, true)).toBe('press');
    expect(classifyPress(LONG_PRESS_MS, true)).toBe('goodbye');
  });

  // Navigation moved to its own buttons. The middle hold tier this button once
  // carried existed only because there was nowhere else to put the menu.
  it('has no third tier', () => {
    expect(classifyPress(9_000, true)).toBe('goodbye');
  });
});

describe('stepVolume', () => {
  it('steps by the given delta', () => {
    expect(stepVolume(0.5, VOLUME_STEP)).toBeCloseTo(0.7);
    expect(stepVolume(0.5, -VOLUME_STEP)).toBeCloseTo(0.3);
  });

  it('clamps at both ends rather than wrapping', () => {
    expect(stepVolume(1, VOLUME_STEP)).toBe(1);
    expect(stepVolume(0, -VOLUME_STEP)).toBe(0);
  });

  // Repeated float addition drifts (0.1+0.2 = 0.30000000000000004), which would
  // show up as "30.000000000000004%" on the glass.
  it('does not accumulate float drift', () => {
    let v = 0;
    for (let i = 0; i < 5; i++) v = stepVolume(v, VOLUME_STEP);
    expect(v).toBe(1);
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
