import { describe, it, expect } from 'vitest';
import {
  isBongEncrypted,
  parseBongHeader,
  encryptBongAsset,
  decryptBongAsset,
  SimulatedDeviceSecurity,
  uint8ArrayToBase64,
} from './crypto-client';

describe('v3 client crypto and envelope decryption', () => {
  // Generate random 32-byte key
  const sampleKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) sampleKey[i] = i + 1;
  const sampleKeyBase64 = uint8ArrayToBase64(sampleKey);

  it('detects plain data vs BONG encrypted envelope', async () => {
    const plain = new TextEncoder().encode('Hello Plaintext Audio');
    expect(isBongEncrypted(plain)).toBe(false);

    const encrypted = await encryptBongAsset(plain, sampleKey, 1);
    expect(isBongEncrypted(encrypted)).toBe(true);
  });

  it('parses header fields accurately', async () => {
    const plain = new TextEncoder().encode('Test Data');
    const encrypted = await encryptBongAsset(plain, sampleKey, 5);
    const header = parseBongHeader(encrypted);

    expect(header.keyVersion).toBe(5);
    expect(header.algId).toBe(1); // AES-256-GCM
    expect(header.nonce.length).toBe(12);
    expect(header.authTag.length).toBe(16);
  });

  it('encrypts and decrypts payload faithfully', async () => {
    const originalText = 'Bống AI: Kịch bản và âm thanh Opus đã được mã hóa!';
    const plainBytes = new TextEncoder().encode(originalText);

    const encrypted = await encryptBongAsset(plainBytes, sampleKeyBase64, 2);
    const decryptedBuffer = await decryptBongAsset(encrypted, sampleKeyBase64);
    const decryptedText = new TextDecoder().decode(decryptedBuffer);

    expect(decryptedText).toBe(originalText);
  });

  it('rejects tampered ciphertext due to GCM authentication tag check', async () => {
    const plainBytes = new TextEncoder().encode('Sensitive child script');
    const encrypted = await encryptBongAsset(plainBytes, sampleKey, 1);

    // Tamper with one byte in the payload
    const tampered = new Uint8Array(encrypted);
    tampered[tampered.length - 1] ^= 0xff;

    await expect(decryptBongAsset(tampered, sampleKey)).rejects.toThrow(
      /Decryption failed/i
    );
  });

  it('fails decryption when provided wrong key', async () => {
    const plainBytes = new TextEncoder().encode('Original Audio');
    const encrypted = await encryptBongAsset(plainBytes, sampleKey, 1);

    const wrongKey = new Uint8Array(32);
    wrongKey.fill(0xaa);

    await expect(decryptBongAsset(encrypted, wrongKey)).rejects.toThrow(
      /Decryption failed/i
    );
  });

  it('simulates eFuse KEY_0 generation and NVS storage', () => {
    const key0Hex = SimulatedDeviceSecurity.getDeviceRootKey0Hex();
    expect(key0Hex).toHaveLength(64);

    SimulatedDeviceSecurity.saveWrappedContentKey('KEY_1', 1, sampleKeyBase64);
    const stored = SimulatedDeviceSecurity.getStoredContentKey();

    expect(stored).not.toBeNull();
    expect(stored?.alias).toBe('KEY_1');
    expect(stored?.version).toBe(1);
    expect(stored?.rawKeyBase64).toBe(sampleKeyBase64);
  });
});
