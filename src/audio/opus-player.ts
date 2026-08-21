/**
 * The badge's speaker: Opus frames in, sound out.
 *
 * Decoding is WebCodecs; scheduling is Web Audio. The two are separate concerns
 * and the seam between them is `nextStartTime` — decoded buffers are queued
 * back-to-back on the audio clock rather than played on arrival, because frames
 * arrive in network-time bursts and playing them on arrival stutters.
 */

import { FRAME_DURATION_US } from './audio-format';

export interface OpusPlayerHandlers {
  /** Fires on the transitions only, not per frame. */
  onPlayingChange: (playing: boolean) => void;
  onError: (message: string) => void;
}

export class OpusPlayer {
  private context: AudioContext | null = null;
  private decoder: AudioDecoder | null = null;
  private gain: GainNode | null = null;

  /** Audio-clock time the next decoded buffer should start at. */
  private nextStartTime = 0;
  private playing = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Presentation timestamp for the next frame, in microseconds.
   *
   * Opus frames off the wire carry no timing, so we synthesise it. It resets
   * per sentence — see `startSentence`.
   */
  private timestamp = 0;

  private readonly sampleRate: number;
  private readonly handlers: OpusPlayerHandlers;

  constructor(sampleRate: number, handlers: OpusPlayerHandlers) {
    this.sampleRate = sampleRate;
    this.handlers = handlers;
  }

  /** True once the browser has actually produced sound, not merely accepted frames. */
  get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Opens the AudioContext.
   *
   * Must be called from a click. Browsers start a context suspended unless a
   * gesture is in progress, and a suspended context swallows everything
   * scheduled on it — silently, which is the worst way to find out.
   */
  async resume(): Promise<void> {
    this.ensureContext();
    if (this.context?.state === 'suspended') await this.context.resume();
  }

  setVolume(volume: number): void {
    this.ensureContext();
    if (this.gain) this.gain.gain.value = volume;
  }

  /**
   * Resets the timestamp clock at each `tts.sentence_start`.
   *
   * Without this the synthesised timestamps drift further from the decoder's
   * expectations with every sentence, and a long reply — a bedtime story, the
   * exact thing this device is for — goes silent partway through.
   */
  startSentence(): void {
    this.timestamp = 0;
  }

  /** Queues one Opus frame for playback. */
  decode(frame: ArrayBuffer): void {
    if (frame.byteLength === 0) return;
    this.ensureContext();
    const decoder = this.ensureDecoder();
    if (!decoder || decoder.state !== 'configured') return;

    try {
      decoder.decode(
        new EncodedAudioChunk({
          type: 'key', // every Opus frame stands alone
          timestamp: this.timestamp,
          duration: FRAME_DURATION_US,
          data: frame,
        }),
      );
      this.timestamp += FRAME_DURATION_US;
    } catch (error) {
      this.handlers.onError(`decode failed: ${String(error)}`);
    }
  }

  /**
   * Drops anything still queued.
   *
   * Used for barge-in: when the child talks over the reply, the already-decoded
   * tail has to go, or the badge keeps talking after being interrupted.
   */
  stop(): void {
    this.clearSilenceTimer();
    if (this.context) this.nextStartTime = this.context.currentTime;
    this.setPlaying(false);
  }

  async close(): Promise<void> {
    this.clearSilenceTimer();
    try {
      if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
      await this.context?.close();
    } catch {
      // Teardown races with in-flight decodes; nothing here is worth reporting.
    }
    this.decoder = null;
    this.context = null;
    this.gain = null;
    this.setPlaying(false);
  }

  private ensureContext(): void {
    if (this.context) return;
    // Deliberately not pinned to the negotiated rate. Opus always decodes to
    // 48 kHz whatever rate the decoder is configured with, so pinning the
    // context to 16000 would downsample every buffer on the way out for no
    // reason. The default rate is the device's, which is what the decoder is
    // already producing. Each buffer carries its own rate regardless.
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.gain = this.context.createGain();
    this.gain.connect(this.context.destination);
    this.nextStartTime = this.context.currentTime;
  }

  private ensureDecoder(): AudioDecoder | null {
    if (this.decoder && this.decoder.state !== 'closed') return this.decoder;
    try {
      this.decoder = new AudioDecoder({
        output: (data) => this.schedule(data),
        error: (error) => this.handlers.onError(`decoder: ${error.message}`),
      });
      this.decoder.configure({
        codec: 'opus',
        sampleRate: this.sampleRate,
        numberOfChannels: 1,
      });
      return this.decoder;
    } catch (error) {
      this.handlers.onError(`decoder init failed: ${String(error)}`);
      return null;
    }
  }

  private schedule(data: AudioData): void {
    const context = this.context;
    const gain = this.gain;
    if (!context || !gain) {
      data.close();
      return;
    }

    const buffer = context.createBuffer(1, data.numberOfFrames, data.sampleRate);
    data.copyTo(buffer.getChannelData(0), { planeIndex: 0, format: 'f32-planar' });
    data.close();

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);

    // Never schedule in the past: after a gap the queue time has fallen behind
    // the clock, and starting at a stale time plays the frame instantly, out of
    // order with whatever is still queued.
    const startAt = Math.max(context.currentTime, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    this.setPlaying(true);
    this.armSilenceTimer();
  }

  /**
   * Declares playback finished once the queue drains.
   *
   * There is no "queue empty" event, so this re-arms on every frame and only
   * fires when one stops arriving — which is also exactly when the speaker
   * really has gone quiet.
   */
  private armSilenceTimer(): void {
    this.clearSilenceTimer();
    if (!this.context) return;
    const remainingMs = (this.nextStartTime - this.context.currentTime) * 1000;
    this.silenceTimer = setTimeout(() => this.setPlaying(false), Math.max(120, remainingMs + 120));
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private setPlaying(playing: boolean): void {
    if (this.playing === playing) return;
    this.playing = playing;
    this.handlers.onPlayingChange(playing);
  }
}
