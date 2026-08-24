/**
 * End-of-turn detection around a {@link SilenceVad}.
 *
 * Feed it PCM chunks; it fires once when the child has finished, for one of
 * three reasons. The third is the one that matters most: if the child says
 * nothing at all, the turn still ends. Without it, a question waits forever on
 * a child who has wandered off, and the lesson simply stops.
 *
 * Time is injected rather than read from the clock, so a twenty-second cap can
 * be tested in a millisecond.
 */

import { SilenceVad, type VadOptions } from './vad';

export type TurnEndReason = 'silence' | 'cap';

/** Hard cap on one utterance, measured from the moment speech starts. */
export const MAX_UTTERANCE_MS = 20_000;

/** Cap from the mic opening when no speech ever comes. */
export const MAX_LISTEN_MS = 10_000;

export interface TurnOptions extends VadOptions {
  maxUtteranceMs?: number;
  /** Null waits indefinitely — the live-chat default. Lessons set a value. */
  maxListenMs?: number | null;
  now?: () => number;
}

export class TurnController {
  private readonly vad: SilenceVad;
  private readonly maxUtteranceMs: number;
  private readonly maxListenMs: number | null;
  private readonly now: () => number;

  private spoke = false;
  private speechStartedAt: number | null = null;
  private begunAt = 0;
  private finished = false;

  constructor(options: TurnOptions = {}) {
    this.vad = new SilenceVad(options);
    this.maxUtteranceMs = options.maxUtteranceMs ?? MAX_UTTERANCE_MS;
    this.maxListenMs = options.maxListenMs === undefined ? MAX_LISTEN_MS : options.maxListenMs;
    this.now = options.now ?? (() => Date.now());
  }

  /** Whether the child actually said something. Drives the `silent` branch. */
  get speechDetected(): boolean {
    return this.spoke;
  }

  /** Resets for a fresh turn. */
  begin(): void {
    this.vad.reset();
    this.spoke = false;
    this.speechStartedAt = null;
    this.begunAt = this.now();
    this.finished = false;
  }

  /**
   * Feeds one chunk. Returns the reason when the turn ends, else null.
   *
   * Latches after the first end so a late chunk cannot fire a second turn into
   * a caller that has already moved on to grading.
   */
  offer(pcm: Int16Array, sampleRate: number): TurnEndReason | null {
    if (this.finished) return null;

    const ended = this.vad.process(pcm, sampleRate);
    if (!this.spoke && this.vad.speechActive) {
      this.spoke = true;
      this.speechStartedAt = this.now();
    }

    const now = this.now();
    const overUtterance =
      this.speechStartedAt !== null && now - this.speechStartedAt >= this.maxUtteranceMs;
    const overListen =
      !this.spoke && this.maxListenMs !== null && now - this.begunAt >= this.maxListenMs;

    if (!ended && !overUtterance && !overListen) return null;

    this.finished = true;
    return ended ? 'silence' : 'cap';
  }
}
