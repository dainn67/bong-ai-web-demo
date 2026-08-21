import { RoundScreen } from './screen/round-screen';
import { ConnectionPanel } from './dev/connection-panel';
import { PacketInspector } from './dev/packet-inspector';
import { TextInputPanel } from './dev/text-input-panel';

/**
 * Device on the left, instruments on the right.
 *
 * The split is deliberate: everything left of the divider is what the hardware
 * actually shows, everything right of it is scaffolding that no real badge has.
 */
export default function App() {
  return (
    <main className="flex h-screen gap-6 bg-slate-950 p-6 text-slate-100">
      <div className="flex flex-col items-center justify-center gap-6">
        <RoundScreen />
      </div>

      <div className="flex min-h-0 w-96 flex-col gap-4">
        <ConnectionPanel />
        <TextInputPanel />
        <PacketInspector />
      </div>
    </main>
  );
}
