/**
 * What the badge is saying or hearing, right now.
 *
 * On real hardware this line lives inside the circle, where there is room for
 * about four words. Here it sits below the device instead: the demo is watched
 * from across a desk, and a caption you can actually read is worth more than
 * strict fidelity to a 240-pixel screen.
 */

import { useSimulatorStore } from '../store/simulator-store';

export function SpeechBubble() {
  const statusText = useSimulatorStore((state) => state.face.statusText);
  const mode = useSimulatorStore((state) => state.face.mode);
  const status = useSimulatorStore((state) => state.status);

  const connected = status === 'connected';
  const text = connected
    ? statusText
    : status === 'connecting'
      ? 'Waking up…'
      : 'Tap Bống to wake him up';
  // Reserve the space even when empty, or the device jumps every time the
  // caption appears and disappears.
  const empty = !text;

  return (
    <div className="flex min-h-16 items-center justify-center px-6">
      <p
        className={`relative max-w-md rounded-blob px-6 py-3 text-center text-lg font-semibold leading-snug transition-all duration-300 ${
          empty
            ? 'opacity-0'
            : connected
              ? 'bg-white text-ink-900 shadow-[0_8px_24px_-8px_rgba(61,44,36,0.25)]'
              : 'bg-cream-200/70 text-ink-500'
        } ${mode === 'speaking' ? 'ring-2 ring-mint-400/40' : ''}`}
      >
        {/* The tail, pointing back up at the badge. */}
        <span
          className={`absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[3px] ${
            connected ? 'bg-white' : 'bg-cream-200/70'
          }`}
        />
        {text || ' '}
      </p>
    </div>
  );
}
