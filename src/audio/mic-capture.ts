/**
 * The badge's microphone: sound in, Opus frames out.
 *
 * The capture chain is mic -> AudioContext at the negotiated rate -> worklet ->
 * AudioEncoder. Asking the context for the target rate makes the browser do the
 * resampling, which is both better and shorter than doing it by hand.
 */

import { FRAME_DURATION_US, frameSize } from './audio-format';
import workletUrl from './pcm-worklet.js?url';

export interface MicHandlers {
  /** One encoded Opus frame, ready for the socket. */
  onFrame: (frame: ArrayBuffer) => void;
  /** 0..1, for the level meter. Fires per frame. */
  onLevel: (level: number) => void;
  onError: (message: string) => void;
}

/** Encoder target. Speech at 16 kHz mono needs far less than music would. */
const BITRATE = 24_000;

export class MicCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private encoder: AudioEncoder | null = null;

  /** Running sample count, the timestamp the encoder wants. */
  private samplesSent = 0;

  /**
   * When true, frames are encoded and dropped rather than sent.
   *
   * A laptop has no echo cancellation between its own speaker and its own mic,
   * so while the badge is talking the mic hears it and the backend transcribes
   * the badge interrupting itself. Muting the uplink instead of pausing capture
   * keeps the level meter live, which is what makes barge-in detectable.
   */
  private muted = false;

  private readonly sampleRate: number;
  private readonly handlers: MicHandlers;

  constructor(sampleRate: number, handlers: MicHandlers) {
    this.sampleRate = sampleRate;
    this.handlers = handlers;
  }

  get isRunning(): boolean {
    return this.stream !== null;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  async start(): Promise<boolean> {
    if (this.stream) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      // Requesting the rate here is what removes the hand-written resampler the
      // reference implementation needs.
      this.context = new AudioContext({ sampleRate: this.sampleRate });
      await this.context.audioWorklet.addModule(workletUrl);

      this.startEncoder();

      const source = this.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.context, 'pcm-frame-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: { frameSize: frameSize(this.sampleRate) },
      });
      this.node.port.onmessage = (event: MessageEvent<Float32Array<ArrayBuffer>>) =>
        this.handleFrame(event.data);
      source.connect(this.node);

      return true;
    } catch (error) {
      this.handlers.onError(`microphone unavailable: ${String(error)}`);
      await this.stop();
      return false;
    }
  }

  async stop(): Promise<void> {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
    try {
      if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
      await this.context?.close();
    } catch {
      // Same as playback teardown: races here are expected and harmless.
    }
    this.encoder = null;
    this.context = null;
    this.samplesSent = 0;
    this.handlers.onLevel(0);
  }

  private startEncoder(): void {
    this.encoder = new AudioEncoder({
      output: (chunk) => {
        if (this.muted) return;
        const frame = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(new Uint8Array(frame));
        this.handlers.onFrame(frame);
      },
      error: (error) => this.handlers.onError(`encoder: ${error.message}`),
    });

    this.encoder.configure({
      codec: 'opus',
      sampleRate: this.sampleRate,
      numberOfChannels: 1,
      bitrate: BITRATE,
      // Match the badge's framing. Left at the 20ms default the server would
      // receive three frames where it expects one.
      opus: { frameDuration: FRAME_DURATION_US },
    });
  }

  private handleFrame(samples: Float32Array<ArrayBuffer>): void {
    this.handlers.onLevel(rms(samples));

    const encoder = this.encoder;
    if (!encoder || encoder.state !== 'configured') return;

    const data = new AudioData({
      format: 'f32-planar',
      sampleRate: this.sampleRate,
      numberOfFrames: samples.length,
      numberOfChannels: 1,
      timestamp: Math.round((this.samplesSent / this.sampleRate) * 1_000_000),
      data: samples,
    });
    this.samplesSent += samples.length;

    try {
      encoder.encode(data);
    } catch (error) {
      this.handlers.onError(`encode failed: ${String(error)}`);
    } finally {
      data.close();
    }
  }
}

/** Loudness of one frame, 0..1. Used for the meter and for barge-in. */
function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}
