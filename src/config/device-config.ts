/**
 * Which backend the simulator talks to, and who it claims to be.
 *
 * Everything here is editable at runtime from the connection panel and kept in
 * localStorage, so you can point the same build at a laptop or at production
 * without a rebuild. Env vars only supply the defaults.
 */

export interface DeviceConfig {
  /** OTA handshake endpoint. Returns the real WebSocket URL and a token. */
  otaUrl: string;
  /**
   * WebSocket URL used when the OTA handshake is skipped or fails.
   *
   * Real hardware always goes through OTA. This exists because a simulator is
   * often pointed at a server whose OTA endpoint is down or not yet deployed.
   */
  fallbackWsUrl: string;
  /**
   * Where telemetry goes — the FastAPI backend, not xiaozhi.
   *
   * A separate address because it is a separate system: the chat socket talks
   * to xiaozhi, while battery and faults land in the database the parent app
   * reads. Blank turns reporting off, which is the right default when the
   * backend is usually not running next to you.
   */
  apiUrl: string;
  /** Stands in for the badge's MAC address. Identifies the device to the backend. */
  macAddress: string;
  deviceName: string;
  /** Reported in telemetry, and what the OTA endpoint compares against. */
  firmwareVersion: string;
  /**
   * Governs both directions: the server echoes this back and encodes its TTS at
   * it. Stay silent and it assumes 24000. The badge itself uses 16000, which is
   * also what the speech recogniser behind it wants.
   */
  sampleRate: number;
}

const STORAGE_KEY = 'device-simulator.config';

/**
 * Ships a random MAC per browser profile.
 *
 * Two simulators sharing a MAC get treated as one device by the backend and
 * fight over the session, which looks like random disconnects. Generating one
 * per install makes that impossible to hit by accident.
 */
function randomMac(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  // Clear the multicast bit and set the locally-administered bit, so the
  // address is a valid unicast MAC that can't collide with real hardware.
  bytes[0] = (bytes[0] & 0xfe) | 0x02;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(':');
}

export const DEFAULT_CONFIG: DeviceConfig = {
  otaUrl: import.meta.env.VITE_OTA_URL ?? 'https://bong-ai-esp.bcserver.xyz/xiaozhi/ota/',
  fallbackWsUrl:
    import.meta.env.VITE_WS_URL ?? 'wss://bong-ai-esp.bcserver.xyz/xiaozhi/v1/',
  apiUrl: import.meta.env.VITE_API_URL ?? '',
  macAddress: randomMac(),
  deviceName: 'round-badge',
  firmwareVersion: '1.0.0',
  sampleRate: 16000,
};

export function loadConfig(): DeviceConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    // Spread over the defaults so a config saved by an older build, missing
    // keys added since, still loads instead of crashing the app on boot.
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<DeviceConfig>) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: DeviceConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Private-browsing mode blocks writes. Losing the settings is survivable;
    // failing to boot the simulator is not.
  }
}
