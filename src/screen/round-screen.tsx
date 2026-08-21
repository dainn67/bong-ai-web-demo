/**
 * The badge's round display.
 *
 * Fixed-size circle with the face centred and one status line beneath it —
 * matching the real hardware, where nothing outside the circle exists.
 */

import { useSimulatorStore } from '../store/simulator-store';
import type { Emotion } from '../protocol/message-types';
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

/** A ring colour per mode, so the state is readable at a glance while testing. */
const RING: Record<FaceMode, string> = {
  idle: 'ring-slate-700',
  emotion: 'ring-sky-500',
  speaking: 'ring-emerald-500',
};

export function RoundScreen() {
  const face = useSimulatorStore((state) => state.face);
  const status = useSimulatorStore((state) => state.status);

  const glyph = face.mode === 'speaking' ? SPEAKING_FACE : FACES[face.emotion];

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className={`flex h-80 w-80 items-center justify-center overflow-hidden rounded-full bg-slate-900 ring-4 transition-colors ${RING[face.mode]}`}
      >
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
      </div>
      <span className="text-xs uppercase tracking-widest text-slate-500">{face.mode}</span>
    </div>
  );
}
