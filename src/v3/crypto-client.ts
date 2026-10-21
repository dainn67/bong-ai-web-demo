/**
 * WebCrypto AES-256-GCM + RFC 3394 AES-KW Client for Offline-First Script Engine v3.
 *
 * Implements the 24-byte `BONG` binary envelope specification:
 * - Offset 0..3 (4B): Magic `"BONG"` (0x42, 0x4F, 0x4E, 0x47)
 * - Offset 4..5 (2B): `key_version` (uint16 little-endian)
 * - Offset 6..7 (2B): `alg` (uint16 little-endian, 1 = AES-256-GCM)
 * - Offset 8..19 (12B): `nonce` (96-bit IV)
 * - Offset 20..23 (4B): `plain_size` (uint32 little-endian)
 * - Offset 24..(N-16): `ciphertext`
 * - Offset (N-16)..N (16B): `auth_tag` (128-bit GCM authentication tag)
 *
 * Additional Authenticated Data (AAD) = first 8 bytes of header (`magic + key_version + alg`).
 *
 * Security rule (Phase 3):
 * Unwrapped `K_content` is held ONLY in volatile memory (`activeContentKeyBytes`)
 * and is never serialized in plaintext to `localStorage`.
 */

const BONG_MAGIC = new Uint8Array([0x42, 0x4f, 0x4e, 0x47]); // "BONG"
const HEADER_SIZE = 24;
const TAG_SIZE = 16;
const ALG_AES_256_GCM = 1;

export interface BongHeaderInfo {
  magic: string;
  keyVersion: number;
  alg: number;
  algId: number;
  nonce: Uint8Array;
  nonceHex: string;
  plainSize: number;
  authTag: Uint8Array;
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const binString = atob(b64);
  const bytes = new Uint8Array(binString.length);
  for (let i = 0; i < binString.length; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binString = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binString += String.fromCharCode(bytes[i]);
  }
  return btoa(binString);
}

export function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
    throw new Error('Invalid hex string');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Unwrap an 80-hex-character (40-byte) RFC 3394 AES-KW wrapped content key
 * using the 64-hex-character (32-byte) per-device key `kDevHex`.
 */
export async function unwrapContentKeyHex(
  wrappedHex: string,
  kDevHex: string
): Promise<Uint8Array> {
  const wrappedBytes = hexToUint8Array(wrappedHex);
  if (wrappedBytes.byteLength !== 40) {
    throw new Error(`Invalid AES-KW wrapped key length: ${wrappedBytes.byteLength} (expected 40 bytes / 80 hex chars)`);
  }
  const kekBytes = hexToUint8Array(kDevHex);
  if (kekBytes.byteLength !== 32) {
    throw new Error(`Invalid k_dev length: ${kekBytes.byteLength} (expected 32 bytes / 64 hex chars)`);
  }

  const kek = await crypto.subtle.importKey(
    'raw',
    kekBytes.buffer.slice(kekBytes.byteOffset, kekBytes.byteOffset + kekBytes.byteLength) as ArrayBuffer,
    { name: 'AES-KW' },
    false,
    ['unwrapKey']
  );

  const unwrappedCryptoKey = await crypto.subtle.unwrapKey(
    'raw',
    wrappedBytes.buffer.slice(wrappedBytes.byteOffset, wrappedBytes.byteOffset + wrappedBytes.byteLength) as ArrayBuffer,
    kek,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const rawBuf = await crypto.subtle.exportKey('raw', unwrappedCryptoKey);
  return new Uint8Array(rawBuf);
}

/**
 * Check if a binary buffer starts with the 4-byte `BONG` magic header.
 */
export function isBongEncrypted(data: Uint8Array | ArrayBuffer): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < HEADER_SIZE + TAG_SIZE) {
    return false;
  }
  return (
    bytes[0] === BONG_MAGIC[0] &&
    bytes[1] === BONG_MAGIC[1] &&
    bytes[2] === BONG_MAGIC[2] &&
    bytes[3] === BONG_MAGIC[3]
  );
}

/**
 * Parse the 24-byte `BONG` header without decrypting.
 */
export function parseBongHeader(data: Uint8Array | ArrayBuffer): BongHeaderInfo {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isBongEncrypted(bytes)) {
    throw new Error('Invalid BONG magic header or file too short');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keyVersion = view.getUint16(4, true);
  const alg = view.getUint16(6, true);
  const nonceBytes = bytes.slice(8, 20);
  const plainSize = view.getUint32(20, true);
  const authTag = bytes.slice(bytes.byteLength - TAG_SIZE);

  return {
    magic: 'BONG',
    keyVersion,
    alg,
    algId: alg,
    nonce: nonceBytes,
    nonceHex: uint8ArrayToHex(nonceBytes),
    plainSize,
    authTag,
  };
}

