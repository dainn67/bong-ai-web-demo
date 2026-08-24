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
    throw new Error(`HTTP ${response.status}`);
  }
}
