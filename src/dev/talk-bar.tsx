/**
 * How you talk to the badge.
 *
 * The microphone button stands in for the real one on the hardware. The text
 * box does not exist on any badge — it is the fastest way to drive a whole
 * conversation when you have no mic, or when you need the same sentence twice.
 */

import { useState } from 'react';
import { useSimulatorStore } from '../store/simulator-store';

export function TalkBar() {
  const [text, setText] = useState('');
  const status = useSimulatorStore((state) => state.status);
  const micState = useSimulatorStore((state) => state.micState);
  const micLevel = useSimulatorStore((state) => state.micLevel);
  const speaking = useSimulatorStore((state) => state.speaking);
  const audioError = useSimulatorStore((state) => state.audioError);
  const sendText = useSimulatorStore((state) => state.sendText);
  const abort = useSimulatorStore((state) => state.abort);
  const connect = useSimulatorStore((state) => state.connect);
  const startListening = useSimulatorStore((state) => state.startListening);
  const stopListening = useSimulatorStore((state) => state.stopListening);

  const connected = status === 'connected';
  const listening = micState === 'listening';

  const submit = () => {
    if (!text.trim()) return;
    sendText(text);
    setText('');
  };

  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={connect}
          disabled={status === 'connecting'}
          className="rounded-blob bg-coral-500 px-10 py-4 text-lg font-bold text-white shadow-[0_10px_24px_-8px_rgba(255,107,74,0.7)] transition hover:bg-coral-400 active:scale-95 disabled:opacity-60"
        >
          {status === 'connecting' ? 'Waking up…' : 'Wake up Bống'}
        </button>
        <p className="text-sm text-ink-500">Connects to the server and says hello</p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-4">
      <div className="flex items-center gap-4">
        <MicButton
          listening={listening}
          level={micLevel}
          muted={speaking}
          onClick={() => (listening ? stopListening() : void startListening())}
        />
        {speaking && (
          <button
            type="button"
            onClick={abort}
            className="rounded-blob bg-white px-5 py-3 text-sm font-semibold text-ink-700 shadow-[0_6px_16px_-8px_rgba(61,44,36,0.4)] transition hover:bg-cream-100 active:scale-95"
          >
            Shhh — stop talking
          </button>
        )}
      </div>

      <div className="flex w-full items-center gap-2 rounded-blob bg-white p-2 shadow-[0_8px_24px_-12px_rgba(61,44,36,0.3)]">
        <input
          type="text"
          value={text}
          placeholder="Kể cho con một câu chuyện…"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && submit()}
          className="min-w-0 flex-1 bg-transparent px-4 py-2 text-base text-ink-900 outline-none placeholder:text-ink-300"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="rounded-blob bg-coral-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-coral-400 active:scale-95 disabled:opacity-40"
        >
          Send
        </button>
      </div>

      {audioError && <p className="text-sm font-medium text-berry-500">{audioError}</p>}
    </div>
  );
}

interface MicButtonProps {
  listening: boolean;
  level: number;
  muted: boolean;
  onClick: () => void;
}

/**
 * The mic, with the live level drawn as a ring around it.
 *
 * The ring goes amber rather than green while the badge is talking: the mic is
 * still open and still measuring — that is what makes barge-in work — but
 * nothing is being sent, and a meter that moved while transmitting nothing
 * would be lying.
 */
function MicButton({ listening, level, muted, onClick }: MicButtonProps) {
  const ring = muted ? 'rgba(255,201,92,0.65)' : 'rgba(78,217,164,0.75)';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex h-20 w-20 items-center justify-center rounded-full text-3xl transition active:scale-95 ${
        listening
          ? 'bg-white shadow-[0_8px_24px_-8px_rgba(61,44,36,0.35)]'
          : 'bg-coral-500 text-white shadow-[0_10px_24px_-8px_rgba(255,107,74,0.7)] hover:bg-coral-400'
      }`}
      title={listening ? 'Stop listening' : 'Let Bống hear you'}
    >
      {listening && (
        <span
          className="absolute inset-0 rounded-full transition-all duration-75"
          style={{ boxShadow: `0 0 0 ${2 + level * 14}px ${ring}` }}
        />
      )}
      <span className="relative">{listening ? '🎙️' : '🎤'}</span>
    </button>
  );
}
