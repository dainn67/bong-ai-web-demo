/**
 * The one place that knows the shape of an audio frame.
 *
 * Both directions are governed by a single number: the `sample_rate` we declare
 * in the handshake. The server echoes it back and encodes its TTS at it, so a
 * decoder or encoder configured from anything else is configured wrong. Every
 * value below is derived from it rather than written down twice.
 */

/** Frame length the badge uses, in milliseconds. The server reports `frame_duration: 60`. */
export const FRAME_MS = 60;

/** WebCodecs counts time in microseconds. */
export const FRAME_DURATION_US = FRAME_MS * 1000;

/** Samples in one frame at a given rate — 960 at 16 kHz. */
export function frameSize(sampleRate: number): number {
  return Math.round((sampleRate * FRAME_MS) / 1000);
}

/**
 * Whether this browser can run the audio pipeline at all.
 *
 * Checked before touching the microphone so the UI can say why it is disabled,
 * rather than throwing halfway through `getUserMedia` and leaving a live track
 * open with nothing reading it.
 */
export function audioSupport(): { ok: boolean; reason: string } {
  if (typeof AudioDecoder === 'undefined' || typeof AudioEncoder === 'undefined') {
    return { ok: false, reason: 'WebCodecs is unavailable — use Chrome' };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: 'Microphone access needs a secure context (https or localhost)' };
  }
  return { ok: true, reason: '' };
}
