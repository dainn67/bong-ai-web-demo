/**
 * The mic, for one lesson answer.
 *
 * Different from `MicCapture` in one way that matters: no Opus. The badge's
 * conversation uplink encodes, because the backend expects Opus frames; a
 * lesson answer goes to a transcription service that wants a WAV, so the raw
 * samples are what we want and encoding them first would only be work to undo.
 *
 * The worklet is shared with the conversation path — it does the framing and
 * nothing else, so both consumers can use it as-is.
 */

import workletUrl from '../audio/pcm-worklet.js?url';
import { concatPcm, floatToPcm16 } from '../audio/wav';
import { TurnController } from '../audio/turn-controller';
import { hasSpeechContent, transcribe } from '../api/stt-client';

/** 16 kHz mono, which is what the recogniser wants. */
export const MIC_SAMPLE_RATE = 16_000;

/** 100ms frames — long enough for a stable RMS, short enough to react. */
const FRAME_SAMPLES = MIC_SAMPLE_RATE / 10;

export interface LessonAnswer {
  /** What the child said, or null when nothing was recognised. */
  text: string | null;
  /** Whether they spoke at all. This is what drives the `silent` branch. */
  speechDetected: boolean;
  /** Set when transcription itself failed — distinct from a silent turn. */
  failed: boolean;
}

export interface LessonMicHandlers {
  onLevel?: (level: number) => void;
}

export class LessonMic {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;

  private chunks: Int16Array[] = [];
  private turn: TurnController | null = null;
  private settle: ((answer: LessonAnswer) => void) | null = null;
  private cancelled = false;

  private readonly handlers: LessonMicHandlers;

  constructor(handlers: LessonMicHandlers = {}) {
    this.handlers = handlers;
  }

  async hasPermission(): Promise<boolean> {
    try {
      const status = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      });
      return status.state !== 'denied';
    } catch {
      // Firefox and Safari do not expose the microphone permission here.
      // Assuming yes and letting getUserMedia be the real gate is the only
      // portable answer, and the error path below reports it properly.
      return true;
    }
  }

  /**
   * Opens the mic and resolves with one turn.
   *
   * Always resolves — never rejects. The engine's whole design rests on a
   * question having an outcome no matter what goes wrong, and a rejected
   * promise here would strand the lesson at a node with no branch taken.
   */
  async listen(): Promise<LessonAnswer> {
    this.cancelled = false;
    this.chunks = [];

    try {
      await this.open();
    } catch (error) {
      return { text: null, speechDetected: false, failed: true, ...logOpenFailure(error) };
    }

    const turn = new TurnController();
    this.turn = turn;
    turn.begin();

    const captured = await new Promise<Int16Array | null>((resolve) => {
      this.settle = () => resolve(null); // cancel() path
      this.onTurnEnd = () => resolve(concatPcm(this.chunks));
    });

    await this.close();

    if (this.cancelled || captured === null) {
      return { text: null, speechDetected: false, failed: false };
    }

    // No speech: skip transcription outright. Ambient noise decodes to stray
    // tokens, and echoing one back as the child's answer is worse than silence.
    if (!turn.speechDetected) {
      return { text: null, speechDetected: false, failed: false };
    }

    try {
      const text = await transcribe(captured, MIC_SAMPLE_RATE);
      return {
        text: hasSpeechContent(text) ? text : null,
        speechDetected: hasSpeechContent(text),
        failed: false,
      };
    } catch {
      // The service is down. Say so rather than pretending the child was quiet
      // — a silent branch here reads to the child as being ignored.
      return { text: null, speechDetected: true, failed: true };
    }
  }

  /** Aborts an in-flight listen — leaving the lesson, or an interruption. */
  async cancel(): Promise<void> {
    this.cancelled = true;
    this.settle?.({ text: null, speechDetected: false, failed: false });
    this.onTurnEnd?.();
    await this.close();
  }

  private onTurnEnd: (() => void) | null = null;

  private async open(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });

    this.context = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
    await this.context.audioWorklet.addModule(workletUrl);

    const source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'pcm-frame-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { frameSize: FRAME_SAMPLES },
    });
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) =>
      this.handleFrame(event.data);
    source.connect(this.node);
  }

  private handleFrame(samples: Float32Array): void {
    if (this.cancelled) return;

    let peak = 0;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    this.handlers.onLevel?.(Math.min(1, peak * 2));

    const pcm = floatToPcm16(samples);
    this.chunks.push(pcm);

    if (this.turn?.offer(pcm, MIC_SAMPLE_RATE)) {
      const end = this.onTurnEnd;
      this.onTurnEnd = null;
      end?.();
    }
  }

  private async close(): Promise<void> {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
    try {
      await this.context?.close();
    } catch {
      // Racing teardown. Harmless.
    }
    this.context = null;
    this.turn = null;
    this.settle = null;
    this.onTurnEnd = null;
    this.handlers.onLevel?.(0);
  }

  async dispose(): Promise<void> {
    await this.cancel();
  }
}

function logOpenFailure(error: unknown): Record<string, never> {
  console.warn('[lesson] mic open failed', error);
  return {} as Record<string, never>;
}
