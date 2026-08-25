/**
 * Energy voice-activity detection over PCM16 mono.
 *
 * Ported from the app's `SilenceVad`, thresholds included, so a turn ends on
 * the badge at the same moment it would on the phone. The app also ships a
 * neural detector (Silero, via ONNX) and treats this as its fallback; for a
 * test harness the fallback is the right amount of machinery — a few hundred
 * bytes of arithmetic against several megabytes of model.
 *
 * Pure and synchronous, so the turn logic is testable without a microphone.
 */

/** RMS a chunk must exceed to count as speech. */
export const SPEECH_RMS = 600;

/** RMS a chunk must fall below to count toward end-of-turn silence. */
export const SILENCE_RMS = 300;

/** Sustained quiet, after speech, that ends the turn. */
export const HANGOVER_MS = 800;

export interface VadOptions {
  speechRms?: number;
  silenceRms?: number;
  hangoverMs?: number;
}

/**
 * The two thresholds give hysteresis: a chunk between them is neither speech
 * nor silence, so an utterance sitting near the noise floor does not flap
 * between states and chop itself into fragments.
 */
export class SilenceVad {
  private readonly speechRms: number;
  private readonly silenceRms: number;
  private readonly hangoverMs: number;

  private spoke = false;
  private silenceMs = 0;
  private ended = false;

  constructor(options: VadOptions = {}) {
    this.speechRms = options.speechRms ?? SPEECH_RMS;
    this.silenceRms = options.silenceRms ?? SILENCE_RMS;
    this.hangoverMs = options.hangoverMs ?? HANGOVER_MS;
  }

  /** Whether any speech has been heard since the last {@link reset}. */
  get speechActive(): boolean {
    return this.spoke;
  }

  /** Feeds one chunk. True exactly once, when the utterance ends. */
  process(pcm: Int16Array, sampleRate: number): boolean {
    const level = rms(pcm);

    if (level >= this.speechRms) {
      this.spoke = true;
      this.silenceMs = 0;
      this.ended = false;
      return false;
    }

    // Between the thresholds, before any speech, or already finished — nothing
    // to accumulate.
    if (level >= this.silenceRms || !this.spoke || this.ended) return false;

    this.silenceMs += (pcm.length * 1000) / sampleRate;
    if (this.silenceMs < this.hangoverMs) return false;

    this.ended = true;
    this.spoke = false;
    return true;
  }

  reset(): void {
    this.spoke = false;
    this.silenceMs = 0;
    this.ended = false;
  }
}

/**
 * Root-mean-square amplitude.
 *
 * RMS rather than peak: a single click or a chair scraping has a high peak but
 * carries almost no energy, and peak detection would hear it as the child
 * starting to talk.
 */
export function rms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length);
}
