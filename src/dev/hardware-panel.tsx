/**
 * The badge's physical condition, as a set of dials.
 *
 * Everything here is something the real hardware measures about itself and
 * reports — and most of it is otherwise unreachable, since nothing in the
 * stack can produce a flat battery or a broken microphone on demand.
 */

import { useSimulatorStore } from '../store/simulator-store';
import {
  DEVICE_FAULTS,
  wifiBars,
  wifiQuality,
  LOW_BATTERY,
} from '../hardware/hardware-state';
import { Panel } from './dev-drawer';

export function HardwarePanel() {
  const hardware = useSimulatorStore((state) => state.hardware);
  const apiUrl = useSimulatorStore((state) => state.config.apiUrl);
  const connected = useSimulatorStore((state) => state.status === 'connected');
  const setHardware = useSimulatorStore((state) => state.setHardware);
  const pressButton = useSimulatorStore((state) => state.pressButton);

  return (
    <Panel title="Phần cứng" action={<TelemetryBadge state={hardware.telemetry} hasUrl={!!apiUrl} />}>
      <Slider
        label="Pin"
        value={`${hardware.battery}%`}
        min={0}
        max={100}
        step={1}
        current={hardware.battery}
        danger={hardware.battery <= LOW_BATTERY}
        onChange={(battery) => setHardware({ battery })}
      />

      <div className="flex gap-2">
        <Toggle
          label="Đang sạc"
          on={hardware.charging}
          onChange={(charging) => setHardware({ charging })}
        />
        <Toggle
          label="Tự hao pin"
          on={hardware.autoDrain}
          onChange={(autoDrain) => setHardware({ autoDrain })}
        />
      </div>

      <Slider
        label="Sóng WiFi"
        value={`${hardware.wifiRssi} dBm · ${wifiQuality(hardware.wifiRssi)} ${'▮'.repeat(wifiBars(hardware.wifiRssi)) || '—'}`}
        min={-95}
        max={-40}
        step={1}
        current={hardware.wifiRssi}
        danger={hardware.wifiRssi < -85}
        onChange={(wifiRssi) => setHardware({ wifiRssi })}
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-ink-500">Nút bấm</span>
        <div className="flex gap-2">
          {(['wake_up', 'press', 'goodbye'] as const).map((action) => (
            <button
              key={action}
              type="button"
              // `wake_up` works while asleep — it is how you turn the badge on.
              disabled={!connected && action !== 'wake_up'}
              onClick={() => pressButton(action)}
              className="flex-1 rounded-xl bg-cream-100 px-2 py-2 text-xs font-bold text-ink-700 transition hover:bg-cream-200 active:scale-95 disabled:opacity-40"
            >
              {{ wake_up: 'Thức dậy', press: 'Bấm', goodbye: 'Tạm biệt' }[action]}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-ink-500">Báo lỗi thiết bị</span>
        <select
          value={hardware.faultCode ?? ''}
          onChange={(event) => setHardware({ faultCode: event.target.value || null })}
          className="rounded-xl bg-cream-100 px-3 py-2 text-sm text-ink-900 outline-none"
        >
          <option value="">Bình thường</option>
          {DEVICE_FAULTS.map((fault) => (
            <option key={fault.code} value={fault.code}>
              {fault.label}
            </option>
          ))}
        </select>
      </label>

      {hardware.telemetryError && (
        <p className="text-xs text-berry-500">Gửi telemetry lỗi: {hardware.telemetryError}</p>
      )}
      {!apiUrl && (
        <p className="text-xs text-ink-300">
          Đặt “API backend” trong phần Kết nối để gửi lên máy chủ mà app phụ huynh đọc
        </p>
      )}
    </Panel>
  );
}

/** Whether the last report reached the backend the parent app reads. */
function TelemetryBadge({ state, hasUrl }: { state: string; hasUrl: boolean }) {
  const tone = {
    ok: 'bg-mint-400/20 text-mint-500',
    sending: 'bg-sunny-400/25 text-ink-700',
    error: 'bg-berry-500/15 text-berry-500',
    off: 'bg-cream-200 text-ink-500',
  }[state];
  const label = { ok: 'đã gửi', sending: 'đang gửi', error: 'lỗi', off: hasUrl ? '—' : 'tắt' }[state];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tone}`}>{label}</span>;
}

interface SliderProps {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  current: number;
  danger?: boolean;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step, current, danger, onChange }: SliderProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-ink-500">{label}</span>
        <span className={`font-mono text-xs ${danger ? 'text-berry-500' : 'text-ink-700'}`}>
          {value}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(event) => onChange(Number(event.target.value))}
        className={danger ? 'accent-berry-500' : 'accent-coral-500'}
      />
    </label>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex flex-1 items-center justify-between gap-2 rounded-xl bg-cream-100 px-3 py-2">
      <span className="text-xs font-semibold text-ink-700">{label}</span>
      <input
        type="checkbox"
        checked={on}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-9 shrink-0 appearance-none rounded-full bg-cream-300 transition checked:bg-mint-400 before:block before:h-4 before:w-4 before:translate-x-0.5 before:translate-y-0.5 before:rounded-full before:bg-white before:transition checked:before:translate-x-[1.125rem]"
      />
    </label>
  );
}
