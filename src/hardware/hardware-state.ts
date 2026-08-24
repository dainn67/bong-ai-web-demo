/**
 * The badge's physical condition: battery, radio, faults.
 *
 * Pure — no timers, no fetch, no React. The rules for how a battery drains and
 * what counts as a weak signal are the kind of thing you want to check in a
 * test rather than by leaving a browser open for an hour.
 */

/** Percent per minute while running on battery. A real badge lasts a few hours. */
const DRAIN_PER_MINUTE = 0.6;

/** Percent per minute on the charger. Faster than it empties, as chargers are. */
const CHARGE_PER_MINUTE = 3;

/** Below this the badge is in trouble: the parent app shows red, and it will nap soon. */
export const LOW_BATTERY = 15;

/**
 * Advances the battery over a stretch of time.
 *
 * Takes elapsed milliseconds rather than reading a clock, so a test can age the
 * battery an hour without waiting one.
 */
export function drainBattery(level: number, charging: boolean, elapsedMs: number): number {
  const minutes = elapsedMs / 60_000;
  const delta = charging ? CHARGE_PER_MINUTE * minutes : -DRAIN_PER_MINUTE * minutes;
  return clampBattery(level + delta);
}

export function clampBattery(level: number): number {
  return Math.max(0, Math.min(100, Math.round(level)));
}

export type WifiQuality = 'tốt' | 'khá' | 'yếu' | 'mất sóng';

/**
 * Signal strength, in the buckets a person thinks in.
 *
 * dBm is negative and closer to zero is stronger, which trips up everyone
 * reading it for the first time — hence the named buckets rather than a number
 * on its own.
 */
export function wifiQuality(rssi: number): WifiQuality {
  if (rssi >= -60) return 'tốt';
  if (rssi >= -70) return 'khá';
  if (rssi >= -85) return 'yếu';
  return 'mất sóng';
}

/** Bars to draw, 0–4. */
export function wifiBars(rssi: number): number {
  if (rssi >= -55) return 4;
  if (rssi >= -65) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -85) return 1;
  return 0;
}

export interface DeviceFault {
  /** Goes out as `error_code`; the backend logs it and the parent app can show it. */
  code: string;
  label: string;
}

/**
 * Faults worth pretending to have.
 *
 * Nothing else in the stack can produce these — the backend logs `error_code`
 * and has no way to receive one until a device sends it, so this is the only
 * way to see what a broken badge looks like from the parent's side.
 */
export const DEVICE_FAULTS: DeviceFault[] = [
  { code: 'MIC_FAILURE', label: 'Micro hỏng' },
  { code: 'SPEAKER_FAILURE', label: 'Loa hỏng' },
  { code: 'WIFI_LOST', label: 'Mất kết nối WiFi' },
  { code: 'STORAGE_FULL', label: 'Bộ nhớ đầy' },
  { code: 'OVERHEAT', label: 'Quá nhiệt' },
];

/** Uptime as `2g 14p`, which is how long it has been since the badge booted. */
export function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}g ${minutes}p`;
  return `${minutes}p ${seconds % 60}s`;
}
