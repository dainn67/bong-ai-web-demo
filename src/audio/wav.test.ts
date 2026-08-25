import { describe, expect, it } from 'vitest';
import { concatPcm, floatToPcm16, pcm16ToWav } from './wav';

describe('pcm16ToWav', () => {
  it('prefixes a 44-byte header', async () => {
    const blob = pcm16ToWav(new Int16Array(100), 16_000);
    expect(blob.size).toBe(44 + 200);
    expect(blob.type).toBe('audio/wav');
  });

  it('writes a well-formed header', async () => {
    const view = new DataView(await pcm16ToWav(new Int16Array(8), 16_000).arrayBuffer());
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(
        ...Array.from({ length }, (_, i) => view.getUint8(offset + i)),
      );

    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(ascii(36, 4)).toBe('data');

    expect(view.getUint16(20, true)).toBe(1); // uncompressed PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000); // byte rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(16); // data length
  });

  // WAV is little-endian regardless of what the platform prefers, so the
  // samples are written by hand rather than copied out of the typed array.
  it('writes samples little-endian', async () => {
    const view = new DataView(await pcm16ToWav(Int16Array.from([0x0102]), 16_000).arrayBuffer());
    expect(view.getUint8(44)).toBe(0x02);
    expect(view.getUint8(45)).toBe(0x01);
  });
});

describe('concatPcm', () => {
  it('joins chunks in order', () => {
    expect([...concatPcm([Int16Array.from([1, 2]), Int16Array.from([3])])]).toEqual([1, 2, 3]);
  });

  it('handles nothing', () => {
    expect(concatPcm([]).length).toBe(0);
  });
});

describe('floatToPcm16', () => {
  it('scales the range', () => {
    expect(floatToPcm16(Float32Array.from([0]))[0]).toBe(0);
    expect(floatToPcm16(Float32Array.from([1]))[0]).toBe(32_767);
    expect(floatToPcm16(Float32Array.from([-1]))[0]).toBe(-32_768);
  });

  // Scaling both directions by 32768 would wrap the loudest positive sample all
  // the way to −32768 — a click at exactly the peak of a loud passage.
  it('does not wrap at full positive scale', () => {
    expect(floatToPcm16(Float32Array.from([0.9999999]))[0]).toBeGreaterThan(0);
  });

  it('clamps out-of-range input', () => {
    expect(floatToPcm16(Float32Array.from([9]))[0]).toBe(32_767);
    expect(floatToPcm16(Float32Array.from([-9]))[0]).toBe(-32_768);
  });
});
