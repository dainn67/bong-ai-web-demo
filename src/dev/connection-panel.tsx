/**
 * Endpoint settings and the connect/disconnect controls.
 *
 * Everything is editable while running, because pointing the simulator at a
 * different server is the single most common thing you do with it.
 */

import { useSimulatorStore } from '../store/simulator-store';

const STATUS_STYLE = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-slate-600',
} as const;

export function ConnectionPanel() {
  const config = useSimulatorStore((state) => state.config);
  const status = useSimulatorStore((state) => state.status);
  const sessionId = useSimulatorStore((state) => state.sessionId);
  const updateConfig = useSimulatorStore((state) => state.updateConfig);
  const connect = useSimulatorStore((state) => state.connect);
  const disconnect = useSimulatorStore((state) => state.disconnect);

  const isOffline = status === 'disconnected';

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-slate-900 p-4">
      <header className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLE[status]}`} />
        <h2 className="text-sm font-semibold text-slate-200">{status}</h2>
        {sessionId && (
          <code className="ml-auto truncate text-xs text-slate-500">{sessionId}</code>
        )}
      </header>

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
        label="MAC address"
        value={config.macAddress}
        disabled={!isOffline}
        onChange={(macAddress) => updateConfig({ macAddress })}
      />

      <button
        type="button"
        onClick={isOffline ? connect : disconnect}
        className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
          isOffline ? 'bg-sky-600 hover:bg-sky-500' : 'bg-rose-600 hover:bg-rose-500'
        }`}
      >
        {isOffline ? 'Connect' : 'Disconnect'}
      </button>
    </section>
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
      <span className="text-xs text-slate-400">{label}</span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg bg-slate-800 px-3 py-2 font-mono text-xs text-slate-200 disabled:opacity-50"
      />
    </label>
  );
}
