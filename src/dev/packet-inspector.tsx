/**
 * Live view of every JSON frame in both directions.
 *
 * This is the debugging tool the simulator exists for: when the backend
 * misbehaves, you want the exact frames, not a summary.
 */

import { useState } from 'react';
import { useSimulatorStore, type PacketLogEntry } from '../store/simulator-store';
import { Panel } from './dev-drawer';

export function PacketInspector() {
  // Subscribing to just this slice is why the log can update freely without
  // re-rendering the badge next to it.
  const packets = useSimulatorStore((state) => state.packets);
  const clearPackets = useSimulatorStore((state) => state.clearPackets);

  return (
    <Panel
      title="Packets"
      grow
      action={
        <button
          type="button"
          onClick={clearPackets}
          className="text-xs font-semibold text-ink-300 transition hover:text-coral-500"
        >
          Clear
        </button>
      }
    >
      <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {packets.map((packet) => (
          <PacketRow key={packet.id} packet={packet} />
        ))}
        {packets.length === 0 && <p className="text-sm text-ink-300">No traffic yet.</p>}
      </ol>
    </Panel>
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
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-cream-100"
      >
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
            inbound ? 'bg-coral-500/15 text-coral-600' : 'bg-mint-400/20 text-mint-500'
          }`}
        >
          {inbound ? 'IN' : 'OUT'}
        </span>
        <span className="font-mono text-xs font-semibold text-ink-900">{packet.type}</span>
        <span className="ml-auto font-mono text-[10px] text-ink-300">
          {new Date(packet.at).toLocaleTimeString()}
        </span>
      </button>
      {expanded && (
        <pre className="mt-1 overflow-x-auto rounded-lg bg-screen p-3 font-mono text-[11px] leading-relaxed text-cream-200">
          {JSON.stringify(packet.payload, null, 2)}
        </pre>
      )}
    </li>
  );
}
