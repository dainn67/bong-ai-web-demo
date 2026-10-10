import { describe, it, expect } from 'vitest';
import { isImaAdpcmWav, decodeImaAdpcmSamples } from './adpcm-decoder';

describe('adpcm-decoder', () => {
  it('identifies non-wav and pcm-wav correctly', () => {
    expect(isImaAdpcmWav(new Uint8Array([1, 2, 3]))).toBe(false);

    // Minimal PCM WAV header (fmt tag 1)
    const pcmWav = new Uint8Array(44);
    // "RIFF"
    pcmWav.set([0x52, 0x49, 0x46, 0x46], 0);
    // "WAVE"
    pcmWav.set([0x57, 0x41, 0x56, 0x45], 8);
    // "fmt "
    pcmWav.set([0x66, 0x6d, 0x74, 0x20], 12);
    // chunk size 16
    pcmWav[16] = 16;
    // format tag 1 (PCM)
    pcmWav[20] = 1;

    expect(isImaAdpcmWav(pcmWav)).toBe(false);
  });

  it('identifies IMA-ADPCM WAV (tag 17)', () => {
    const adpcmWav = new Uint8Array(44);
    adpcmWav.set([0x52, 0x49, 0x46, 0x46], 0);
    adpcmWav.set([0x57, 0x41, 0x56, 0x45], 8);
    adpcmWav.set([0x66, 0x6d, 0x74, 0x20], 12);
    adpcmWav[16] = 20; // chunk size
    adpcmWav[20] = 17; // 0x0011 (IMA-ADPCM)

    expect(isImaAdpcmWav(adpcmWav)).toBe(true);
  });

  it('decodes a single block of IMA-ADPCM data', () => {
    // Build a minimal IMA ADPCM WAV with 1 block
    const blockAlign = 256;
    const header = [
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // file length placeholder
      0x57, 0x41, 0x56, 0x45, // WAVE
      0x66, 0x6d, 0x74, 0x20, // fmt 
      20, 0, 0, 0,            // fmt chunk size
      0x11, 0x00,             // format tag 17 (IMA ADPCM)
      1, 0,                   // 1 channel
      0x80, 0x3e, 0, 0,       // 16000 sample rate
      0x00, 0x00, 0, 0,       // byte rate
      0x00, 0x01,             // block align 256
      4, 0,                   // bits per sample 4
      2, 0,                   // extra bytes
      0xf9, 0x01,             // samples per block 505
      0x64, 0x61, 0x74, 0x61, // data
      0x00, 0x01, 0, 0,       // data size (256)
    ];

    const buf = new Uint8Array(header.length + blockAlign);
    buf.set(header, 0);

    // Block header: predictor = 1000, index = 5, reserved = 0
    const blockOffset = header.length;
    buf[blockOffset] = 0xe8;
    buf[blockOffset + 1] = 0x03; // 1000
    buf[blockOffset + 2] = 5;    // index = 5
    buf[blockOffset + 3] = 0;

    // Remaining block bytes all 0
    const { samples, sampleRate } = decodeImaAdpcmSamples(buf);
    expect(sampleRate).toBe(16000);
    expect(samples.length).toBe(505);
    expect(samples[0]).toBe(1000);
  });
});
