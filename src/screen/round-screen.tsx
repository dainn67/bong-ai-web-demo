/**
 * The badge's round display.
 *
 * Fixed-size circle with the face centred and one status line beneath it —
 * matching the real hardware, where nothing outside the circle exists.
 */

import { useSimulatorStore } from '../store/simulator-store';
import type { Emotion, Expression } from '../protocol/message-types';
import type { FaceMode } from './face-state-machine';

/**
 * Placeholder faces.
 *
 * Emoji until the real artwork exists. Swapping in images later means changing
 * this map and nothing else — no other file knows how a face is drawn.
 */
const FACES: Record<Emotion, string> = {
  happy: '😊',
  sad: '😢',
  angry: '😠',
  surprised: '😮',
  neutral: '🙂',
};

const SPEAKING_FACE = '😄';

/**
 * Faces the backend can ask for by name, beyond the moods it infers.
 *
 * Same placeholder-until-artwork deal as `FACES`, and the same promise: the
 * rest of the app never learns how a face is drawn.
 */
const EXPRESSION_FACES: Record<Expression, string> = {
  ...FACES,
  thinking: '🤔',
  excited: '🤩',
  sleeping: '😴',
  listening: '👂',
  talking: '😄',
  confused: '😕',
  waving: '👋',
  offline: '🔌',
};

/** A ring colour per mode, so the state is readable at a glance while testing. */
const RING: Record<FaceMode, string> = {
  idle: 'ring-slate-700',
  emotion: 'ring-sky-500',
  speaking: 'ring-emerald-500',
};

export function RoundScreen() {
  const face = useSimulatorStore((state) => state.face);
  const status = useSimulatorStore((state) => state.status);

  // Precedence, strongest first: artwork the backend sent, a face it named,
  // the talking face, then the mood we inferred from the reply.
  const glyph = face.expression
    ? EXPRESSION_FACES[face.expression]
    : face.mode === 'speaking'
      ? SPEAKING_FACE
      : FACES[face.emotion];

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className={`flex h-80 w-80 items-center justify-center overflow-hidden rounded-full bg-slate-900 ring-4 transition-colors ${RING[face.mode]}`}
      >
        {status === 'connected' && face.imageUrl ? (
          // Fills the circle edge to edge. The parent clips it, which is what
          // the real display does — there is no screen outside the circle.
          <img
            src={face.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={() => console.warn('[round-screen] image failed:', face.imageUrl)}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 px-8 text-center">
            <span
              className={`text-8xl transition-transform ${face.mode === 'speaking' ? 'animate-pulse' : ''}`}
            >
              {status === 'connected' ? glyph : '😴'}
            </span>
            <p className="line-clamp-3 text-sm text-slate-300">
              {status === 'connected' ? face.statusText : 'Disconnected'}
            </p>
          </div>
        )}
      </div>
      <span className="text-xs uppercase tracking-widest text-slate-500">{face.mode}</span>
    </div>
  );
}
