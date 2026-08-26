/**
 * Reporting the badge's condition to the backend that the parent app reads.
 *
 * This is a second, separate connection: the chat WebSocket goes to xiaozhi,
 * but battery and faults land in the FastAPI database, which is where
 * `/devices/dashboard/list` — the parent's view of the toy — reads from. The
 * two never meet on the wire.
 */

import type { DeviceConfig } from '../config/device-config';

export interface TelemetryReading {
  battery_level: number;
  wifi_rssi: number;
  is_charging: boolean;
  firmware_version: string;
  uptime_seconds: number;
  error_code?: string;
  error_message?: string;
}

/**
 * Posts one reading.
 *
 * Throws on any failure so the caller can show it. Failing is expected and
 * survivable: the backend is often not running, and the badge should keep
 * talking regardless — losing telemetry costs the parent a stale battery
 * reading, not the child their conversation.
 */
export async function sendTelemetry(
  config: DeviceConfig,
  reading: TelemetryReading,
): Promise<void> {
  const base = config.apiUrl.replace(/\/+$/, '');
  const response = await fetch(
    `${base}/api/v1/devices/${encodeURIComponent(config.macAddress)}/telemetry`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reading),
    },
  );

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson && errJson.code) {
        detail = errJson.code;
      } else if (errJson && errJson.message) {
        detail = errJson.message;
      }
    } catch {}
    throw new Error(detail);
  }
}

/**
 * Tells the backend a button was pressed, and whether it wants to allow it.
 *
 * The device debounces on its own — firmware does — but the backend keeps its
 * own count, and the two disagreeing is exactly the kind of thing worth being
 * able to see. Returns null when there is no backend to ask.
 */
export async function reportButtonPress(
  config: DeviceConfig,
): Promise<{ allowed: boolean; reason?: string; message?: string } | null> {
  if (!config.apiUrl) return null;
  const base = config.apiUrl.replace(/\/+$/, '');
  const response = await fetch(
    `${base}/api/v1/devices/${encodeURIComponent(config.macAddress)}/fallback/button-press`,
    { method: 'POST' },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { data?: { allowed?: boolean; reason?: string; message?: string } };
  return {
    allowed: body.data?.allowed ?? true,
    reason: body.data?.reason,
    message: body.data?.message,
  };
}
