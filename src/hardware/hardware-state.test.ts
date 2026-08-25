import { describe, expect, it } from 'vitest';
import { drainBattery, formatUptime, wifiBars, wifiQuality } from './hardware-state';

describe('drainBattery', () => {
  it('empties slowly on battery', () => {
    // An hour of use costs a real badge a noticeable but survivable amount.
    expect(drainBattery(100, false, 60 * 60_000)).toBe(64);
  });

  it('fills faster than it empties, the way a charger does', () => {
    expect(drainBattery(50, true, 10 * 60_000)).toBe(80);
  });

  it('never goes past either end', () => {
    expect(drainBattery(2, false, 60 * 60_000)).toBe(0);
    expect(drainBattery(98, true, 60 * 60_000)).toBe(100);
  });
});

describe('wifiQuality', () => {
  it('reads dBm in buckets a person can act on', () => {
    // Closer to zero is stronger, which is the part everyone gets backwards.
    expect(wifiQuality(-45)).toBe('tốt');
    expect(wifiQuality(-65)).toBe('khá');
    expect(wifiQuality(-80)).toBe('yếu');
    expect(wifiQuality(-95)).toBe('mất sóng');
  });

  it('draws no bars once the signal is gone', () => {
    expect(wifiBars(-50)).toBe(4);
    expect(wifiBars(-95)).toBe(0);
  });
});

describe('formatUptime', () => {
  it('drops seconds once it has been running for hours', () => {
    expect(formatUptime(8130)).toBe('2g 15p');
    expect(formatUptime(95)).toBe('1p 35s');
  });
});
