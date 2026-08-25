/**
 * PCM16 → WAV.
 *
 * The STT service takes a file upload, not a raw buffer, so a turn's worth of
 * samples needs a 44-byte header on the front before it can be posted.
 */

/** Wraps mono PCM16 samples in a WAV container. */
export function pcm16ToWav(pcm: Int16Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const channels = 1;
  const dataBytes = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // format 1 = uncompressed PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true); // byte rate
  view.setUint16(32, channels * bytesPerSample, true); // block align
  view.setUint16(34, 8 * bytesPerSample, true);

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  // Little-endian explicitly rather than copying the typed array's bytes: the
  // platform's own endianness is not guaranteed and WAV's is.
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Concatenates the chunks captured over one turn. */
export function concatPcm(chunks: Int16Array[]): Int16Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;

  const out = new Int16Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Float samples in −1..1 to PCM16, clamped rather than wrapped. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    // Asymmetric on purpose: PCM16 runs −32768..32767, and scaling both
    // directions by 32768 would wrap the loudest positive sample to silence.
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}
