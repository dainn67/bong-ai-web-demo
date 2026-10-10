/**
 * Pure TypeScript IMA-ADPCM (DVI ADPCM 16kHz mono) decoder for Web Audio.
 * Decodes device-native 4-bit IMA-ADPCM WAV files into Float32Array AudioBuffers
 * or standard PCM16 WAV buffers so they can play seamlessly in modern web browsers.
 */

const STEP_TABLE: readonly number[] = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
  11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
];

const INDEX_TABLE: readonly number[] = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

export interface WavInfo {
  formatTag: number;
  channels: number;
  sampleRate: number;
  blockAlign: number;
}

/**
 * Inspects a buffer to see if it is an IMA-ADPCM WAV file (Format tag 0x0011 = 17).
 */
export function isImaAdpcmWav(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 24) return false;
  // Check "RIFF" and "WAVE"
  if (
    bytes[0] !== 0x52 || // 'R'
    bytes[1] !== 0x49 || // 'I'
    bytes[2] !== 0x46 || // 'F'
    bytes[3] !== 0x46 || // 'F'
    bytes[8] !== 0x57 || // 'W'
    bytes[9] !== 0x41 || // 'A'
    bytes[10] !== 0x56 || // 'V'
    bytes[11] !== 0x45 // 'E'
  ) {
    return false;
  }

  // Scan chunks for 'fmt '
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const chunkId =
      String.fromCharCode(bytes[pos]) +
      String.fromCharCode(bytes[pos + 1]) +
      String.fromCharCode(bytes[pos + 2]) +
      String.fromCharCode(bytes[pos + 3]);
    const chunkSize = view.getUint32(pos + 4, true);

    if (chunkId === 'fmt ' && chunkSize >= 14) {
      const formatTag = view.getUint16(pos + 8, true);
      return formatTag === 0x0011; // 17 decimal = IMA-ADPCM
    }
    pos += 8 + chunkSize + (chunkSize & 1);
  }
  return false;
}

/**
 * Decodes raw IMA-ADPCM WAV bytes into an array of 16-bit PCM integer samples (-32768 to 32767).
 */
export function decodeImaAdpcmSamples(buffer: ArrayBuffer | Uint8Array): {
  samples: Int16Array;
  sampleRate: number;
} {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let pos = 12;
  let dataPos = -1;
  let dataLen = 0;
  let factSamples = 0;
  let sampleRate = 16000;
  let blockAlign = 256;

  while (pos + 8 <= bytes.length) {
    const chunkId =
      String.fromCharCode(bytes[pos]) +
      String.fromCharCode(bytes[pos + 1]) +
      String.fromCharCode(bytes[pos + 2]) +
      String.fromCharCode(bytes[pos + 3]);
    const chunkSize = view.getUint32(pos + 4, true);

    if (chunkId === 'fmt ' && chunkSize >= 16) {
      sampleRate = view.getUint32(pos + 12, true);
      blockAlign = view.getUint16(pos + 20, true) || 256;
    } else if (chunkId === 'fact' && chunkSize >= 4) {
      factSamples = view.getUint32(pos + 8, true);
    } else if (chunkId === 'data') {
      dataPos = pos + 8;
      dataLen = chunkSize;
      break;
    }
    pos += 8 + chunkSize + (chunkSize & 1);
  }

  if (dataPos === -1) {
    throw new Error('Invalid WAV: missing "data" chunk');
  }

  const end = Math.min(bytes.length, dataPos + dataLen);
  const rawSamples: number[] = [];
  let cur = dataPos;

  while (cur + 4 <= end) {
    const blockEnd = Math.min(cur + blockAlign, end);
    const predictor = view.getInt16(cur, true);
    const index = view.getUint8(cur + 2);
    rawSamples.push(predictor);

    const state: [number, number] = [predictor, index];

    for (let p = cur + 4; p < blockEnd; p++) {
      const b = view.getUint8(p);
      const nibble0 = b & 0x0f;
      const nibble1 = (b >> 4) & 0x0f;

      // Sample 1 (low nibble)
      let step = STEP_TABLE[state[1]];
      let delta = step >> 3;
      if (nibble0 & 1) delta += step >> 2;
      if (nibble0 & 2) delta += step >> 1;
      if (nibble0 & 4) delta += step;
      state[0] = nibble0 & 8 ? state[0] - delta : state[0] + delta;
      state[0] = Math.max(-32768, Math.min(32767, state[0]));
      state[1] = Math.max(0, Math.min(88, state[1] + INDEX_TABLE[nibble0]));
      rawSamples.push(state[0]);

      // Sample 2 (high nibble)
      step = STEP_TABLE[state[1]];
      delta = step >> 3;
      if (nibble1 & 1) delta += step >> 2;
      if (nibble1 & 2) delta += step >> 1;
      if (nibble1 & 4) delta += step;
      state[0] = nibble1 & 8 ? state[0] - delta : state[0] + delta;
      state[0] = Math.max(-32768, Math.min(32767, state[0]));
      state[1] = Math.max(0, Math.min(88, state[1] + INDEX_TABLE[nibble1]));
      rawSamples.push(state[0]);
    }
    cur += blockAlign;
  }

  const count = factSamples > 0 && factSamples < rawSamples.length ? factSamples : rawSamples.length;
  const result = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    result[i] = rawSamples[i];
  }

  return { samples: result, sampleRate };
}

/**
 * Creates a browser AudioBuffer directly from an IMA-ADPCM WAV buffer.
 * Synchronous and does not depend on browser decodeAudioData.
 */
export function decodeImaAdpcmToAudioBuffer(
  audioContext: AudioContext,
  buffer: ArrayBuffer | Uint8Array,
): AudioBuffer {
  const { samples, sampleRate } = decodeImaAdpcmSamples(buffer);
  const audioBuffer = audioContext.createBuffer(1, samples.length, sampleRate);
  const channelData = audioBuffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    channelData[i] = samples[i] / 32768.0;
  }
  return audioBuffer;
}
