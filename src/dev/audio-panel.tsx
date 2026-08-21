/**
 * Speaker volume and the proof that audio is moving.
 *
 * The frame counters matter more than they look: Opus frames are the one part
 * of the protocol the packet inspector deliberately does not log, so without a
 * count here there is no way to tell "the backend sent no audio" apart from
 * "the audio arrived and failed to decode".
 */

import { useSimulatorStore } from '../store/simulator-store';
import { Panel } from './dev-drawer';

export function AudioPanel() {
  const speaking = useSimulatorStore((state) => state.speaking);
  const volume = useSimulatorStore((state) => state.volume);
  const framesIn = useSimulatorStore((state) => state.framesIn);
  const framesOut = useSimulatorStore((state) => state.framesOut);
  const setVolume = useSimulatorStore((state) => state.setVolume);

  return (
    <Panel
      title="Audio"
      action={
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
            speaking ? 'bg-mint-400/20 text-mint-500' : 'bg-cream-200 text-ink-500'
          }`}
        >
          {speaking ? 'speaker on' : 'quiet'}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <Counter label="frames in" value={framesIn} />
        <Counter label="frames out" value={framesOut} />
      </div>

      <label className="flex items-center gap-3">
        <span className="text-xs font-semibold text-ink-500">Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          className="flex-1 accent-coral-500"
        />
      </label>
    </Panel>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-cream-100 px-3 py-2">
      <p className="font-mono text-lg font-bold leading-tight text-ink-900">{value}</p>
      <p className="text-xs text-ink-500">{label}</p>
    </div>
  );
}
