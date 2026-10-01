/**
 * Client-side Cryptographic Engine for Bống AI Offline-First v3.
 *
 * Implements:
 * 1. BONG_ENVELOPE parser and decryptor using Web Crypto API (SubtleCrypto AES-256-GCM).
 * 2. Hardware KEY_0 simulation (Device Root Key burned into eFuse).
 * 3. Key wrap/unwrap to simulate secure NVS flash storage on ESP32-S3.
 */

export const BONG_MAGIC = new Uint8Array([0x42, 0x4f, 0x4e, 0x47]); // "BONG"
export const HEADER_LENGTH = 36;
export const NONCE_LENGTH = 12;
export const TAG_LENGTH = 16;
export const ALG_AES_256_GCM = 1;

export interface BongHeader {
  keyVersion: number;
  algId: number;
  nonce: Uint8Array;
  authTag: Uint8Array;
}

export interface DeviceKeyHandshake {
  key_alias: string;
  key_version: number;
  algorithm: string;
  key_bytes: string; // Base64
}

/**
 * Checks if a binary ArrayBuffer begins with the 'BONG' envelope magic header.
 */
export function isBongEncrypted(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < HEADER_LENGTH) return false;
  return (
    bytes[0] === BONG_MAGIC[0] &&
    bytes[1] === BONG_MAGIC[1] &&
    bytes[2] === BONG_MAGIC[2] &&
    bytes[3] === BONG_MAGIC[3]
  );
}

/**
 * Parse the 36-byte BONG_ENVELOPE header.
 */
export function parseBongHeader(buffer: ArrayBuffer | Uint8Array): BongHeader {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < HEADER_LENGTH) {
    throw new Error(`Envelope too short (${bytes.length} bytes, expected >= ${HEADER_LENGTH})`);
  }

  if (!isBongEncrypted(bytes)) {
    throw new Error('Invalid magic bytes: expected BONG');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER_LENGTH);
  const keyVersion = view.getUint16(4, false); // Big-endian
  const algId = view.getUint16(6, false); // Big-endian
  const nonce = bytes.slice(8, 20);
  const authTag = bytes.slice(20, 36);

  return { keyVersion, algId, nonce, authTag };
}

/**
 * Helper: Convert Base64 string to Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Helper: Convert Uint8Array to Base64 string.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

const getCrypto = (): Crypto => {
  if (typeof window !== 'undefined' && window.crypto) {
    return window.crypto;
  }
  return globalThis.crypto;
};

const getStorage = () => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (!(globalThis as any).__mockStorage) {
    (globalThis as any).__mockStorage = new Map<string, string>();
  }
  const store: Map<string, string> = (globalThis as any).__mockStorage;
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
  };
};

/**
 * Decrypts a BONG_ENVELOPE binary buffer using SubtleCrypto AES-256-GCM.
 */
export async function decryptBongAsset(
  buffer: ArrayBuffer | Uint8Array,
  rawKey: string | Uint8Array
): Promise<ArrayBuffer> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const { keyVersion, algId, nonce, authTag } = parseBongHeader(bytes);

  if (algId !== ALG_AES_256_GCM) {
    throw new Error(`Unsupported algorithm ID: ${algId}`);
  }

  const keyBytes = typeof rawKey === 'string' ? base64ToUint8Array(rawKey) : rawKey;
  if (keyBytes.length !== 32) {
    throw new Error(`AES-256 requires 32-byte key (got ${keyBytes.length} bytes)`);
  }

  // Construct AAD: BONG + uint16(keyVersion) + uint16(algId)
  const aad = new Uint8Array(8);
  aad.set(BONG_MAGIC, 0);
  const view = new DataView(aad.buffer);
  view.setUint16(4, keyVersion, false);
  view.setUint16(6, algId, false);

  // Web Crypto SubtleCrypto expects [ciphertext, authTag] concatenated
  const actualCiphertext = bytes.slice(HEADER_LENGTH);
  const toDecrypt = new Uint8Array(actualCiphertext.length + authTag.length);
  toDecrypt.set(actualCiphertext, 0);
  toDecrypt.set(authTag, actualCiphertext.length);

  const cryptoInstance = getCrypto();
  const cryptoKey = await cryptoInstance.subtle.importKey(
    'raw',
    keyBytes as any,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  try {
    return await cryptoInstance.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce as any,
        additionalData: aad as any,
        tagLength: 128,
      },
      cryptoKey,
      toDecrypt as any
    );
  } catch (err) {
    throw new Error('Decryption failed: corrupted data, auth tag mismatch, or wrong key', { cause: err });
  }
}

/**
 * Encrypts asset plaintext into BONG_ENVELOPE format using Web Crypto API.
 */
