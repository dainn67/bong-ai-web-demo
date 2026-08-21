/**
 * The badge itself — a physical object, not a preview pane.
 *
 * Three layers, outside in: the plastic body, the bezel, and the round display.
 * Only the innermost one shows anything the firmware controls; the rest exists
 * so the thing on screen reads as hardware you could clip to a stuffed animal.
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useSimulatorStore } from '../store/simulator-store';
import {
  DISPLAY_SIZE,
  isInsideDisplay,
  isTap,
  toDevicePoint,
  type TouchStart,
} from './touch-input';
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

/** The glow behind the face. Colour carries the mode, so it reads at a glance. */
const GLOW: Record<FaceMode, string> = {
  idle: 'shadow-[inset_0_0_60px_rgba(255,201,92,0.12)]',
  emotion: 'shadow-[inset_0_0_70px_rgba(255,138,107,0.22)]',
  speaking: 'shadow-[inset_0_0_80px_rgba(78,217,164,0.28)]',
};

export function RoundScreen() {
  const face = useSimulatorStore((state) => state.face);
  const status = useSimulatorStore((state) => state.status);
  const speaking = useSimulatorStore((state) => state.speaking);
  const listening = useSimulatorStore((state) => state.micState === 'listening');
  const toggleListening = useSimulatorStore((state) => state.toggleListening);

  const isAwake = status === 'connected';
  const { displayRef, ripple, pointerHandlers } = useDisplayTouch(isAwake, toggleListening);
  // Precedence, strongest first: artwork the backend sent, a face it named,
  // the talking face, then the mood we inferred from the reply.
  const glyph = face.expression
    ? EXPRESSION_FACES[face.expression]
    : face.mode === 'speaking'
      ? SPEAKING_FACE
      : FACES[face.emotion];

  return (
    <div className={`relative ${isAwake ? 'animate-bob' : ''}`}>
      <Ears />

      {/* Body: the moulded shell, sitting on a soft contact shadow. */}
      <div className="relative rounded-full bg-gradient-to-b from-white to-cream-200 p-4 shadow-[0_24px_50px_-12px_rgba(61,44,36,0.35),inset_0_2px_4px_rgba(255,255,255,0.9)]">
        {/* Bezel: the dark ring between shell and glass. */}
        <div className="rounded-full bg-gradient-to-b from-ink-700 to-ink-900 p-2.5 shadow-inner">
          {/* Display: everything inside here is under firmware control. */}
          <div
            ref={displayRef}
            {...pointerHandlers}
            className={`relative flex h-72 w-72 touch-none select-none items-center justify-center overflow-hidden rounded-full bg-screen transition-shadow duration-500 sm:h-80 sm:w-80 ${GLOW[face.mode]} ${isAwake ? 'cursor-pointer' : ''}`}
          >
            {isAwake && face.imageUrl ? (
              // Fills the circle edge to edge. The parent clips it, which is
              // what the real display does — nothing exists outside the circle.
              <img src={face.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-4 px-10 text-center">
                <span
                  className={`text-8xl leading-none drop-shadow-[0_0_18px_rgba(255,255,255,0.25)] ${
                    face.mode === 'speaking' ? 'animate-pulse' : 'animate-breathe'
                  }`}
                >
                  {isAwake ? glyph : '😴'}
                </span>
                {!isAwake && (
                  <p className="text-sm font-medium text-ink-300">Bống đang ngủ</p>
                )}
              </div>
            )}

            {/* Listening ring, drawn on the device rather than only in the
                controls: a tap on the glass is the thing that turned the mic
                on, so the glass has to be where you see that it worked. */}
            {listening && (
              <div className="pointer-events-none absolute inset-2 animate-pulse rounded-full ring-2 ring-mint-400/60" />
            )}

            {ripple && (
              <span
                key={ripple.id}
                className="animate-ripple pointer-events-none absolute h-16 w-16 rounded-full bg-white/25"
                style={{
                  left: `${(ripple.x / DISPLAY_SIZE) * 100}%`,
                  top: `${(ripple.y / DISPLAY_SIZE) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
            )}

            {/* Glass: a fixed highlight across the top, so it reads as covered. */}
            <div className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/12 via-transparent to-transparent" />
          </div>
        </div>

        <StatusLight awake={isAwake} speaking={speaking} />
        <Grille />
      </div>
    </div>
  );
}

/** The two felt ears that make it a creature rather than a puck. */
function Ears() {
  const ear =
    'absolute h-20 w-20 rounded-full bg-gradient-to-b from-cream-200 to-cream-300 shadow-[0_8px_14px_-6px_rgba(61,44,36,0.35)]';
  const inner = 'absolute h-9 w-9 rounded-full bg-coral-400/25';
  return (
    <>
      <div className={`${ear} -top-8 left-4`}>
        <span className={`${inner} left-5 top-5`} />
      </div>
      <div className={`${ear} -top-8 right-4`}>
        <span className={`${inner} right-5 top-5`} />
      </div>
    </>
  );
}

/** Charge and activity light, bottom right of the shell like the real one. */
function StatusLight({ awake, speaking }: { awake: boolean; speaking: boolean }) {
  const tone = !awake
    ? 'bg-ink-300'
    : speaking
      ? 'bg-mint-400 shadow-[0_0_12px_rgba(78,217,164,0.9)]'
      : 'bg-sunny-400 shadow-[0_0_10px_rgba(255,201,92,0.7)]';
  return (
    // Placed on the rim at roughly four o'clock. The body is a circle inside a
    // square box, so insetting from the corner would float it off the device.
    <div
      className={`absolute bottom-16 right-16 h-2.5 w-2.5 rounded-full transition-all duration-300 ${tone}`}
    />
  );
}

/** Speaker holes, moulded into the shell at the bottom. */
function Grille() {
  return (
    <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="h-1 w-1 rounded-full bg-ink-300/40" />
      ))}
    </div>
  );
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

/**
 * The glass, as an input device.
 *
 * Pointers are tracked by id so that more than one finger is a matter of
 * reading the map rather than restructuring this, and so a pointer that is
 * cancelled — a browser gesture stealing it, a finger sliding off — leaves
 * nothing behind that a later release could mistake for a tap.
 */
function useDisplayTouch(isAwake: boolean, onTap: () => void) {
  const displayRef = useRef<HTMLDivElement>(null);
  const starts = useRef(new Map<number, TouchStart>());
  const nextRipple = useRef(0);
  const [ripple, setRipple] = useState<Ripple | null>(null);

  const pointAt = (event: ReactPointerEvent): TouchStart | null => {
    const rect = displayRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { ...toDevicePoint(event.clientX, event.clientY, rect), at: event.timeStamp };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // A dark screen is a dead screen: the badge is not listening for touches
    // any more than it is listening for speech.
    if (!isAwake) return;
    const point = pointAt(event);
    if (!point || !isInsideDisplay(point)) return;

    starts.current.set(event.pointerId, point);
    // Capture so a finger that slides off still reports its release here,
    // which is what stops a stuck entry in the map.
    event.currentTarget.setPointerCapture(event.pointerId);
    setRipple({ id: nextRipple.current++, x: point.x, y: point.y });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = starts.current.get(event.pointerId);
    starts.current.delete(event.pointerId);
    if (!start) return;

    const end = pointAt(event);
    if (end && isInsideDisplay(end) && isTap(start, end)) onTap();
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    starts.current.delete(event.pointerId);
  };

  return {
    displayRef,
    ripple,
    pointerHandlers: { onPointerDown, onPointerUp, onPointerCancel },
  };
}
