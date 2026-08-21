/**
 * Live view of every JSON frame in both directions.
 *
 * This is the debugging tool the simulator exists for: when the backend
 * misbehaves, you want the exact frames, not a summary.
 */

import { useState } from 'react';
import { useSimulatorStore, type PacketLogEntry } from '../store/simulator-store';

export function PacketInspector() {
  // Subscribing to just this slice is why the log can update freely without
  // re-rendering the round screen next to it.
  const packets = useSimulatorStore((state) => state.packets);
  const clearPackets = useSimulatorStore((state) => state.clearPackets);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl bg-slate-900 p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Packets</h2>
        <button
          type="button"
          onClick={clearPackets}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          Clear
        </button>
      </header>

      <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto font-mono text-xs">
        {packets.map((packet) => (
          <PacketRow key={packet.id} packet={packet} />
        ))}
        {packets.length === 0 && <p className="text-slate-600">No traffic yet.</p>}
      </ol>
    </section>
  );
}

function PacketRow({ packet }: { packet: PacketLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const inbound = packet.direction === 'in';

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-800"
      >
        <span className={inbound ? 'text-sky-400' : 'text-emerald-400'}>
          {inbound ? '<-' : '->'}
        </span>
        <span className="text-slate-200">{packet.type}</span>
        <span className="ml-auto text-slate-600">
          {new Date(packet.at).toLocaleTimeString()}
        </span>
      </button>
      {expanded && (
        <pre className="overflow-x-auto rounded bg-slate-950 p-2 text-slate-400">
          {JSON.stringify(packet.payload, null, 2)}
        </pre>
      )}
    </li>
  );
}
