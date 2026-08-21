/**
 * Microphone and speaker controls.
 *
 * The frame counters matter more than they look: Opus frames are the one part
 * of the protocol the packet inspector deliberately does not log, so without a
 * count here there is no way to tell "the backend sent no audio" apart from
 * "the audio arrived and failed to decode".
 */

import { useSimulatorStore } from '../store/simulator-store';

export function AudioPanel() {
  const micState = useSimulatorStore((state) => state.micState);
  const micLevel = useSimulatorStore((state) => state.micLevel);
  const speaking = useSimulatorStore((state) => state.speaking);
  const volume = useSimulatorStore((state) => state.volume);
  const status = useSimulatorStore((state) => state.status);
  const audioError = useSimulatorStore((state) => state.audioError);
  const framesIn = useSimulatorStore((state) => state.framesIn);
  const framesOut = useSimulatorStore((state) => state.framesOut);
  const startListening = useSimulatorStore((state) => state.startListening);
  const stopListening = useSimulatorStore((state) => state.stopListening);
  const setVolume = useSimulatorStore((state) => state.setVolume);

  const isConnected = status === 'connected';
  const isListening = micState === 'listening';

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-slate-900 p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Audio</h2>
        <span className="font-mono text-xs text-slate-600">
          in {framesIn} · out {framesOut}
        </span>
      </header>

      <button
        type="button"
        disabled={!isConnected}
        onClick={() => (isListening ? stopListening() : void startListening())}
        className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
          isListening ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'
        }`}
      >
        {isListening ? 'Stop microphone' : 'Start microphone'}
      </button>

      <LevelMeter level={micLevel} active={isListening} muted={speaking} />

      <label className="flex items-center gap-3">
        <span className="text-xs text-slate-400">Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          className="flex-1 accent-sky-500"
        />
      </label>

      <div className="flex items-center gap-2 text-xs">
        <span
          className={`h-2 w-2 rounded-full ${speaking ? 'animate-pulse bg-emerald-500' : 'bg-slate-700'}`}
        />
        <span className="text-slate-400">{speaking ? 'Speaker active' : 'Speaker idle'}</span>
      </div>

      {audioError && <p className="text-xs text-rose-400">{audioError}</p>}
    </section>
  );
}

interface LevelMeterProps {
  level: number;
  active: boolean;
  muted: boolean;
}

/**
 * Mic loudness.
 *
 * Goes amber while the badge is talking: the mic is still open and still being
 * measured — that is what makes barge-in work — but nothing is being sent, and
 * a meter that moved while transmitting nothing would be a lie.
 */
function LevelMeter({ level, active, muted }: LevelMeterProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full transition-[width] duration-75 ${muted ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
      <span className="text-xs text-slate-500">
        {!active ? 'Microphone off' : muted ? 'Muted while speaking' : 'Listening'}
      </span>
    </div>
  );
}
