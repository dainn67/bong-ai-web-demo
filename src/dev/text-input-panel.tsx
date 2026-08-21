/**
 * Types a sentence to the backend as if the child had spoken it.
 *
 * This is what makes the whole loop testable before the microphone works: a
 * `listen`/`detect` frame drives the same path a real utterance would.
 */

import { useState } from 'react';
import { useSimulatorStore } from '../store/simulator-store';

export function TextInputPanel() {
  const [text, setText] = useState('');
  const status = useSimulatorStore((state) => state.status);
  const sendText = useSimulatorStore((state) => state.sendText);
  const abort = useSimulatorStore((state) => state.abort);

  const isConnected = status === 'connected';

  const submit = () => {
    sendText(text);
    setText('');
  };

  return (
    <section className="flex flex-col gap-2 rounded-xl bg-slate-900 p-4">
      <h2 className="text-sm font-semibold text-slate-200">Say something</h2>
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          disabled={!isConnected}
          placeholder="Kể cho con một câu chuyện"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && submit()}
          className="flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!isConnected}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          Send
        </button>
      </div>
      <button
        type="button"
        onClick={abort}
        disabled={!isConnected}
        className="self-start text-xs text-slate-500 hover:text-slate-300 disabled:opacity-50"
      >
        Interrupt (abort)
      </button>
    </section>
  );
}
