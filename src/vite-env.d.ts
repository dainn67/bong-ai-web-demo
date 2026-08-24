/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** OTA handshake endpoint, e.g. http://localhost:8003/xiaozhi/ota/ */
  readonly VITE_OTA_URL?: string;
  /** WebSocket URL used when the OTA handshake is unavailable. */
  readonly VITE_WS_URL?: string;
  /** FastAPI base URL for telemetry, e.g. http://localhost:8002. Blank disables it. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