/**
 * Decrypt a `BONG` encrypted binary buffer using WebCrypto AES-256-GCM.
 */
export async function decryptBongAsset(
  encryptedData: Uint8Array | ArrayBuffer,
  rawKeyBase64OrBytes: string | Uint8Array
): Promise<ArrayBuffer> {
  const bytes =
    encryptedData instanceof Uint8Array
      ? encryptedData
      : new Uint8Array(encryptedData);

  const header = parseBongHeader(bytes);
  if (header.alg !== ALG_AES_256_GCM) {
    throw new Error(`Unsupported BONG encryption algorithm: ${header.alg}`);
  }

  const keyBytes =
    typeof rawKeyBase64OrBytes === 'string'
      ? base64ToUint8Array(rawKeyBase64OrBytes)
      : rawKeyBase64OrBytes;

  if (keyBytes.byteLength !== 32) {
    throw new Error(`Invalid AES-256 key length: ${keyBytes.byteLength} bytes (expected 32)`);
  }

  const aad = bytes.slice(0, 8);
  const nonce = bytes.slice(8, 20);
  const ciphertextWithTag = bytes.slice(HEADER_SIZE);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  let decryptedBuffer: ArrayBuffer;
  try {
    decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        additionalData: aad,
        tagLength: 128,
      },
      cryptoKey,
      ciphertextWithTag
    );
  } catch (err: any) {
    throw new Error(`Decryption failed: ${err?.message || err}`);
  }

  const plaintext = new Uint8Array(decryptedBuffer);
  if (plaintext.byteLength !== header.plainSize) {
    throw new Error(
      `Decrypted size mismatch: got ${plaintext.byteLength}, header expected ${header.plainSize}`
    );
  }

  return decryptedBuffer;
}

/**
 * Encrypt plaintext bytes into a 24-byte `BONG` envelope using WebCrypto AES-256-GCM.
 */
export async function encryptBongAsset(
  plainData: Uint8Array | ArrayBuffer,
  rawKeyBase64OrBytes: string | Uint8Array,
  keyVersion = 1
): Promise<Uint8Array> {
  const plainBytes =
    plainData instanceof Uint8Array ? plainData : new Uint8Array(plainData);

  const keyBytes =
    typeof rawKeyBase64OrBytes === 'string'
      ? base64ToUint8Array(rawKeyBase64OrBytes)
      : rawKeyBase64OrBytes;

  if (keyBytes.byteLength !== 32) {
    throw new Error(`Invalid AES-256 key length: ${keyBytes.byteLength} bytes (expected 32)`);
  }

  const nonce = crypto.getRandomValues(new Uint8Array(12));

  const header = new Uint8Array(HEADER_SIZE);
  header.set(BONG_MAGIC, 0);
  const view = new DataView(header.buffer);
  view.setUint16(4, keyVersion, true);
  view.setUint16(6, ALG_AES_256_GCM, true);
  header.set(nonce, 8);
  view.setUint32(20, plainBytes.byteLength, true);

  const aad = header.slice(0, 8);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: aad,
      tagLength: 128,
    },
    cryptoKey,
    plainBytes.buffer.slice(plainBytes.byteOffset, plainBytes.byteOffset + plainBytes.byteLength) as ArrayBuffer
  );

  const cipherWithTag = new Uint8Array(cipherBuffer);
  const envelope = new Uint8Array(HEADER_SIZE + cipherWithTag.byteLength);
  envelope.set(header, 0);
  envelope.set(cipherWithTag, HEADER_SIZE);

  return envelope;
}

const STORAGE_KEY_0 = 'bong_v3_sim_key_0_efuse';
const STORAGE_WRAPPED_KEY_META = 'bong_v3_sim_wrapped_key_meta';
const LEGACY_STORAGE_WRAPPED_KEY_N = 'bong_v3_sim_wrapped_key_n';

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * Pure synchronous SHA-256 hex digest (used for deterministic dev k_dev = sha256("dev_secret_" + deviceId)).
 */
export function sha256HexSync(asciiOrUtf8: string): string {
  const msg = new TextEncoder().encode(asciiOrUtf8);
  const bitLen = msg.length * 8;
  const padLen = ((msg.length + 9 + 63) & ~63);
  const buf = new Uint8Array(padLen);
  buf.set(msg, 0);
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padLen - 4, bitLen >>> 0, false);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

