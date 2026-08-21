/**
 * Stand-in screen content, on demand.
 *
 * The backend is expected to drive the display eventually and nothing does yet,
 * so this is the only way to see the device showing a picture — and the only
 * way to demo it. Pushing a scene goes through the same reducer a real
 * `display` frame does, so what you see here is what the badge will do.
 */

import { useSimulatorStore } from '../store/simulator-store';
import { MOCK_SCENES } from '../mock/screen-assets';
import { Panel } from './dev-drawer';

export function MockPanel() {
  const mockFaces = useSimulatorStore((state) => state.mockFaces);
  const imageUrl = useSimulatorStore((state) => state.face.imageUrl);
  const status = useSimulatorStore((state) => state.status);
  const setMockFaces = useSimulatorStore((state) => state.setMockFaces);
  const showMockScene = useSimulatorStore((state) => state.showMockScene);

  const connected = status === 'connected';

  return (
    <Panel title="Mock screen">
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-ink-700">
          Drawn faces
          <span className="block text-xs font-normal text-ink-500">
            Stand-in artwork instead of emoji
          </span>
        </span>
        <input
          type="checkbox"
          checked={mockFaces}
          onChange={(event) => setMockFaces(event.target.checked)}
          className="h-5 w-9 shrink-0 appearance-none rounded-full bg-cream-300 transition checked:bg-mint-400 before:block before:h-4 before:w-4 before:translate-x-0.5 before:translate-y-0.5 before:rounded-full before:bg-white before:transition checked:before:translate-x-[1.125rem]"
        />
      </label>

      <div className="grid grid-cols-4 gap-2">
        {MOCK_SCENES.map((scene) => (
          <button
            key={scene.id}
            type="button"
            disabled={!connected}
            onClick={() => showMockScene(scene.url)}
            title={scene.label}
            className={`overflow-hidden rounded-xl ring-2 transition disabled:opacity-40 ${
              imageUrl === scene.url ? 'ring-coral-500' : 'ring-transparent hover:ring-cream-300'
            }`}
          >
            <img src={scene.url} alt={scene.label} className="aspect-square w-full object-cover" />
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={!connected || !imageUrl}
        onClick={() => showMockScene(null)}
        className="rounded-blob bg-cream-100 px-4 py-2 text-sm font-bold text-ink-700 transition hover:bg-cream-200 active:scale-95 disabled:opacity-40"
      >
        Back to the face
      </button>

      {!connected && (
        <p className="text-xs text-ink-300">Connect first — the screen is off while asleep</p>
      )}
    </Panel>
  );
}
