/**
 * The wire contract with the Xiaozhi backend.
 *
 * Every message is either a JSON frame (typed here) or a raw binary Opus frame.
 * Field names are the server's, so they stay snake_case — do not "fix" them.
 */

// Type-only, so nothing of the screen layer survives into the bundle here. The
// touch frames genuinely carry these exact values, and spelling them out beats
// a `string` that any typo slips through.
import type { TouchClassificationResult, TouchLayoutType } from '../screen/touch-layout';

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

/**
 * Faces the backend can command directly, as opposed to the mood it infers.
 *
 * A superset of `Emotion`: the display command carries device states like
 * `thinking` and `listening` that a conversation never produces.
 */
export const EXPRESSIONS = [
  'happy',
  'sad',
  'angry',
  'surprised',
  'neutral',
  'thinking',
  'excited',
  'sleeping',
  'listening',
  'talking',
  'confused',
  'waving',
  'offline',
] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export function toExpression(value: unknown): Expression | null {
  return EXPRESSIONS.includes(value as Expression) ? (value as Expression) : null;
}

/**
 * Server-driven screen content: a named face, or an image to show instead.
 *
 * Two spellings are in circulation. The backend schema builds
 * `{ type: 'display', action: 'expression' | 'show_image' }`; an older client
 * listens for `{ type: 'display_expression' }` and `{ type: 'display_image' }`.
 * Nothing has ever sent either over the live socket, so neither is proven —
 * accepting both is the cheap way to be right whichever wins.
 */
export interface DisplayIn {
  type: 'display';
  action: 'expression' | 'show_image' | 'set_touch_zones' | 'clear_touch_zones';
  name?: string;
  url?: string;
  width?: number;
  height?: number;
  format?: string;
  mode?: 'tap' | 'swipe';
  zones_count?: number;
  layout?: string;
  timeout_ms?: number;
}

export interface DisplayExpressionIn {
  type: 'display_expression';
  name?: string;
}

export interface DisplayImageIn {
  type: 'display_image';
  url?: string | null;
}

export interface ImageIn {
  type: 'image';
  url?: string | null;
}

export interface GifIn {
  type: 'gif';
  url?: string | null;
}

export interface CustomIn {
  type: 'custom';
  payload?: {
    action?: string;
    image_url?: string;
    [key: string]: unknown;
  };
}

/** What a display frame resolves to once the spelling is normalised away. */
export type DisplayCommand =
  | { kind: 'expression'; name: Expression }
  | { kind: 'image'; url: string }
  | {
      kind: 'touch_zones';
      mode: 'tap' | 'swipe';
      zones_count: number;
      layout: string;
      timeout_ms: number;
    }
  | { kind: 'clear_touch_zones' }
  /** An image frame carrying no URL is the server clearing the screen. */
  | { kind: 'clear' };

/** Reads either spelling, or returns null for anything that is not a display frame. */
export function toDisplayCommand(message: IncomingMessage): DisplayCommand | null {
  if (message.type === 'display_expression' || message.type === 'display_image') {
    return fromParts(
      message.type === 'display_expression' ? 'expression' : 'show_image',
      (message as DisplayExpressionIn).name,
      (message as DisplayImageIn).url,
    );
  }
  if (message.type === 'image') {
    const url = (message as ImageIn).url;
    return url ? { kind: 'image', url } : { kind: 'clear' };
  }
  if (message.type === 'custom') {
    const p = (message as CustomIn).payload;
    if (p && (p.action === 'show_image' || p.image_url)) {
      const url = p.image_url;
      return url ? { kind: 'image', url } : { kind: 'clear' };
    }
  }
  if (message.type === 'display') {
    const d = message as DisplayIn;
    if (d.action === 'set_touch_zones') {
      return {
        kind: 'touch_zones',
        mode: d.mode || 'tap',
        zones_count: d.zones_count || 2,
        layout: d.layout || 'split_vertical',
        timeout_ms: d.timeout_ms || 10000,
      };
    }
    if (d.action === 'clear_touch_zones') {
      return { kind: 'clear_touch_zones' };
    }
    return fromParts(d.action, d.name, d.url);
  }
  return null;
}

function fromParts(
  action: string,
  name?: string,
  url?: string | null,
): DisplayCommand | null {
  if (action === 'expression') {
    const expression = toExpression(name);
    // An unknown face name is dropped rather than guessed at: leaving the
    // current one up is always better than showing the wrong feeling.
    return expression ? { kind: 'expression', name: expression } : null;
  }
  if (action === 'show_image') return url ? { kind: 'image', url } : { kind: 'clear' };
  return null;
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

export interface CatalogItemIn {
  id: string;
  title: string;
  description?: string;
  cover_url?: string;
  data_url?: string;
  slug?: string;
  target_words?: string;
  welcome_message?: string;
  category?: string;
  type?: string;
}

/** Content catalog delivered by backend over WebSocket on connection. */
export interface ContentCatalogIn {
  type: 'content_catalog';
  version?: number;
  child_name?: string;
  lessons?: CatalogItemIn[];
  stories?: CatalogItemIn[];
  topics?: CatalogItemIn[];
}

export interface ListenIn {
  type: 'listen';
  state?: 'start' | 'stop' | 'detect';
  text?: string;
}

export interface ActivityStateIn {
  type: 'activity_state';
  state?: 'playing' | 'paused' | 'idle';
  session_id?: string;
}

/**
 * The server opening a question window — §3.2 of the touch protocol.
 *
 * `touch_layout` stays a bare `string` on purpose. It is whatever the backend
 * put on the wire, and narrowing it here would only move the lie: the handler
 * runs it through `parseTouchLayout` and refuses the window if it names none of
 * the seven, rather than grading a child against a grid the artwork never used.
 */
export interface LessonQuestionIn {
  type: 'lesson_question';
  question_type: 'touch' | 'speech';
  touch_layout?: string;
  timeout_ms?: number;
  image_url?: string;
}

export type IncomingMessage =
  | HelloIn
  | SttIn
  | LlmIn
  | TtsIn
  | ListenIn
  | LessonQuestionIn
  | ActivityStateIn
  | DisplayIn
  | DisplayExpressionIn
  | DisplayImageIn
  | ImageIn
  | GifIn
  | CustomIn
  | IotIn
  | McpIn
  | ServerIn
  | PongIn
  | ContentCatalogIn;

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

export interface TouchOut {
  type: 'touch_event';
  gesture: 'tap' | 'swipe';
  zone?: string;
  direction?: 'swipe_up' | 'swipe_down' | 'swipe_left' | 'swipe_right';
}

/**
 * The child's answer to a touch question — §3.1 of the touch protocol.
 *
 * Typed against the classifier rather than as bare strings, because unlike an
 * incoming frame this one is ours to get right: every value that goes out came
 * from `classifyGesture`, and the compiler may as well say so.
 */
export interface LessonTouchOut {
  type: 'lesson_touch';
  session_id?: string;
  layout: TouchLayoutType;
  zone: TouchClassificationResult;
  point?: { x: number; y: number };
  duration_ms?: number;
}

export type OutgoingMessage = HelloOut | ListenOut | AbortOut | PingOut | LessonTouchOut | TouchOut;

