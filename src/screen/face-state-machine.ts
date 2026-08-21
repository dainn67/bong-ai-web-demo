/**
 * What the round screen shows, derived from protocol messages.
 *
 * Pure: takes a state and a message, returns the next state. No timers, no DOM,
 * no React — so the whole display behaviour can be tested in milliseconds
 * instead of by watching a screen and hoping.
 */

import {
  toDisplayCommand,
  toEmotion,
  type Emotion,
  type Expression,
  type IncomingMessage,
} from '../protocol/message-types';

export type FaceMode = 'idle' | 'emotion' | 'speaking';

export interface FaceState {
  mode: FaceMode;
  /** Which face to wear. Held across `speaking` so the reply keeps its mood. */
  emotion: Emotion;
  /** One line under the face: what was heard, or what is being said. */
  statusText: string;
  /**
   * Image or animation the backend told us to show, in place of any face.
   *
   * Takes the whole circle while set — lesson artwork and stickers are the
   * point of the screen when they are up, not decoration around a face.
   */
  imageUrl: string | null;
  /**
   * A face the backend named outright, overriding the mood we inferred.
   *
   * Separate from `emotion` because it covers device states like `thinking`
   * that no conversation produces, and because the next reply's mood should
   * take the screen back.
   */
  expression: Expression | null;
}

export const INITIAL_FACE_STATE: FaceState = {
  mode: 'idle',
  emotion: 'neutral',
  statusText: '',
  imageUrl: null,
  expression: null,
};

/**
 * How long the face lingers after speech ends before dropping back to idle.
 *
 * The guide asks for a beat here rather than a snap: without it, back-to-back
 * sentences make the face flicker between speaking and idle.
 */
export const IDLE_DELAY_MS = 1000;

/**
 * Advances the face for one message.
 *
 * Returns the same object reference when nothing changes, so React can skip the
 * re-render — worth it when audio frames are arriving continuously.
 */
export function reduceFace(state: FaceState, message: IncomingMessage): FaceState {
  switch (message.type) {
    case 'hello':
      return INITIAL_FACE_STATE;

    case 'stt':
      return { ...state, statusText: `Heard: ${message.text}` };

    case 'llm': {
      // An unknown or absent emotion keeps the current face rather than
      // resetting it — the backend adding a new mood must not blank the screen.
      const emotion = toEmotion(message.emotion) ?? state.emotion;
      // A fresh reply supersedes a face the backend named earlier, but not an
      // image: artwork stays up until it is replaced or explicitly cleared.
      return { ...state, mode: 'emotion', emotion, statusText: message.text, expression: null };
    }

    case 'display':
    case 'display_expression':
    case 'display_image':
      return reduceDisplay(state, message);

    case 'tts':
      return reduceTts(state, message.state, message.text);

    case 'iot':
      return { ...state, statusText: `Command received (${message.commands.length})` };

    case 'server':
      return { ...state, statusText: message.content ?? message.status ?? 'Server notice' };

    default:
      return state;
  }
}

function reduceDisplay(state: FaceState, message: IncomingMessage): FaceState {
  const command = toDisplayCommand(message);
  // Unrecognised display frames leave the screen exactly as it was.
  if (!command) return state;

  switch (command.kind) {
    case 'expression':
      return { ...state, expression: command.name, imageUrl: null };
    case 'image':
      return { ...state, imageUrl: command.url };
    case 'clear':
      return { ...state, imageUrl: null };
  }
}

function reduceTts(state: FaceState, ttsState: string, text?: string): FaceState {
  switch (ttsState) {
    case 'start':
      return { ...state, mode: 'speaking' };
    case 'sentence_start':
      return { ...state, mode: 'speaking', statusText: text ?? state.statusText };
    case 'sentence_end':
      return state;
    case 'stop':
      // Only the mode is reset here. The caller schedules the drop to idle
      // after IDLE_DELAY_MS; this keeps the reducer free of timers.
      return { ...state, mode: 'emotion' };
    default:
      return state;
  }
}

/** The settled state after the post-speech delay expires. */
export function toIdle(state: FaceState): FaceState {
  return { ...state, mode: 'idle' };
}