export class SimulatedDeviceSecurity {
  private static activeContentKeyBytes: Uint8Array | null = null;
  private static customRootKey0Hex: string | null = null;
  private static activeMeta: {
    alias: string;
    version: number;
    updatedAt: string;
  } | null = null;

  /**
   * Get or Provision `KEY_0` (`k_dev` simulated eFuse hardware key, 64 hex chars = 32 bytes).
   * Defaults to deterministic dev derivation `sha256("dev_secret_" + deviceId)` matching backend `security.py`.
   */
  static getDeviceRootKey0Hex(deviceId = 'simulator_v3_dev'): string {
    if (this.customRootKey0Hex && this.customRootKey0Hex.length === 64) {
      return this.customRootKey0Hex;
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY_0);
      if (stored && stored.length === 64) {
        return stored;
      }
    } catch {
      // ignore storage errors
    }
    return sha256HexSync(`dev_secret_${deviceId}`);
  }

  /**
   * Explicitly set `k_dev` (64 hex chars) for deterministic testing or paired device simulation.
   */
  static setDeviceRootKey0Hex(kDevHex: string): void {
    const clean = kDevHex.trim().toLowerCase();
    if (clean.length !== 64 || !/^[0-9a-f]{64}$/.test(clean)) {
      throw new Error('k_dev must be 64 hex characters');
    }
    this.customRootKey0Hex = clean;
    try {
      localStorage.setItem(STORAGE_KEY_0, clean);
    } catch {
      // ignore storage errors
    }
  }

  /**
   * Unwrap an 80-hex RFC 3394 `keys.content_key` from `/api/v1/device/manifest?caps=bong`
   * and hold the unwrapped 32-byte `K_content` in volatile memory only.
   */
  static async unwrapAndStoreManifestKey(
    wrappedKeyHex: string,
    keyVersion = 1,
    keyAlias = `KEY_${keyVersion}`
  ): Promise<Uint8Array> {
    const kDevHex = this.getDeviceRootKey0Hex();
    const unwrapped = await unwrapContentKeyHex(wrappedKeyHex, kDevHex);
    this.activeContentKeyBytes = unwrapped;
    this.activeMeta = {
      alias: keyAlias,
      version: keyVersion,
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.removeItem(LEGACY_STORAGE_WRAPPED_KEY_N);
      localStorage.setItem(
        STORAGE_WRAPPED_KEY_META,
        JSON.stringify({
          alias: keyAlias,
          version: keyVersion,
          wrappedKeyHex,
          updatedAt: this.activeMeta.updatedAt,
        })
      );
    } catch {
      // ignore storage errors
    }
    return unwrapped;
  }

  /**
   * Save a content key in volatile memory only (never persists raw key bytes to localStorage).
   */
  static saveWrappedContentKey(alias: string, version: number, rawKeyBase64: string): void {
    this.activeContentKeyBytes = base64ToUint8Array(rawKeyBase64);
    this.activeMeta = {
      alias,
      version,
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.removeItem(LEGACY_STORAGE_WRAPPED_KEY_N);
    } catch {
      // ignore
    }
  }

  static getActiveContentKeyBytes(): Uint8Array | null {
    return this.activeContentKeyBytes ? new Uint8Array(this.activeContentKeyBytes) : null;
  }

  static getActiveContentKeyBase64(): string | null {
    return this.activeContentKeyBytes ? uint8ArrayToBase64(this.activeContentKeyBytes) : null;
  }

  static getStoredContentKey(): {
    alias: string;
    version: number;
    rawKeyBase64: string;
    updatedAt: string;
  } | null {
    if (!this.activeContentKeyBytes || !this.activeMeta) {
      return null;
    }
    return {
      alias: this.activeMeta.alias,
      version: this.activeMeta.version,
      rawKeyBase64: uint8ArrayToBase64(this.activeContentKeyBytes),
      updatedAt: this.activeMeta.updatedAt,
    };
  }

  static resetSimulatedKeys(): void {
    this.activeContentKeyBytes = null;
    this.activeMeta = null;
    try {
      localStorage.removeItem(STORAGE_KEY_0);
      localStorage.removeItem(STORAGE_WRAPPED_KEY_META);
      localStorage.removeItem(LEGACY_STORAGE_WRAPPED_KEY_N);
    } catch {
      // ignore
    }
  }
}
