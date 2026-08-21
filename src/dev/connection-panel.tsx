/**
 * Endpoint settings and the connect/disconnect controls.
 *
 * Everything is editable while running, because pointing the simulator at a
 * different server is the single most common thing you do with it.
 */

import { useSimulatorStore } from '../store/simulator-store';
import { Panel } from './dev-drawer';

export function ConnectionPanel() {
  const config = useSimulatorStore((state) => state.config);
  const status = useSimulatorStore((state) => state.status);
  const sessionId = useSimulatorStore((state) => state.sessionId);
  const updateConfig = useSimulatorStore((state) => state.updateConfig);
  const connect = useSimulatorStore((state) => state.connect);
  const disconnect = useSimulatorStore((state) => state.disconnect);

  const isOffline = status === 'disconnected';

  return (
    <Panel title="Connection">
      <Field
        label="OTA URL"
        value={config.otaUrl}
        disabled={!isOffline}
        onChange={(otaUrl) => updateConfig({ otaUrl })}
      />
      <Field
        label="WebSocket fallback"
        value={config.fallbackWsUrl}
        disabled={!isOffline}
        onChange={(fallbackWsUrl) => updateConfig({ fallbackWsUrl })}
      />
      <Field
        label="Device ID"
        value={config.macAddress}
        disabled={!isOffline}
        onChange={(macAddress) => updateConfig({ macAddress })}
      />
      <Field
        label="Sample rate"
        value={String(config.sampleRate)}
        disabled={!isOffline}
        onChange={(value) => updateConfig({ sampleRate: Number(value) || 16000 })}
      />

      {!isOffline && (
        <p className="text-xs text-ink-300">Disconnect to edit — changing these mid-session does nothing</p>
      )}
      {sessionId && (
        <p className="truncate font-mono text-xs text-ink-300">session {sessionId}</p>
      )}

      <button
        type="button"
        onClick={isOffline ? connect : disconnect}
        className={`rounded-blob px-4 py-2.5 text-sm font-bold text-white transition active:scale-95 ${
          isOffline ? 'bg-coral-500 hover:bg-coral-400' : 'bg-berry-500 hover:opacity-90'
        }`}
      >
        {isOffline ? 'Connect' : 'Disconnect'}
      </button>
    </Panel>
  );
}

interface FieldProps {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

/** Locked while connected — changing an endpoint mid-session does nothing. */
function Field({ label, value, disabled, onChange }: FieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-ink-500">{label}</span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-xl bg-cream-100 px-3 py-2 font-mono text-xs text-ink-900 outline-none transition focus:bg-cream-200 disabled:text-ink-300"
      />
    </label>
  );
}
