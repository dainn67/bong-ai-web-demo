/**
 * What the round screen shows, derived from protocol messages.
 *
 * Pure: takes a state and a message, returns the next state. No timers, no DOM,
 * no React — so the whole display behaviour can be tested in milliseconds
 * instead of by watching a screen and hoping.
 */

import { toEmotion, type Emotion, type IncomingMessage } from '../protocol/message-types';

export type FaceMode = 'idle' | 'emotion' | 'speaking';

export interface FaceState {
  mode: FaceMode;
  /** Which face to wear. Held across `speaking` so the reply keeps its mood. */
  emotion: Emotion;
  /** One line under the face: what was heard, or what is being said. */
  statusText: string;
}

export const INITIAL_FACE_STATE: FaceState = {
  mode: 'idle',
  emotion: 'neutral',
  statusText: '',
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
      return { mode: 'emotion', emotion, statusText: message.text };
    }

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
