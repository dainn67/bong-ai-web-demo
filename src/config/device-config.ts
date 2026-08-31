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
const STABLE_MAC_KEY = 'bong-device.stable-mac';

/**
 * Generates or retrieves a permanent MAC address unique to this browser/machine.
 * It is persisted across reloads and browser sessions so each computer acts as a dedicated stable device.
 */
function getPersistentMac(): string {
  try {
    const directMac = localStorage.getItem(STABLE_MAC_KEY);
    if (directMac && /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(directMac.trim())) {
      return directMac.trim().toLowerCase();
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DeviceConfig>;
      if (parsed.macAddress && /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(parsed.macAddress.trim())) {
        const savedMac = parsed.macAddress.trim().toLowerCase();
        localStorage.setItem(STABLE_MAC_KEY, savedMac);
        return savedMac;
      }
    }
  } catch {}

  // Generate a stable unicast MAC address (locally administered)
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  bytes[0] = (bytes[0] & 0xfe) | 0x02;
  const newMac = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(':').toLowerCase();
  try {
    localStorage.setItem(STABLE_MAC_KEY, newMac);
  } catch {}
  return newMac;
}

export const DEFAULT_CONFIG: DeviceConfig = {
  otaUrl: import.meta.env.VITE_OTA_URL ?? 'https://bong-ai-esp.bcserver.xyz/xiaozhi/ota/',
  fallbackWsUrl:
    import.meta.env.VITE_WS_URL ?? 'wss://bong-ai-esp.bcserver.xyz/xiaozhi/v1/',
  apiUrl: import.meta.env.VITE_API_URL ?? '',
  macAddress: getPersistentMac(),
  deviceName: 'round-badge',
  firmwareVersion: '1.0.0',
  sampleRate: 16000,
};

export function loadConfig(): DeviceConfig {
  const stableMac = getPersistentMac();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial: DeviceConfig = { ...DEFAULT_CONFIG, macAddress: stableMac };
      saveConfig(initial);
      return initial;
    }
    const parsed = JSON.parse(raw) as Partial<DeviceConfig>;
    const macAddress = (parsed.macAddress && parsed.macAddress.trim()) || stableMac;
    const cfg: DeviceConfig = { ...DEFAULT_CONFIG, ...parsed, macAddress };
    
    // Auto-migrate legacy 8085 port to 8185
    if (cfg.fallbackWsUrl && cfg.fallbackWsUrl.includes(':8085')) {
      cfg.fallbackWsUrl = cfg.fallbackWsUrl.replace(':8085', ':8185');
    }
    return cfg;
  } catch {
    return { ...DEFAULT_CONFIG, macAddress: stableMac };
  }
}

export function saveConfig(config: DeviceConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    if (config.macAddress) {
      localStorage.setItem(STABLE_MAC_KEY, config.macAddress.trim().toLowerCase());
    }
  } catch {
    // Private-browsing mode blocks writes.
  }
}

