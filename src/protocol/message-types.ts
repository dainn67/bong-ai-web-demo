/**
 * The wire contract with the Xiaozhi backend.
 *
 * Every message is either a JSON frame (typed here) or a raw binary Opus frame.
 * Field names are the server's, so they stay snake_case — do not "fix" them.
 */

/** Emotions the backend attaches to `llm` frames when `features.emoji` is on. */
export const EMOTIONS = ['happy', 'sad', 'angry', 'surprised', 'neutral'] as const;
export type Emotion = (typeof EMOTIONS)[number];

/** Narrows an arbitrary string to a known emotion, or null if the server sent something new. */
export function toEmotion(value: unknown): Emotion | null {
  return EMOTIONS.includes(value as Emotion) ? (value as Emotion) : null;
}

// ---------------------------------------------------------------------------
// Backend -> device
// ---------------------------------------------------------------------------

/** Handshake reply. Its `session_id` is required on every `abort` we send back. */
export interface HelloIn {
  type: 'hello';
  session_id: string;
  audio_params?: AudioParams;
}

/** Speech-to-text result — what the backend thinks the child just said. */
export interface SttIn {
  type: 'stt';
  text: string;
}

/** Model reply text, plus the face to wear while saying it. */
export interface LlmIn {
  type: 'llm';
  text: string;
  emotion?: string;
}

/**
 * Speech playback lifecycle.
 *
 * `start`/`stop` bracket a whole reply; `sentence_start`/`sentence_end` bracket
 * each sentence inside it and carry the text being spoken right now.
 */
export interface TtsIn {
  type: 'tts';
  state: 'start' | 'sentence_start' | 'sentence_end' | 'stop';
  text?: string;
}

/** Hardware commands (volume, LEDs, …). Executing them is the simulator's job. */
export interface IotIn {
  type: 'iot';
  commands: unknown[];
}

/** Model-context-protocol payload. Safe to ignore — we declare `mcp: false`. */
export interface McpIn {
  type: 'mcp';
  payload?: unknown;
}

/** Out-of-band server notice, e.g. "config updated". */
export interface ServerIn {
  type: 'server';
  status?: string;
  content?: string;
}

/** Heartbeat reply to our `ping`. Carries nothing. */
export interface PongIn {
  type: 'pong';
}

export type IncomingMessage =
  | HelloIn
  | SttIn
  | LlmIn
  | TtsIn
  | IotIn
  | McpIn
  | ServerIn
  | PongIn;

/**
 * Parses a JSON text frame into a typed message.
 *
 * Returns null for anything unparseable or missing a `type`, so one malformed
 * frame can never take the socket down — the caller just logs and moves on.
 */
export function parseIncoming(raw: string): IncomingMessage | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    if (typeof (data as { type?: unknown }).type !== 'string') return null;
    return data as IncomingMessage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Device -> backend
// ---------------------------------------------------------------------------

/**
 * Audio format negotiated in the handshake.
 *
 * Declaring this explicitly is not optional: the backend silently defaults to
 * 24000 Hz, so a simulator that stays quiet gets a rate it never agreed to and
 * plays everything at the wrong speed.
 */
export interface AudioParams {
  format: 'opus';
  sample_rate: number;
  channels: number;
}

export interface HelloOut {
  type: 'hello';
  device_id: string;
  device_name: string;
  device_mac: string;
  token: string;
  /**
   * `emoji: true` is what makes the backend attach `emotion` to `llm` frames.
   * With it off the face never changes and the screen sits on idle forever.
   */
  features: { mcp: boolean; emoji: boolean };
  audio_params: AudioParams;
}

/**
 * Microphone state, or a typed message standing in for one.
 *
 * `detect` carries `text` and lets us drive a whole conversation from the
 * keyboard — the fastest way to exercise the loop before audio works.
 */
export interface ListenOut {
  type: 'listen';
  state: 'start' | 'stop' | 'detect';
  mode?: 'auto' | 'manual';
  text?: string;
}

/** Cuts the backend off mid-sentence, the way a real barge-in would. */
export interface AbortOut {
  type: 'abort';
  session_id: string;
  reason: string;
}

export interface PingOut {
  type: 'ping';
}

export type OutgoingMessage = HelloOut | ListenOut | AbortOut | PingOut;
