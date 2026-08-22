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
  /**
   * One line under the face: the conversation, and nothing else.
   *
   * The badge's own words carry `Bống:`; the child's appear as they are, since
   * we have no name to put in front of them. Sentences arriving during
   * playback are unprefixed too — by then the badge is audibly the one
   * talking, and naming it every sentence reads as a transcript.
   */
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

    case 'stt': {
      // The backend also uses this frame to announce a tool call — the LLM
      // deciding to start a lesson arrives as `% start_learning_session`. That
      // is machinery, not something anyone said, and captioning it as speech
      // put a function name on a toy's face.
      if (isToolCall(message.text)) return state;
      // No prefix: we do not know the child's name, and `Nghe thấy:` on their
      // own words made the badge sound like it was filing a report.
      return { ...state, statusText: message.text };
    }

    case 'llm': {
      // An unknown or absent emotion keeps the current face rather than
      // resetting it — the backend adding a new mood must not blank the screen.
      const emotion = toEmotion(message.emotion) ?? state.emotion;
      // A fresh reply supersedes a face the backend named earlier, but not an
      // image: artwork stays up until it is replaced or explicitly cleared.
      return {
        ...state,
        mode: 'emotion',
        emotion,
        statusText: `Bống: ${message.text}`,
        expression: null,
      };
    }

    case 'display':
    case 'display_expression':
    case 'display_image':
      return reduceDisplay(state, message);

    case 'tts':
      return reduceTts(state, message.state, message.text);

    // Commands and server notices are deliberately invisible. The face shows a
    // conversation; anything else belongs in the packet inspector, where the
    // person debugging it is already looking.
    case 'iot':
    case 'server':
      return state;

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

/**
 * Whether an `stt` frame is a tool call rather than speech.
 *
 * `%` is the marker, which is xiaozhi's convention and not written down in the
 * backend here — so this is drawn from what the server actually sends. Every
 * tool call observed has carried it, and no real transcript has. If a call
 * ever slips through unmarked, this is the one place to widen.
 */
function isToolCall(text: string): boolean {
  return text.trimStart().startsWith('%');
}

/** The settled state after the post-speech delay expires. */
export function toIdle(state: FaceState): FaceState {
  return { ...state, mode: 'idle' };
}