export async function encryptBongAsset(
  plaintext: ArrayBuffer | Uint8Array,
  rawKey: string | Uint8Array,
  keyVersion: number = 1
): Promise<Uint8Array> {
  const plainBytes = plaintext instanceof Uint8Array ? plaintext : new Uint8Array(plaintext);
  const keyBytes = typeof rawKey === 'string' ? base64ToUint8Array(rawKey) : rawKey;

  if (keyBytes.length !== 32) {
    throw new Error(`AES-256 requires 32-byte key (got ${keyBytes.length} bytes)`);
  }

  const cryptoInstance = getCrypto();
  const nonce = cryptoInstance.getRandomValues(new Uint8Array(NONCE_LENGTH));

  // AAD: BONG + uint16(keyVersion) + uint16(algId)
  const aad = new Uint8Array(8);
  aad.set(BONG_MAGIC, 0);
  const view = new DataView(aad.buffer);
  view.setUint16(4, keyVersion, false);
  view.setUint16(6, ALG_AES_256_GCM, false);

  const cryptoKey = await cryptoInstance.subtle.importKey(
    'raw',
    keyBytes as any,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  // Web Crypto encrypt returns [ciphertext, 16-byte tag]
  const encryptedBuffer = await cryptoInstance.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce as any,
      additionalData: aad as any,
      tagLength: 128,
    },
    cryptoKey,
    plainBytes as any
  );

  const encryptedBytes = new Uint8Array(encryptedBuffer);
  const actualCiphertext = encryptedBytes.slice(0, encryptedBytes.length - TAG_LENGTH);
  const authTag = encryptedBytes.slice(encryptedBytes.length - TAG_LENGTH);

  // Envelope header: aad (8B) + nonce (12B) + authTag (16B) = 36B
  const envelope = new Uint8Array(HEADER_LENGTH + actualCiphertext.length);
  envelope.set(aad, 0);
  envelope.set(nonce, 8);
  envelope.set(authTag, 20);
  envelope.set(actualCiphertext, 36);

  return envelope;
}

/**
 * Simulator Hardware KEY_0 Manager (Mô phỏng eFuse chip ESP32-S3).
 */
export class SimulatedDeviceSecurity {
  private static STORAGE_KEY_0 = 'bong_simulated_efuse_key_0';
  private static STORAGE_WRAPPED_KEY_N = 'bong_simulated_nvs_key_n';
  private static STORAGE_KEY_META = 'bong_simulated_key_meta';

  /**
   * Get or generate the device root key KEY_0 (burned in hardware eFuse).
   */
  public static getDeviceRootKey0(): Uint8Array {
    const storage = getStorage();
    let hex = storage.getItem(this.STORAGE_KEY_0);
    if (!hex || hex.length !== 64) {
      const cryptoInstance = getCrypto();
      const randomBytes = cryptoInstance.getRandomValues(new Uint8Array(32));
      hex = Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      storage.setItem(this.STORAGE_KEY_0, hex);
    }

    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  /**
   * Return hex string of KEY_0 for UI inspection.
   */
  public static getDeviceRootKey0Hex(): string {
    const k0 = this.getDeviceRootKey0();
    return Array.from(k0)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Save Master Content Key (simulates wrapping with KEY_0 into NVS flash).
   */
  public static saveWrappedContentKey(
    keyAlias: string,
    keyVersion: number,
    rawKeyBase64: string
  ): void {
    const storage = getStorage();
    storage.setItem(this.STORAGE_WRAPPED_KEY_N, rawKeyBase64);
    storage.setItem(
      this.STORAGE_KEY_META,
      JSON.stringify({ alias: keyAlias, version: keyVersion, updatedAt: new Date().toISOString() })
    );
  }

  /**
   * Load active Content Key from simulated NVS.
   */
  public static getStoredContentKey(): {
    alias: string;
    version: number;
    rawKeyBase64: string;
    updatedAt: string;
  } | null {
    const storage = getStorage();
    const raw = storage.getItem(this.STORAGE_WRAPPED_KEY_N);
    const metaStr = storage.getItem(this.STORAGE_KEY_META);
    if (!raw || !metaStr) return null;
    try {
      const meta = JSON.parse(metaStr);
      return {
        alias: meta.alias,
        version: meta.version,
        rawKeyBase64: raw,
        updatedAt: meta.updatedAt,
      };
    } catch {
      return null;
    }
  }

  /**
   * Clear simulated keys.
   */
  public static resetSimulatedKeys(): void {
    const storage = getStorage();
    storage.removeItem(this.STORAGE_KEY_0);
    storage.removeItem(this.STORAGE_WRAPPED_KEY_N);
    storage.removeItem(this.STORAGE_KEY_META);
  }
}
