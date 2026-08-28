/**
 * The OTA handshake: an HTTP POST that hands back the chat WebSocket address.
 *
 * Real hardware boots knowing only this one URL and asks it where to connect.
 * Doing the same here means the simulator follows the server's routing instead
 * of hardcoding an address that drifts out of date.
 */

import type { DeviceConfig } from '../config/device-config';

/**
 * How long to wait for the OTA endpoint before giving up on it.
 *
 * Not a nicety. `WsClient.connect()` awaits this before it opens anything, so
 * a URL that hangs rather than refusing wedges the whole simulator on "Bống
 * đang dậy…" with no error, no fallback and no way out but a reload — which is
 * exactly what a stale OTA address left in `localStorage` does. Real firmware
 * would time out and try the address it already knows; so does this now.
 *
 * Eight seconds: long enough for a cold serverless start on a bad connection,
 * short enough that a person watching a sleeping toy has not yet concluded the
 * thing is broken.
 */
export const OTA_TIMEOUT_MS = 8_000;

export interface OtaResult {
  wsUrl: string;
  token: string;
}

/** Shape of the OTA response we care about. The server sends more; we ignore it. */
interface OtaResponse {
  websocket?: { url?: string; token?: string };
}

/**
 * Body mimicking a real board's self-report.
 *
 * The server keys firmware rollout off these fields, so they have to be present
 * and well-formed even though a simulator never applies an update.
 */
function handshakeBody(config: DeviceConfig) {
  return {
    version: 2,
    uuid: config.macAddress,
    application: {
      name: 'round-badge-simulator',
      version: '1.0.0',
    },
    board: {
      type: 'round-badge-sim',
      mac: config.macAddress,
    },
  };
}

/**
 * Asks the OTA endpoint where to open the chat socket.
 *
 * Throws on any failure — network, non-2xx, a response missing the URL, or the
 * request outstaying `timeoutMs`. Callers are expected to catch and fall back
 * to the configured WebSocket URL, because a dead OTA endpoint should not stop
 * you testing the voice loop.
 *
 * `timeoutMs` is a parameter rather than a constant read inside because
 * `AbortSignal.timeout` runs on a native timer that fake clocks cannot move —
 * the only way to prove a hang actually ends is to hand the test a small one.
 */
export async function fetchChatEndpoint(
  config: DeviceConfig,
  signal?: AbortSignal,
  timeoutMs: number = OTA_TIMEOUT_MS,
): Promise<OtaResult> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(config.otaUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Device-Id': config.macAddress,
      'Client-Id': config.macAddress,
    },
    body: JSON.stringify(handshakeBody(config)),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  if (!response.ok) {
    throw new Error(`OTA handshake failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as OtaResponse;
  const wsUrl = data.websocket?.url;
  if (!wsUrl) {
    throw new Error('OTA handshake returned no websocket.url');
  }

  return { wsUrl, token: data.websocket?.token ?? '' };
}

/**
 * Appends the identity query string the gateway authenticates on.
 *
 * Both `device-id` and `device_id` go out: the gateway and the server behind it
 * disagree on the spelling, and sending both is cheaper than finding out which
 * one a given deployment reads.
 */
export function buildSocketUrl(baseUrl: string, config: DeviceConfig, token: string): string {
  const separator = baseUrl.includes('?') ? '&' : '?';
  const params = new URLSearchParams({
    'device-id': config.macAddress,
    device_id: config.macAddress,
    'client-id': config.macAddress,
  });
  if (token) params.set('token', token);
  return `${baseUrl}${separator}${params.toString()}`;
}
