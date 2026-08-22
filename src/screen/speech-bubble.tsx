/**
 * The conversation, as two bubbles.
 *
 * On real hardware this text lives inside the circle, where there is room for
 * about four words. Here it sits outside: the demo is watched from across a
 * desk, and a caption you can actually read is worth more than strict fidelity
 * to a 240-pixel screen.
 *
 * Two bubbles rather than one line, each pointing at where its words came
 * from — the badge's at the badge, the child's at the box they typed into.
 */

import { useSimulatorStore } from '../store/simulator-store';

/** What the badge is saying. Sits under the device, tail pointing up at it. */
export function BongBubble() {
  const said = useSimulatorStore((state) => state.face.said);
  const speaking = useSimulatorStore((state) => state.face.mode === 'speaking');
  const connected = useSimulatorStore((state) => state.status === 'connected');

  return (
    <Bubble
      // The label is added here, not stored: the state knows who spoke by
      // which field it is, and only the drawing needs a name for it.
      text={connected && said ? `Bống: ${said}` : ''}
      tail="up"
      className={`bg-white text-ink-900 shadow-[0_8px_24px_-8px_rgba(61,44,36,0.25)] ${
        speaking ? 'ring-2 ring-mint-400/40' : ''
      }`}
      tailClassName="bg-white"
    />
  );
}

/** What the child said. Sits above the input, tail pointing down at it. */
export function HeardBubble() {
  const heard = useSimulatorStore((state) => state.face.heard);
  const connected = useSimulatorStore((state) => state.status === 'connected');

  return (
    <Bubble
      // No label: we have no name to put in front of a child's own words.
      text={connected ? heard : ''}
      tail="down"
      className="bg-cream-200 text-ink-700"
      tailClassName="bg-cream-200"
    />
  );
}

interface BubbleProps {
  text: string;
  tail: 'up' | 'down';
  className: string;
  tailClassName: string;
}

function Bubble({ text, tail, className, tailClassName }: BubbleProps) {
  // The row keeps its height while empty, or the device and the controls jump
  // apart every time somebody speaks.
  return (
    <div className="flex min-h-14 w-full items-center justify-center px-6">
      <p
        className={`relative max-w-md rounded-blob px-6 py-3 text-center text-lg font-semibold leading-snug transition-all duration-300 ${
          text ? className : 'opacity-0'
        }`}
      >
        <span
          className={`absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[3px] ${tailClassName} ${
            tail === 'up' ? '-top-1.5' : '-bottom-1.5'
          }`}
        />
        {text || ' '}
      </p>
    </div>
  );
}
